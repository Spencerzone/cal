// src/db/seed.ts (Firestore source-of-truth)

import { nanoid } from "nanoid";
import { getDocs, orderBy, query, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { blocksCol, blockDoc, type Block, type BlockKind } from "./db";
import { SLOT_DEFS, type SlotId } from "../rolling/slots";

function kindForSlot(slotId: SlotId): BlockKind {
  if (slotId.startsWith("p")) return "class";
  if (slotId.startsWith("r") || slotId.startsWith("l")) return "break";
  if (slotId === "rc") return "admin";
  return "other";
}

export async function ensureDefaultBlocks(userId: string) {
  const snap = await getDocs(query(blocksCol(userId), where("userId", "==", userId)));
  if (!snap.empty) return;

  const batch = writeBatch(db);
  SLOT_DEFS.forEach((s, orderIndex) => {
    const row: Block = {
      id: nanoid(),
      userId,
      name: s.label,
      kind: kindForSlot(s.id),
      orderIndex,
      isVisible: 1,
    };
    batch.set(blockDoc(userId, row.id), row, { merge: false });
  });
  await batch.commit();
}
