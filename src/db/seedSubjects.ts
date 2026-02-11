// src/db/seedSubjects.ts
import { getDb, type Subject } from "./db";
import { autoHexColorForKey, DUTY_SUBJECT_ID, subjectIdForTemplateEvent, subjectKindForTemplateEvent } from "./subjectUtils";

export async function ensureSubjectsFromTemplates(userId: string) {
  const db = await getDb();
  const templates = await db.getAll("cycleTemplateEvents");

  // Load existing so we don't overwrite user edits
  const existing = await db.getAllFromIndex("subjects", "byUserId", userId);
  const existingById = new Map(existing.map((s) => [s.id, s]));

  const toUpsert: Subject[] = [];

  // Ensure single global Duty subject exists (even if templates have no duty yet)
  if (!existingById.has(DUTY_SUBJECT_ID)) {
    toUpsert.push({
      id: DUTY_SUBJECT_ID,
      userId,
      kind: "duty",
      code: null,
      title: "Duty",
      color: autoHexColorForKey(DUTY_SUBJECT_ID),
    });
  }

  for (const e of templates) {
    const id = subjectIdForTemplateEvent(e);
    if (existingById.has(id)) continue;

    const code = e.code?.trim() || null;

    toUpsert.push({
      id,
      userId,
      kind: subjectKindForTemplateEvent(e),
      code,
      title: code ? code : e.title, // initial title; user can rename later
      color: autoHexColorForKey(id),
    });
  }

  if (toUpsert.length === 0) return;

  const tx = db.transaction("subjects", "readwrite");
  for (const s of toUpsert) await tx.store.put(s);
  await tx.done;
}