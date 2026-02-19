// src/db/seedSubjects.ts (Firestore-backed)

import { getDoc, getDocs, setDoc } from "firebase/firestore";
import type { Subject } from "./db";
import { subjectDoc, subjectsCol, type CycleTemplateEvent } from "./db";
import { autoHexColorForKey, LEGACY_DUTY_SUBJECT_ID, subjectIdForTemplateEvent, subjectKindForTemplateEvent } from "./subjectUtils";
import { getAllCycleTemplateEvents } from "./templateQueries";

export async function ensureSubjectsFromTemplates(userId: string): Promise<void> {
  const template = await getAllCycleTemplateEvents(userId);
  if (!template.length) return;

  const existingSnap = await getDocs(subjectsCol(userId));
  const existing = new Set(existingSnap.docs.map((d) => d.id));

  const needed = new Map<string, Subject>();

  for (const e of template) {
    const id = subjectIdForTemplateEvent(e);
    const kind = subjectKindForTemplateEvent(e);

    if (!id) continue;
    if (id === LEGACY_DUTY_SUBJECT_ID) continue;

    if (existing.has(id)) continue;
    if (needed.has(id)) continue;

    needed.set(id, {
      id,
      userId,
      kind,
      code: e.code ? e.code.trim().toUpperCase() : null,
      title: e.title,
      color: autoHexColorForKey(id),
      archived: false,
    });
  }

  for (const s of needed.values()) {
    await setDoc(subjectDoc(userId, s.id), s, { merge: false });
  }

  if (needed.size) window.dispatchEvent(new Event("subjects-changed"));
}
