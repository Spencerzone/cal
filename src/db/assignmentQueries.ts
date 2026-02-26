// src/db/assignmentQueries.ts (Firestore source-of-truth)

import { getDocs, query, where } from "firebase/firestore";
import type { DayLabel, SlotAssignment } from "./db";
import { slotAssignmentsCol } from "./db";

export async function getAssignmentsForDayLabels(
  userId: string,
  year: number,
  labels: DayLabel[] = []
): Promise<SlotAssignment[]> {
  const safeLabels: DayLabel[] = (labels ?? []).filter(Boolean) as DayLabel[];
  if (!userId || !year || safeLabels.length === 0) return [];

  const out: SlotAssignment[] = [];
  const col = (slotAssignmentsCol as any)(userId, year);

  // Firestore "in" filter has a limit of 10 values
  const CHUNK = 10;
  for (let i = 0; i < safeLabels.length; i += CHUNK) {
    const chunk = safeLabels.slice(i, i + CHUNK);
    const q = query(col, where("dayLabel", "in", chunk));
    const snap = await getDocs(q);
    out.push(...snap.docs.map((d) => d.data() as SlotAssignment));
  }
  return out;
}
