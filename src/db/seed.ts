// src/db/seed.ts
import { nanoid } from "nanoid";
import { getDb, type Block } from "./db";

const DEFAULT_BLOCKS: Array<Pick<Block, "name" | "kind" | "orderIndex">> = [
  { name: "Before school", kind: "other", orderIndex: 0 },
  { name: "Roll call", kind: "other", orderIndex: 1 },
  { name: "P1", kind: "class", orderIndex: 2 },
  { name: "P2", kind: "class", orderIndex: 3 },
  { name: "Recess 1", kind: "break", orderIndex: 4 },
  { name: "Recess 2", kind: "break", orderIndex: 5 },
  { name: "P3", kind: "class", orderIndex: 6 },
  { name: "P4", kind: "class", orderIndex: 7 },
  { name: "Lunch 1", kind: "break", orderIndex: 8 },
  { name: "Lunch 2", kind: "break", orderIndex: 9 },
  { name: "P5", kind: "class", orderIndex: 10 },
  { name: "P6", kind: "class", orderIndex: 11 },
  { name: "After school", kind: "other", orderIndex: 12 },
];

export async function ensureDefaultBlocks(userId: string) {
  const db = await getDb();

  // If any blocks exist for this user, do nothing
  const existing = await db.getAllFromIndex("blocks", "byUserId", userId);
  if (existing.length > 0) return;

  const rows: Block[] = DEFAULT_BLOCKS.map((b) => ({
    id: nanoid(),
    userId,
    name: b.name,
    kind: b.kind,
    orderIndex: b.orderIndex,
    isVisible: 1,
  }));

  const tx = db.transaction("blocks", "readwrite");
  for (const row of rows) {
    await tx.store.put(row);
  }
  await tx.done;
}