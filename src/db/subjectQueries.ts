// src/db/subjectQueries.ts
import { getDb, type Subject } from "./db";
import { makeCanonicalItemId, makeItem, upsertItem } from "./itemQueries";
import { deletePlacementsReferencingSubject } from "./placementQueries";

export async function getSubjectsByUser(userId: string): Promise<Subject[]> {
  const db = await getDb();
  return db.getAllFromIndex("subjects", "byUserId", userId);
}

export async function upsertSubject(subject: Subject): Promise<void> {
  const db = await getDb();
  // Ensure code is stored consistently (ids are already canonicalised by seeding/migration).
  const normalised = {
    ...subject,
    code: subject.code && subject.code.trim() ? subject.code.trim().toUpperCase() : null,
    title: subject.title.trim(),
  };

  await db.put("subjects", normalised);

  // Sync to Items so Week/Today/Matrix update.
  // Only do this when there's a code (stable identity).
  if (normalised.code) {
    const itemId = makeCanonicalItemId(normalised.userId, "class", normalised.code, normalised.title);

    await upsertItem(
      makeItem(
        normalised.userId,
        itemId,
        "class",
        normalised.title,
        normalised.color,
        undefined,
        { code: normalised.code }
      )
    );
  }

  // Notify open pages to reload subjects.
  window.dispatchEvent(new Event("subjects-changed"));
}

export async function deleteSubject(userId: string, subjectId: string): Promise<void> {
  const db = await getDb();
  await db.delete("subjects", subjectId);
  // Remove any matrix placements that reference this subject.
  await deletePlacementsReferencingSubject(userId, subjectId);
  window.dispatchEvent(new Event("subjects-changed"));
}