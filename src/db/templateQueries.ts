// src/db/templateQueries.ts (Firestore source-of-truth)

import { getDocs } from "firebase/firestore";
import type { CycleTemplateEvent, DayLabel } from "./db";
import { cycleTemplateEventsCol } from "./db";

export async function getAllCycleTemplateEvents(userId: string): Promise<CycleTemplateEvent[]> {
  const snap = await getDocs(cycleTemplateEventsCol(userId));
  return snap.docs.map((d) => d.data() as CycleTemplateEvent);
}

export function dayLabelsForSet(set: "A" | "B"): DayLabel[] {
  return (set === "A"
    ? ["MonA", "TueA", "WedA", "ThuA", "FriA"]
    : ["MonB", "TueB", "WedB", "ThuB", "FriB"]) as DayLabel[];
}
