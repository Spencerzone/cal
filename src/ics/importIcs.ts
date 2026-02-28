// src/ics/importIcs.ts (Firestore source-of-truth)

import { getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { parseIcsToBaseEvents, hashString } from "./parseIcs";
import { buildCycleTemplateFromIcs } from "../rolling/buildTemplateFromIcs";
import { buildDraftSlotAssignments } from "../rolling/buildSlotAssignments";
import {
  baseEventDoc,
  baseEventsCol,
  importDoc,
  type ImportRow,
  cycleTemplateEventsCol,
} from "../db/db";
import { ensureSubjectsFromTemplates } from "../db/seedSubjects";

export type ImportMode = "merge" | "replace";
export type ImportOptions = { mode?: ImportMode };

export async function importIcs(
  userId: string,
  year: number,
  icsText: string,
  icsName: string,
  options: ImportOptions = {},
) {
  const importId = `${Date.now()}`;
  const icsHash = hashString(icsText);

  const parsed = parseIcsToBaseEvents(icsText, importId);

  const imp: ImportRow = {
    importId,
    importedAt: Date.now(),
    icsName,
    icsHash,
  };
  await setDoc(importDoc(userId, importId), imp, { merge: false });

  const CHUNK = 400;

  for (let i = 0; i < parsed.length; i += CHUNK) {
    const chunk = parsed.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const ev of chunk)
      batch.set(baseEventDoc(userId, ev.id), ev, { merge: true });
    await batch.commit();
  }

  const activeSnap = await getDocs(
    query(baseEventsCol(userId), where("active", "==", true)),
  );
  const unseen: string[] = [];
  for (const d of activeSnap.docs) {
    const ev = d.data() as any;
    if (ev.lastSeenImportId !== importId) unseen.push(d.id);
  }

  for (let i = 0; i < unseen.length; i += CHUNK) {
    const chunk = unseen.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const id of chunk)
      batch.set(baseEventDoc(userId, id), { active: false }, { merge: true });
    await batch.commit();
  }

  // If replacing the template for this year, clear existing template events first.
  // This prevents duplicate template rows when ICS exports regenerate UIDs.
  if ((options.mode ?? "replace") === "replace") {
    const tplSnap = await getDocs(
      query(cycleTemplateEventsCol(userId), where("year", "==", year)),
    );
    if (!tplSnap.empty) {
      const batch = writeBatch(db);
      let n = 0;
      for (const d of tplSnap.docs) {
        batch.delete(d.ref);
        n++;
        // Firestore write batch limit is 500 operations
        if (n >= 450) {
          await batch.commit();
          n = 0;
        }
      }
      if (n > 0) await batch.commit();
    }
  }

  await buildCycleTemplateFromIcs(userId, year, icsText);
  // Only seed/update Subjects from the template as part of an explicit import.
  // Do NOT do this on page load, otherwise deleted/archived subjects will reappear.
  await ensureSubjectsFromTemplates(userId, year);
  await buildDraftSlotAssignments(userId, year);

  return { importId, count: parsed.length };
}
