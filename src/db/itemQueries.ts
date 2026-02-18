// src/db/itemQueries.ts (Firestore-backed; minimal)

import { getDocs, query, setDoc, where } from "firebase/firestore";
import { itemDoc, itemsCol, type Item, type ItemType } from "./db";

export function makeCanonicalItemId(userId: string, type: ItemType, code: string, title: string) {
  return `${userId}::${type}::${code.trim().toUpperCase()}`;
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
    color,
    location,
    metaJson: meta ? JSON.stringify(meta) : undefined,
  };
}

export async function upsertItem(item: Item): Promise<void> {
  await setDoc(itemDoc(item.userId, item.id), item, { merge: true });
  window.dispatchEvent(new Event("items-changed"));
}

export async function getItemsByUser(userId: string): Promise<Item[]> {
  const snap = await getDocs(query(itemsCol(userId), where("userId", "==", userId)));
  return snap.docs.map((d) => d.data() as Item);
}
