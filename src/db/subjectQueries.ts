// src/db/subjectQueries.ts
import { getDb, type Subject } from "./db";

export async function getSubjectsByUser(userId: string): Promise<Subject[]> {
  const db = await getDb();
  return db.getAllFromIndex("subjects", "byUserId", userId);
}

export async function upsertSubject(subject: Subject): Promise<void> {
  const db = await getDb();
  await db.put("subjects", subject);
}