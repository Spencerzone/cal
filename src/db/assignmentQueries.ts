// src/db/assignmentQueries.ts (Firestore source-of-truth)

import { getDocs, query, where } from "firebase/firestore";
import type { DayLabel, SlotAssignment } from "./db";
import { slotAssignmentsCol } from "./db";

/**
 * Backwards-compatible signature:
 * - old: getAssignmentsForDayLabels(userId, labels)
 * - new: getAssignmentsForDayLabels(userId, year, labels)
 */
export async function getAssignmentsForDayLabels(
  userId: string,
  yearOrLabels?: number | DayLabel[],
  labelsMaybe?: DayLabel[],
): Promise<SlotAssignment[]> {
  const year = Array.isArray(yearOrLabels)
    ? undefined
    : typeof yearOrLabels === "number"
      ? yearOrLabels
      : undefined;
  const labels: DayLabel[] = Array.isArray(yearOrLabels)
    ? yearOrLabels
    : (labelsMaybe ?? []);

  if (!userId) return [];
  if (!labels || labels.length === 0) return [];

  const out: SlotAssignment[] = [];
  const col = (slotAssignmentsCol as any)(userId, year);

  const CHUNK = 10;
  for (let i = 0; i < labels.length; i += CHUNK) {
    const chunk = labels.slice(i, i + CHUNK);
    const q = query(col, where("dayLabel", "in", chunk));
    const snap = await getDocs(q);
    out.push(...snap.docs.map((d) => d.data() as SlotAssignment));
  }

  // Deduplicate by assignment key (dayLabel::slotId)
  const m = new Map<string, SlotAssignment>();
  for (const a of out) m.set(a.key, a);
  return Array.from(m.values());
}
