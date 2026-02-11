// src/db/seedSubjects.ts
import { getDb, type Subject } from "./db";
import {
  autoHexColorForKey,
  LEGACY_DUTY_SUBJECT_ID,
  subjectIdForTemplateEvent,
  subjectKindForTemplateEvent,
} from "./subjectUtils";

export async function ensureSubjectsFromTemplates(userId: string) {
  const db = await getDb();
  const templates = await db.getAll("cycleTemplateEvents");

  const existing = await db.getAllFromIndex("subjects", "byUserId", userId);
  const existingById = new Map(existing.map((s) => [s.id, s]));

  const tx = db.transaction("subjects", "readwrite");

  // 1) Remove legacy single-duty subject if present.
  if (existingById.has(LEGACY_DUTY_SUBJECT_ID)) {
    await tx.store.delete(LEGACY_DUTY_SUBJECT_ID);
  }

  // 2) Migrate legacy code casing: any `code::<something>` should be uppercased.
  // Preserve user edits (title/color) when migrating.
  for (const s of existing) {
    if (!s.id.startsWith("code::")) continue;
    const raw = s.id.slice("code::".length);
    const upper = raw.trim().toUpperCase();
    const canonicalId = `code::${upper}`;
    if (s.id === canonicalId) continue;

    // If canonical already exists, prefer the canonical and drop the legacy.
    if (!existingById.has(canonicalId)) {
      await tx.store.put({ ...s, id: canonicalId, code: upper });
    }
    await tx.store.delete(s.id);
  }

  // Refresh map after migration
  const afterMigration = await tx.store.index("byUserId").getAll(userId);
  const byId = new Map(afterMigration.map((s) => [s.id, s]));

  // 3) Ensure subjects exist for all template events without overwriting edits.
  for (const e of templates) {
    const id = subjectIdForTemplateEvent(e);
    if (byId.has(id)) continue;

    const code = e.code?.trim() ? e.code.trim().toUpperCase() : null;
    const kind = subjectKindForTemplateEvent(e);

    // Default titles: for code-based classes use code; for duties use duty area; for breaks/title use title.
    let title = code ? code : e.title;
    if (kind === "duty") title = (e.room?.trim() || e.title).trim();

    const s: Subject = {
      id,
      userId,
      kind,
      code,
      title,
      color: autoHexColorForKey(id),
    };

    await tx.store.put(s);
  }

  await tx.done;
}
