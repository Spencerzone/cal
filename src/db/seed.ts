// db/seed.ts
import { nanoid } from "nanoid";
import { getDb, type Block, type BlockKind } from "./db";
import { SLOT_DEFS, type SlotId } from "../rolling/slots";

function kindForSlot(slotId: SlotId): BlockKind {
  if (slotId.startsWith("p")) return "class";
  if (slotId.startsWith("r") || slotId.startsWith("l")) return "break";
  if (slotId === "rc") return "admin";
  return "other";
}

export async function ensureDefaultBlocks(userId: string) {
  const db = await getDb();

  const existing = await db.getAllFromIndex("blocks", "byUserId", userId);
  if (existing.length > 0) return;

  const tx = db.transaction("blocks", "readwrite");

  SLOT_DEFS.forEach((s, orderIndex) => {
    const row: Block = {
      id: nanoid(),
      userId,
      name: s.label,          // EXACT match
      kind: kindForSlot(s.id),
      orderIndex,
      isVisible: 1,
    };
    tx.store.put(row);
  });

  await tx.done;
}