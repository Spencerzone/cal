import { getDb } from "./db";
import type { DayLabel, SlotAssignment } from "./db";

export async function getAssignmentsForDayLabels(labels: DayLabel[]): Promise<SlotAssignment[]> {
  const db = await getDb();
  const all = await db.getAll("slotAssignments");

  // Defensive: ensure unique by key (store is keyed by key anyway)
  const m = new Map<string, SlotAssignment>();
  for (const a of all) {
    if (!labels.includes(a.dayLabel)) continue;
    m.set(a.key, a);
  }
  return Array.from(m.values());
}