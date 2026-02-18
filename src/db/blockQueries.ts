// src/db/blockQueries.ts (Firestore-backed)

import { getDocs, orderBy, query, where } from "firebase/firestore";
import type { Block } from "./db";
import { blocksCol } from "./db";

export async function getVisibleBlocks(userId: string): Promise<Block[]> {
  const q = query(
    blocksCol(userId),
    where("userId", "==", userId),
    where("isVisible", "==", 1),
    orderBy("orderIndex", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Block);
}

export async function getAllBlocks(userId: string): Promise<Block[]> {
  const q = query(blocksCol(userId), where("userId", "==", userId), orderBy("orderIndex", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Block);
}
