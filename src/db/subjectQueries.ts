import { getDb, type Subject } from "./db";
import { upsertItem, makeItem, makeCanonicalItemId } from "./itemQueries";

export async function upsertSubject(subject: Subject): Promise<void> {
  const db = await getDb();
  await db.put("subjects", subject);

  // Sync to canonical Class Item so UI updates everywhere
  const itemId = makeCanonicalItemId(subject.userId, "class", subject.code, subject.title);

  const existing = await db.get("items", itemId);

  await upsertItem(
    makeItem(
      subject.userId,
      itemId,
      "class",
      subject.title,
      subject.color ?? existing?.color ?? "#888888",
      undefined,
      { code: subject.code }
    )
  );
}