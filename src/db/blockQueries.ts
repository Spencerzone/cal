// src/db/blockQueries.ts (Firestore-backed)

import { getDocs, orderBy, query } from "firebase/firestore";
import type { Block } from "./db";
import { blocksCol } from "./db";

export async function getVisibleBlocks(userId: string): Promise<Block[]> {
  // Documents are already scoped to users/{uid}/blocks.
  // Avoid composite-index requirements (where + orderBy) by filtering client-side.
  const q = query(blocksCol(userId), orderBy("orderIndex", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Block).filter((b) => b.isVisible === 1);
}

export async function getAllBlocks(userId: string): Promise<Block[]> {
  // Documents are already scoped to users/{uid}/blocks.
  const q = query(blocksCol(userId), orderBy("orderIndex", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Block);
}
