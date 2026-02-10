// src/ics/importIcs.ts
import { getDb } from "../db/db";
import { parseIcsToBaseEvents, hashString } from "./parseIcs";
import { buildCycleTemplateFromIcs } from "../rolling/buildTemplateFromIcs";
import { buildDraftSlotAssignments } from "../rolling/buildSlotAssignments";


export async function importIcs(icsText: string, icsName: string) {
  const db = await getDb();
  const importId = `${Date.now()}`;
  const icsHash = hashString(icsText);

  const parsed = parseIcsToBaseEvents(icsText, importId);

  const tx = db.transaction(["baseEvents", "imports"], "readwrite");
  await tx.objectStore("imports").put({
    importId,
    importedAt: Date.now(),
    icsName,
    icsHash,
  });

  await buildCycleTemplateFromIcs(icsText);
  await buildDraftSlotAssignments();


  // Mark all existing base events as "not seen" first (soft approach)
  // We’ll set active=true for any seen in this import, and after loop we can deactivate unseen.
  // Efficient approach: iterate cursor instead of loading all for large DBs.
  const store = tx.objectStore("baseEvents");
  let cursor = await store.openCursor();
  while (cursor) {
    const v = cursor.value;
    // only flip to inactive AFTER we finish inserting/updating; for now tag unseen
    v.lastSeenImportId = v.lastSeenImportId; // keep
    v.active = v.active; // keep
    await cursor.update(v);
    cursor = await cursor.continue();
  }

  // Upsert parsed events. User meta is separate store, untouched.
  for (const ev of parsed) {
    const existing = await store.get(ev.id);
    if (!existing) {
      await store.put(ev);
      continue;
    }

    // If unchanged, just refresh lastSeenImportId/active
    if (existing.sourceHash === ev.sourceHash) {
      existing.lastSeenImportId = importId;
      existing.active = true;
      await store.put(existing);
      continue;
    }

    // Changed event: overwrite base fields, keep id stable
    await store.put({
      ...existing,
      ...ev,
      id: existing.id,
      lastSeenImportId: importId,
      active: true,
    });
  }

  // Deactivate events not seen in this import (soft delete)
  cursor = await store.openCursor();
  while (cursor) {
    const v = cursor.value;
    if (v.lastSeenImportId !== importId) {
      v.active = false;
      await cursor.update(v);
    }
    cursor = await cursor.continue();
  }

  await tx.done;
  return { importId, count: parsed.length };
}
