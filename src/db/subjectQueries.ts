// src/db/subjectQueries.ts (Firestore source-of-truth)

import { getDocs, query, setDoc } from "firebase/firestore";
import type { Subject } from "./db";
import { subjectDoc, subjectsCol } from "./db";

export async function getSubjectsByUser(userId: string): Promise<Subject[]> {
  const snap = await getDocs(query(subjectsCol(userId)));
  // Hide archived by default.
  return snap.docs
    .map((d) => d.data() as Subject)
    .filter((s) => !s.archived);
}

export async function upsertSubject(subject: Subject): Promise<void> {
  const normalised: Subject = {
    ...subject,
    code: subject.code && subject.code.trim() ? subject.code.trim().toUpperCase() : null,
    title: subject.title.trim(),
    archived: subject.archived ?? false,
  };

  await setDoc(subjectDoc(normalised.userId, normalised.id), normalised, { merge: true });
  window.dispatchEvent(new Event("subjects-changed"));
}

export async function deleteSubject(userId: string, subjectId: string): Promise<void> {
  // Soft-delete to prevent automatic re-creation from template seeding.
  await setDoc(subjectDoc(userId, subjectId), { archived: true } as any, { merge: true });
  window.dispatchEvent(new Event("subjects-changed"));
}
