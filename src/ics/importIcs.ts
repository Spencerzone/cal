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
} from "../db/db";
import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
import { safeDocId } from "../db/subjectQueries";

export async function importIcs(
  userId: string,
  year: number,
  icsText: string,
  icsName: string,
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

  await buildCycleTemplateFromIcs(userId, year, icsText);
  // Only seed/update Subjects from the template as part of an explicit import.
  // Do NOT do this on page load, otherwise deleted/archived subjects will reappear.
  await ensureSubjectsFromTemplates(userId, year);
  await buildDraftSlotAssignments(userId, year);

  return { importId, count: parsed.length };
}
