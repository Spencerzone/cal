// src/db/placementQueries.ts
import { getDb, type DayLabel, type Placement, type SlotId } from "./db";

function keyFor(dayLabel: DayLabel, slotId: SlotId) {
  return `${dayLabel}::${slotId}`;
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

export async function getPlacement(userId: string, dayLabel: DayLabel, slotId: SlotId): Promise<Placement | undefined> {
  const db = await getDb();
  return db.get("placements", keyFor(dayLabel, slotId));
}

export async function upsertPlacement(
  userId: string,
  dayLabel: DayLabel,
  slotId: SlotId,
  subjectId: string | null
): Promise<void> {
  const db = await getDb();
  const p: Placement = {
    key: keyFor(dayLabel, slotId),
    userId,
    dayLabel,
    slotId,
    subjectId,
  };
  await db.put("placements", p);
  window.dispatchEvent(new Event("placements-changed"));
}

export async function deletePlacement(dayLabel: DayLabel, slotId: SlotId): Promise<void> {
  const db = await getDb();
  await db.delete("placements", keyFor(dayLabel, slotId));
  window.dispatchEvent(new Event("placements-changed"));
}
