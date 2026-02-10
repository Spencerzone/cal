// src/db/blockMutations.ts
import { nanoid } from "nanoid";
import { getDb, type Block, type BlockKind } from "./db";

export async function createBlock(userId: string, name: string, kind: BlockKind) {
  const db = await getDb();
  const existing = await db.getAllFromIndex("blocks", "byUserId", userId);
  const nextOrder = existing.length ? Math.max(...existing.map((b) => b.orderIndex)) + 1 : 0;

  const block: Block = {
    id: nanoid(),
    userId,
    name,
    kind,
    orderIndex: nextOrder,
    isVisible: 1,
  };

  await db.put("blocks", block);
  return block;
}

export async function updateBlock(block: Block) {
  const db = await getDb();
  await db.put("blocks", block);
}

export async function setBlockVisible(blockId: string, isVisible: 0 | 1) {
  const db = await getDb();
  const b = await db.get("blocks", blockId);
  if (!b) return;
  b.isVisible = isVisible;
  await db.put("blocks", b);
}

export async function reorderBlocks(userId: string, orderedIds: string[]) {
  const db = await getDb();
  const tx = db.transaction("blocks", "readwrite");
  const store = tx.store;

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const b = await store.get(id);
    if (!b || b.userId !== userId) continue;
    b.orderIndex = i;
    await store.put(b);
  }

  await tx.done;
}