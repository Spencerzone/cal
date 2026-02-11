// src/db/seedSubjects.ts
import { getDb, type Subject } from "./db";
import { autoHexColorForKey, subjectIdForTemplateEvent, subjectKindForTemplateEvent } from "./subjectUtils";

function normCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function ensureSubjectsFromTemplates(userId: string) {
  const db = await getDb();
  const templates = await db.getAll("cycleTemplateEvents");

  // Track desired subject ids from the current template set (used for cleanup of legacy ids).
  const desiredIds = new Set<string>(templates.map(subjectIdForTemplateEvent));

  // Load existing so we don't overwrite user edits
  const existing = await db.getAllFromIndex("subjects", "byUserId", userId);
  const existingById = new Map(existing.map((s) => [s.id, s]));

  // Also index existing by normalised code so we can migrate legacy ids (e.g. code casing changes).
  const existingByNormCode = new Map<string, Subject>();
  for (const s of existing) {
    if (s.code && s.code.trim()) existingByNormCode.set(normCode(s.code), s);
  }

  const toUpsert: Subject[] = [];

  for (const e of templates) {
    const id = subjectIdForTemplateEvent(e);

    // If the desired id already exists, do nothing.
    if (existingById.has(id)) continue;

    // If this is a code-based subject, try migrating a legacy subject record
    // (e.g. where old builds used different casing or a different id scheme).
    const rawCode = e.code?.trim() || null;
    const code = rawCode ? normCode(rawCode) : null;
    if (code) {
      const legacy = existingByNormCode.get(code);
      if (legacy && legacy.id !== id) {
        const tx = db.transaction("subjects", "readwrite");
        await tx.store.put({ ...legacy, id, code });
        await tx.store.delete(legacy.id);
        await tx.done;
        // Update local caches so we don't also create a fresh record.
        existingById.set(id, { ...legacy, id, code });
        continue;
      }
    }

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