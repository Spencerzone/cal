// src/db/seedSubjects.ts
import { getDb, type Subject } from "./db";
import { autoHexColorForKey, subjectIdForTemplateEvent, subjectKindForTemplateEvent } from "./subjectUtils";

export async function ensureSubjectsFromTemplates(userId: string) {
  const db = await getDb();
  const templates = await db.getAll("cycleTemplateEvents");

  // Track desired subject ids from the current template set (used for cleanup of legacy ids).
  const desiredIds = new Set<string>(templates.map(subjectIdForTemplateEvent));

  // Load existing so we don't overwrite user edits
  const existing = await db.getAllFromIndex("subjects", "byUserId", userId);
  const existingById = new Map(existing.map((s) => [s.id, s]));

  const toUpsert: Subject[] = [];

  for (const e of templates) {
    const id = subjectIdForTemplateEvent(e);
    if (existingById.has(id)) continue;

    const code = e.code?.trim() || null;

    const kind = subjectKindForTemplateEvent(e);
    const initialTitle =
      kind === "duty" ? (e.room?.trim() || e.title) : (code ? code : e.title);

    toUpsert.push({
      id,
      userId,
      kind,
      code,
      title: initialTitle,
      color: autoHexColorForKey(id),
    });
  }

  const tx = db.transaction("subjects", "readwrite");

  // Upsert any newly discovered subjects.
  for (const s of toUpsert) await tx.store.put(s);

  // Cleanup: remove the legacy single-duty subject if it exists.
  // Older builds used a global id of "duty"; duty subjects are now per area (e.g. "duty::covered area").
  if (!desiredIds.has("duty")) {
    await tx.store.delete("duty");
  }
  await tx.done;
}