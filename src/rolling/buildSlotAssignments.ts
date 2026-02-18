import { getDb } from "../db/db";
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
export async function buildDraftSlotAssignments() {
  const db = await getDb();
  const all = await db.getAll("cycleTemplateEvents");

  // best candidate per (dayLabel,slot)
  const best = new Map<string, CycleTemplateEvent>();

  for (const e of all) {
    const slotId = slotForEvent(e.periodCode, e.title);
    if (!slotId) continue;

    const key = `${e.dayLabel}::${slotId}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, e);
      continue;
    }

    const ek = kindFromType(existing.type);
    const nk = kindFromType(e.type);

    const better =
      rankKind(nk) < rankKind(ek) ||
      (rankKind(nk) === rankKind(ek) && e.startMinutes < existing.startMinutes);

    if (better) best.set(key, e);
  }

  const tx = db.transaction(["slotAssignments"], "readwrite");
  const store = tx.objectStore("slotAssignments");
  await store.clear();

  for (const [key, e] of best.entries()) {
    const [dayLabel, slotId] = key.split("::") as [DayLabel, SlotId];
    const row: SlotAssignment = {
      key,
      dayLabel,
      slotId,
      kind: kindFromType(e.type),
      sourceTemplateEventId: e.id,
    };
    await store.put(row);
  }

  await tx.done;
}