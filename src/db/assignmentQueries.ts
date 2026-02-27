// src/db/assignmentQueries.ts (Firestore source-of-truth)

import { getDocs, query, where, setDoc } from "firebase/firestore";
import type { DayLabel, SlotAssignment } from "./db";
import { slotAssignmentsCol } from "./db";

function yearFromKey(k?: string): number | undefined {
  const s = (k ?? "").trim();
  // Expected format: "2026::MonA::p1" (or similar)
  const m = /^(\d{4})::/.exec(s);
  if (!m) return undefined;
  const y = parseInt(m[1], 10);
  return Number.isFinite(y) ? y : undefined;
}

export async function getAssignmentsForDayLabels(
  userId: string,
  year: number,
  labels: DayLabel[] = [],
): Promise<SlotAssignment[]> {
  const safeLabels = (labels ?? []).filter(Boolean) as DayLabel[];
  if (!userId || !Number.isFinite(year) || safeLabels.length === 0) return [];

  const out: SlotAssignment[] = [];
  const col = slotAssignmentsCol(userId);

  // Firestore "in" filter has a limit of 10 values
  const CHUNK = 10;
  for (let i = 0; i < safeLabels.length; i += CHUNK) {
    const chunk = safeLabels.slice(i, i + CHUNK);

    // IMPORTANT:
    // Do NOT query by year here, because legacy docs may not have `year` set yet.
    // We'll filter client-side and backfill year when we can infer it safely.
    const q = query(col, where("dayLabel", "in", chunk));
    const snap = await getDocs(q);

    for (const d of snap.docs) {
      const data = d.data() as any;

      // Determine the doc's year:
      // 1) explicit field
      // 2) infer from key
      // 3) infer from doc id (some code uses key as id)
      const inferred =
        (typeof data.year === "number" ? data.year : undefined) ??
        yearFromKey(data.key) ??
        yearFromKey(d.id);

      // Backfill ONLY if we can infer it belongs to the active year.
      if (data.year === undefined && inferred === year) {
        await setDoc(d.ref, { year }, { merge: true });
        data.year = year;
      }

      // If we still can't infer, treat as not-for-this-year (avoid cross-year pollution).
      if (inferred === undefined) continue;
      if (inferred !== year) continue;

      out.push(data as SlotAssignment);
    }
  }

  // De-dupe by key (last one wins)
  const m = new Map<string, SlotAssignment>();
  for (const a of out) m.set(a.key, a);
  return Array.from(m.values());
}
