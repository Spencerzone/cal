// src/db/templateQueries.ts (Firestore source-of-truth)

import { getDocs, setDoc } from "firebase/firestore";
import type { CycleTemplateEvent, DayLabel } from "./db";
import { cycleTemplateEventsCol } from "./db";

export async function getAllCycleTemplateEvents(userId: string, year: number): Promise<CycleTemplateEvent[]> {
  const snap = await getDocs(cycleTemplateEventsCol(userId));
  const out: CycleTemplateEvent[] = [];
  for (const d of snap.docs) {
    const te = d.data() as any;
    if (te.year === undefined) {
      await setDoc(d.ref, { year }, { merge: true });
      te.year = year;
    }
    if ((te.year ?? year) !== year) continue;
    out.push(te as CycleTemplateEvent);
  }
  return out;
}

export function dayLabelsForSet(set: "A" | "B"): DayLabel[] {
  return (set === "A"
    ? ["MonA", "TueA", "WedA", "ThuA", "FriA"]
    : ["MonB", "TueB", "WedB", "ThuB", "FriB"]) as DayLabel[];
}