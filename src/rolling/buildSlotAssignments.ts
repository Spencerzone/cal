import { getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { cycleTemplateEventsCol, slotAssignmentsCol, slotAssignmentDoc } from "../db/db";
import type { CycleTemplateEvent, DayLabel, SlotAssignment, SlotId, AssignmentKind } from "../db/db";

function normalisePeriodCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

function slotForEvent(periodCode: string | null | undefined, title: string): SlotId | null {
  const p = normalisePeriodCode(periodCode);

  if (p === "BEFORE SCHOOL" || p === "BEFORE") return "before";
  if (p === "AFTER SCHOOL" || p === "AFTER") return "after";

  if (p === "RC" || p === "ROLL CALL" || p === "ROLLCALL") return "rc";
  if (p === "1") return "p1";
  if (p === "2") return "p2";
  if (p === "3") return "p3";
  if (p === "4") return "p4";
  if (p === "5") return "p5";
  if (p === "6") return "p6";

  if (p === "R1" || p === "RECESS 1" || p === "RECESS") return "r1";
  if (p === "R2" || p === "RECESS 2") return "r2";
  if (p === "L1" || p === "LUNCH 1" || p === "LUNCH") return "l1";
  if (p === "L2" || p === "LUNCH 2") return "l2";

  const t = (title ?? "").toUpperCase();
  if (t.includes("BEFORE SCHOOL")) return "before";
  if (t.includes("AFTER SCHOOL")) return "after";

  return null;
}

function kindFromType(t: CycleTemplateEvent["type"]): AssignmentKind {
  if (t === "class") return "class";
  if (t === "duty") return "duty";
  return "break";
}

function rankKind(k: AssignmentKind): number {
  return k === "class" ? 0 : k === "duty" ? 1 : k === "break" ? 2 : 3;
}

/**
 * Rebuilds slotAssignments from cycleTemplateEvents, choosing exactly one "best" event per slot.
 * This prevents duplicates and avoids inventing slots that don't exist on that day (e.g. p6).
 */
export async function buildDraftSlotAssignments(userId: string) {

  // Choose one best event per (dayLabel, slotId)
  // Priority:
  //  1) class over duty over break
  //  2) earlier start
  //  3) longer duration
  const best = new Map<
    string,
    {
      kind: AssignmentKind;
      sourceTemplateEventId: string;
      manualTitle: string;
      manualCode: string | null;
      manualRoom: string | null;
      startMinutes: number;
      endMinutes: number;
    }
  >();

  const tplSnap = await getDocs(cycleTemplateEventsCol(userId));
  for (const d of tplSnap.docs) {
    const e = d.data() as CycleTemplateEvent;
    const slotId = slotForEvent(e.periodCode, e.title);
    if (!slotId) continue;

    const key = `${e.dayLabel}::${slotId}`;
    const candidate = {
      kind: kindFromType(e.type),
      sourceTemplateEventId: e.id,
      manualTitle: e.title,
      manualCode: e.code ?? null,
      manualRoom: e.room ?? null,
      startMinutes: e.startMinutes,
      endMinutes: e.endMinutes,
    };

    const prev = best.get(key);
    if (!prev) {
      best.set(key, candidate);
      continue;
    }

    const prevRank = rankKind(prev.kind);
    const nextRank = rankKind(candidate.kind);
    if (nextRank < prevRank) {
      best.set(key, candidate);
      continue;
    }
    if (nextRank > prevRank) continue;

    if (candidate.startMinutes < prev.startMinutes) {
      best.set(key, candidate);
      continue;
    }
    if (candidate.startMinutes > prev.startMinutes) continue;

    const prevDur = prev.endMinutes - prev.startMinutes;
    const nextDur = candidate.endMinutes - candidate.startMinutes;
    if (nextDur > prevDur) best.set(key, candidate);
  }

  // Persist: replace existing slotAssignments (Firestore)
  const existingSnap = await getDocs(slotAssignmentsCol(userId));
  if (!existingSnap.empty) {
    const batchDel = writeBatch(db);
    for (const d of existingSnap.docs) batchDel.delete(d.ref);
    await batchDel.commit();
  }

  const rows: SlotAssignment[] = [];
  for (const [key, e] of best.entries()) {
    const [dayLabel, slotId] = key.split("::") as [DayLabel, SlotId];
    rows.push({
      key,
      dayLabel,
      slotId,
      kind: e.kind,
      sourceTemplateEventId: e.sourceTemplateEventId,
      manualTitle: e.manualTitle,
      manualCode: e.manualCode,
      manualRoom: e.manualRoom,
    });
  }

  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const r of chunk) batch.set(slotAssignmentDoc(userId, r.key), r, { merge: false });
    await batch.commit();
  }
}