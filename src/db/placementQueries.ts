// src/db/placementQueries.ts (Firestore source-of-truth)

import {
  deleteDoc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  placementDoc,
  placementsCol,
  type DayLabel,
  type Placement,
  type SlotId,
} from "./db";

function keyFor(year: number, dayLabel: DayLabel, slotId: SlotId) {
  return `${year}::${dayLabel}::${slotId}`;
}

export type PlacementPatch = {
  subjectId?: string | null;
  roomOverride?: string | null;
};

function normaliseNext(next: PlacementPatch): PlacementPatch {
  const out: PlacementPatch = {};
  if (Object.prototype.hasOwnProperty.call(next, "subjectId")) out.subjectId = next.subjectId;
  if (Object.prototype.hasOwnProperty.call(next, "roomOverride")) out.roomOverride = next.roomOverride;
  return out;
}

function mergePlacement(
  existing: Placement | undefined,
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
  patch: PlacementPatch
): Placement | null {
  const next: Placement = {
    key: keyFor(year, dayLabel, slotId),
    userId,
    year,
    dayLabel,
    slotId,
  };

  if (existing?.subjectId !== undefined) next.subjectId = existing.subjectId;
  if (existing?.roomOverride !== undefined) next.roomOverride = existing.roomOverride;

  if (patch.subjectId !== undefined) next.subjectId = patch.subjectId;
  if (patch.roomOverride !== undefined) next.roomOverride = patch.roomOverride;

  const hasSubjectOverride = next.subjectId !== undefined;
  const hasRoomOverride = next.roomOverride !== undefined;

  if (!hasSubjectOverride && !hasRoomOverride) return null;
  return next;
}

export async function getPlacementsForDayLabels(userId: string, year: number, dayLabels: DayLabel[]): Promise<Placement[]> {
  if (dayLabels.length === 0) return [];
  const out: Placement[] = [];
  const col = placementsCol(userId);

  const CHUNK = 10;
  for (let i = 0; i < dayLabels.length; i += CHUNK) {
    const chunk = dayLabels.slice(i, i + CHUNK);
    const q = query(col, where("dayLabel", "in", chunk));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const data = d.data() as any;
      if (data.year === undefined) {
        // legacy placement keys won't include year; migrate into current year by rewriting
        await setDoc(d.ref, { year }, { merge: true });
        data.year = year;
      }
      if ((data.year ?? year) !== year) continue;
      out.push(data as Placement);
    }
  }
  return out;
}

export async function getPlacement(userId: string, year: number, dayLabel: DayLabel, slotId: SlotId): Promise<Placement | undefined> {
  const ref = placementDoc(userId, keyFor(year, dayLabel, slotId));
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as Placement) : undefined;
}

export async function upsertPlacementPatch(
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
  patch: PlacementPatch
): Promise<void> {
  const ref = placementDoc(userId, keyFor(year, dayLabel, slotId));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? (snap.data() as Placement) : undefined;
    const merged = mergePlacement(existing, userId, year, dayLabel, slotId, patch);

    if (!merged) {
      if (snap.exists()) tx.delete(ref);
    } else {
      tx.set(ref, merged, { merge: false });
    }
  });

  window.dispatchEvent(new Event("placements-changed"));
}

export async function setPlacement(
  userId: string,
  year: number,
  dayLabel: DayLabel,
  slotId: SlotId,
  next: PlacementPatch
): Promise<void> {
  const ref = placementDoc(userId, keyFor(year, dayLabel, slotId));
  const n = normaliseNext(next);

  const p: Placement = {
    key: keyFor(year, dayLabel, slotId),
    userId,
    year,
    dayLabel,
    slotId,
  };
  if (Object.prototype.hasOwnProperty.call(n, "subjectId")) p.subjectId = n.subjectId;
  if (Object.prototype.hasOwnProperty.call(n, "roomOverride")) p.roomOverride = n.roomOverride;

  const hasSubjectOverride = Object.prototype.hasOwnProperty.call(p, "subjectId");
  const hasRoomOverride = Object.prototype.hasOwnProperty.call(p, "roomOverride");

  if (!hasSubjectOverride && !hasRoomOverride) {
    await deleteDoc(ref);
  } else {
    await runTransaction(db, async (tx) => {
      tx.set(ref, p, { merge: false });
    });
  }

  window.dispatchEvent(new Event("placements-changed"));
}

export async function deletePlacement(userId: string, dayLabel: DayLabel, slotId: SlotId): Promise<void> {
  await deleteDoc(placementDoc(userId, keyFor(year, dayLabel, slotId)));
  window.dispatchEvent(new Event("placements-changed"));
}

export async function deletePlacementsReferencingSubject(userId: string, subjectId: string): Promise<void> {
  const col = placementsCol(userId);
  const q = query(col, where("subjectId", "==", subjectId));
  const snap = await getDocs(q);
  for (const d of snap.docs) await deleteDoc(d.ref);
  window.dispatchEvent(new Event("placements-changed"));
}
