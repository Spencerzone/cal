// src/db/assignmentQueries.ts (Firestore source-of-truth)

import { getDocs, query, where, setDoc } from "firebase/firestore";
import type { DayLabel, SlotAssignment } from "./db";
import { slotAssignmentsCol } from "./db";

export async function getAssignmentsForDayLabels(
  userId: string,
  year: number,
  labels: DayLabel[]
): Promise<SlotAssignment[]> {
  if (labels.length === 0) return [];
  const out: SlotAssignment[] = [];
  const col = slotAssignmentsCol(userId);

  const CHUNK = 10;
  for (let i = 0; i < labels.length; i += CHUNK) {
    const chunk = labels.slice(i, i + CHUNK);
    const q = query(col, where("dayLabel", "in", chunk));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const data = d.data() as any;
      if (data.year === undefined) {
        await setDoc(d.ref, { year }, { merge: true });
        data.year = year;
      }
      if ((data.year ?? year) !== year) continue;
      out.push(data as SlotAssignment);
    }
  }

  const m = new Map<string, SlotAssignment>();
  for (const a of out) m.set(a.key, a);
  return Array.from(m.values());
}