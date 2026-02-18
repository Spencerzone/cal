// src/db/blockMutations.ts (Firestore-backed)

import { nanoid } from "nanoid";
import { deleteDoc, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { blockDoc, blocksCol, type Block, type BlockKind } from "./db";

export async function createBlock(userId: string, name: string, kind: BlockKind): Promise<void> {
  const id = nanoid();
  // find next orderIndex
  const snap = await getDocs(query(blocksCol(userId), where("userId", "==", userId)));
  const max = snap.docs.reduce((m, d) => Math.max(m, (d.data() as any).orderIndex ?? 0), -1);

  const row: Block = {
    id,
    userId,
    name: name.trim(),
    kind,
    orderIndex: max + 1,
    isVisible: 1,
  };

  const batch = writeBatch(db);
  batch.set(blockDoc(userId, id), row, { merge: false });
  await batch.commit();
  window.dispatchEvent(new Event("blocks-changed"));
}

export async function updateBlock(userId: string, id: string, patch: Partial<Pick<Block, "name" | "kind">>): Promise<void> {
  const ref = blockDoc(userId, id);
  const next: any = {};
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.kind !== undefined) next.kind = patch.kind;
  await updateDoc(ref, next);
  window.dispatchEvent(new Event("blocks-changed"));
}

export async function setBlockVisible(userId: string, id: string, isVisible: 0 | 1): Promise<void> {
  await updateDoc(blockDoc(userId, id), { isVisible });
  window.dispatchEvent(new Event("blocks-changed"));
}

export async function reorderBlocks(userId: string, orderedIds: string[]): Promise<void> {
  const batch = writeBatch(db);
  orderedIds.forEach((id, orderIndex) => {
    batch.update(blockDoc(userId, id), { orderIndex });
  });
  await batch.commit();
  window.dispatchEvent(new Event("blocks-changed"));
}

export async function deleteBlock(userId: string, id: string): Promise<void> {
  await deleteDoc(blockDoc(userId, id));
  window.dispatchEvent(new Event("blocks-changed"));
}
