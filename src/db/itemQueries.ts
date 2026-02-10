// src/db/itemQueries.ts
import { getDb, type Item, type ItemType } from "./db";

export async function upsertItem(item: Item): Promise<void> {
  const db = await getDb();
  await db.put("items", item);
}

export async function getItemsByUser(userId: string): Promise<Item[]> {
  const db = await getDb();
  return db.getAllFromIndex("items", "byUserId", userId);
}

// Stable key helper: store templateEventId in metaJson for now
export function makeTemplateItemId(userId: string, templateEventId: string) {
  return `${userId}::tpl::${templateEventId}`;
}

export function makeItem(
  userId: string,
  id: string,
  type: ItemType,
  title: string,
  color: string,
  location?: string,
  meta?: any
): Item {
  return {
    id,
    userId,
    type,
    title,
    location,
    color,
    metaJson: meta ? JSON.stringify(meta) : undefined,
  };
}