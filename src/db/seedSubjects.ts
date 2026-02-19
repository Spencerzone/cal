// src/db/seedSubjects.ts (Firestore-backed)

import { getDoc, getDocs, setDoc } from "firebase/firestore";
import type { Subject } from "./db";
import { subjectDoc, subjectsCol, type CycleTemplateEvent } from "./db";
import {
  autoHexColorForKey,
  LEGACY_DUTY_SUBJECT_ID,
  subjectIdForManual,
  subjectIdForTemplateEvent,
  subjectKindForTemplateEvent,
} from "./subjectUtils";
import { getAllCycleTemplateEvents } from "./templateQueries";

export async function ensureSubjectsFromTemplates(userId: string): Promise<void> {
  const template = await getAllCycleTemplateEvents(userId);
  if (!template.length) return;

  const existingSnap = await getDocs(subjectsCol(userId));
  const existingById = new Map(existingSnap.docs.map((d) => [d.id, d.data() as any]));
  const existingIds = new Set(existingById.keys());

  const needed = new Map<string, Subject>();

  for (const e of template) {
    const id = subjectIdForTemplateEvent(e);
    const kind = subjectKindForTemplateEvent(e);

    if (!id) continue;
    if (id === LEGACY_DUTY_SUBJECT_ID) continue;

    if (existingIds.has(id)) continue;
    if (needed.has(id)) continue;

    // If the template event now has a code-based ID, but an older title-based
    // subject exists (from earlier imports), copy its colour to the new subject
    // to keep the UI consistent.
    let inheritedColor: string | null = null;
    if (kind === "subject" && id.startsWith("code::")) {
      const titleOnly = e.title.replace(/\s*\([^()]+\)\s*$/, "").trim();
      const legacyTitleId = subjectIdForManual("subject", null, titleOnly);
      const legacy = existingById.get(legacyTitleId) as Subject | undefined;
      if (legacy?.color) inheritedColor = legacy.color;
    }

    needed.set(id, {
      id,
      userId,
      kind,
      code: e.code ? e.code.trim().toUpperCase() : null,
      title: e.title,
      color: inheritedColor ?? autoHexColorForKey(id),
    });
  }

  for (const s of needed.values()) {
    await setDoc(subjectDoc(userId, s.id), s, { merge: false });
  }

  if (needed.size) window.dispatchEvent(new Event("subjects-changed"));
}
