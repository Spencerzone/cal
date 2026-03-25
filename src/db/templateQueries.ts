// src/db/templateQueries.ts (Firestore source-of-truth)

import { getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import type { CycleTemplateEvent, DayLabel } from "./db";
import { cycleTemplateEventsCol } from "./db";

export async function getAllCycleTemplateEvents(userId: string, year: number): Promise<CycleTemplateEvent[]> {
  const snap = await getDocs(cycleTemplateEventsCol(userId));
  const out: CycleTemplateEvent[] = [];
  const toMigrate: typeof snap.docs = [];

  for (const d of snap.docs) {
    const te = d.data() as any;
    if (te.year === undefined) {
      toMigrate.push(d);
      te.year = year;
    }
    if ((te.year ?? year) !== year) continue;
    out.push(te as CycleTemplateEvent);
  }

  // Backfill missing year fields in one batch instead of one write per doc
  if (toMigrate.length > 0) {
    const batch = writeBatch(db);
    for (const d of toMigrate) {
      batch.update(d.ref, { year });
    }
    await batch.commit();
  }

  return out;
}

export function dayLabelsForSet(set: "A" | "B"): DayLabel[] {
  return (set === "A"
    ? ["MonA", "TueA", "WedA", "ThuA", "FriA"]
    : ["MonB", "TueB", "WedB", "ThuB", "FriB"]) as DayLabel[];
}