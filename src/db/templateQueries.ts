import { getDb } from "./db";
import type { CycleTemplateEvent, DayLabel } from "./db";

export async function getAllCycleTemplateEvents(): Promise<CycleTemplateEvent[]> {
  const db = await getDb();
  return db.getAll("cycleTemplateEvents");
}

export function dayLabelsForSet(set: "A" | "B"): DayLabel[] {
  return (set === "A"
    ? ["MonA","TueA","WedA","ThuA","FriA"]
    : ["MonB","TueB","WedB","ThuB","FriB"]) as DayLabel[];
}