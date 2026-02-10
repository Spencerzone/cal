import { getDb } from "./db";
import type { DayLabel, SlotAssignment } from "./db";

export async function getAssignmentsForDayLabels(labels: DayLabel[]): Promise<SlotAssignment[]> {
  const db = await getDb();
  const all = await db.getAll("slotAssignments");
  return all.filter(a => labels.includes(a.dayLabel));
}