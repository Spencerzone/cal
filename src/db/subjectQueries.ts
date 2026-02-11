// src/db/subjectQueries.ts
import { getDb, type Subject } from "./db";
import { makeCanonicalItemId, makeItem, upsertItem } from "./itemQueries";

export async function getSubjectsByUser(userId: string): Promise<Subject[]> {
  const db = await getDb();
  return db.getAllFromIndex("subjects", "byUserId", userId);
}

export async function upsertSubject(subject: Subject): Promise<void> {
  const db = await getDb();
  await db.put("subjects", subject);

  // Sync to Items so Week/Today/Matrix update.
  // Only do this when there's a code (stable identity).
  if (subject.code && subject.code.trim()) {
    const itemId = makeCanonicalItemId(subject.userId, "class", subject.code, subject.title);

    await upsertItem(
      makeItem(
        subject.userId,
        itemId,
        "class",
        subject.title,
        subject.color,
        undefined,
        { code: subject.code }
      )
    );
  }
}