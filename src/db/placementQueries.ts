// src/db/placementQueries.ts
import { getDb, type DayLabel, type Placement, type SlotId } from "./db";

function keyFor(dayLabel: DayLabel, slotId: SlotId) {
  return `${dayLabel}::${slotId}`;
}

export type PlacementPatch = {
  // subjectId semantics: undefined=use template, null=blank, string=override
  subjectId?: string | null;
  // roomOverride semantics: undefined=use template room, null=blank room, string=override
  roomOverride?: string | null;
};

function normaliseNext(next: PlacementPatch): PlacementPatch {
  const out: PlacementPatch = {};
  if (Object.prototype.hasOwnProperty.call(next, "subjectId")) out.subjectId = next.subjectId;
  if (Object.prototype.hasOwnProperty.call(next, "roomOverride")) out.roomOverride = next.roomOverride;
  return out;
}

export async function getPlacementsForDayLabels(userId: string, dayLabels: DayLabel[]): Promise<Placement[]> {
  const db = await getDb();
  const tx = db.transaction("placements");
  const idx = tx.store.index("byUserIdDayLabel");

  const out: Placement[] = [];
  for (const dl of dayLabels) {
    const rows = await idx.getAll([userId, dl]);
    out.push(...rows);
  }
  await tx.done;
  return out;
}

export async function getPlacement(dayLabel: DayLabel, slotId: SlotId): Promise<Placement | undefined> {
  const db = await getDb();
  return db.get("placements", keyFor(dayLabel, slotId));
}

function mergePlacement(existing: Placement | undefined, userId: string, dayLabel: DayLabel, slotId: SlotId, patch: PlacementPatch): Placement | null {
  const next: Placement = {
    key: keyFor(dayLabel, slotId),
    userId,
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

export async function upsertPlacementPatch(
  userId: string,
  dayLabel: DayLabel,
  slotId: SlotId,
  patch: PlacementPatch
): Promise<void> {
  const db = await getDb();
  const existing = await db.get("placements", keyFor(dayLabel, slotId));
  const merged = mergePlacement(existing, userId, dayLabel, slotId, patch);
  if (!merged) {
    await db.delete("placements", keyFor(dayLabel, slotId));
  } else {
    await db.put("placements", merged);
  }
  window.dispatchEvent(new Event("placements-changed"));
}

// Set the exact override state for this cell (clear fields by omitting them).
export async function setPlacement(
  userId: string,
  dayLabel: DayLabel,
  slotId: SlotId,
  next: PlacementPatch
): Promise<void> {
  const db = await getDb();
  const n = normaliseNext(next);
  const p: Placement = {
    key: keyFor(dayLabel, slotId),
    userId,
    dayLabel,
    slotId,
  };
  if (Object.prototype.hasOwnProperty.call(n, "subjectId")) p.subjectId = n.subjectId;
  if (Object.prototype.hasOwnProperty.call(n, "roomOverride")) p.roomOverride = n.roomOverride;

  const hasSubjectOverride = Object.prototype.hasOwnProperty.call(p, "subjectId");
  const hasRoomOverride = Object.prototype.hasOwnProperty.call(p, "roomOverride");

  if (!hasSubjectOverride && !hasRoomOverride) {
    await db.delete("placements", p.key);
  } else {
    await db.put("placements", p);
  }
  window.dispatchEvent(new Event("placements-changed"));
}

export async function deletePlacement(dayLabel: DayLabel, slotId: SlotId): Promise<void> {
  const db = await getDb();
  await db.delete("placements", keyFor(dayLabel, slotId));
  window.dispatchEvent(new Event("placements-changed"));
}

export async function deletePlacementsReferencingSubject(userId: string, subjectId: string): Promise<void> {
  const db = await getDb();
  const all = await db.getAllFromIndex("placements", "byUserId", userId);
  for (const p of all) {
    if (p.subjectId === subjectId) {
      await db.delete("placements", p.key);
    }
  }
  window.dispatchEvent(new Event("placements-changed"));
}
