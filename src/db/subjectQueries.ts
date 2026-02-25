// src/db/subjectQueries.ts (Firestore source-of-truth)

import { getDocs, query, setDoc } from "firebase/firestore";
import type { Subject } from "./db";
import { subjectDoc, subjectsCol } from "./db";

export async function getSubjectsByUser(userId: string, year: number): Promise<Subject[]> {
  const snap = await getDocs(query(subjectsCol(userId)));
  const out: Subject[] = [];
  for (const d of snap.docs) {
    const data = d.data() as any;
    const hydrated = { ...(data as Subject), id: (data?.id as string | undefined) ?? d.id } as Subject;
    const y = (hydrated as any).year;
    if (y === undefined) {
      // Backfill legacy docs into the active year
      hydrated.year = year;
      await setDoc(subjectDoc(userId, hydrated.id), { year }, { merge: true });
    }
    if ((hydrated.year ?? year) !== year) continue;
    if (hydrated.archived) continue;
    out.push(hydrated);
  }
  return out;
}

export async function getAllSubjectsByUser(userId: string, year?: number): Promise<Subject[]> {
  const snap = await getDocs(query(subjectsCol(userId)));
  const out: Subject[] = [];
  for (const d of snap.docs) {
    const data = d.data() as any;
    const hydrated = { ...(data as Subject), id: (data?.id as string | undefined) ?? d.id } as Subject;
    if (year !== undefined) {
      const y = (hydrated as any).year;
      if (y === undefined) {
        hydrated.year = year;
        await setDoc(subjectDoc(userId, hydrated.id), { year }, { merge: true });
      }
      if ((hydrated.year ?? year) !== year) continue;
    }
    out.push(hydrated);
  }
  return out;
}

export async function upsertSubject(subject: Subject): Promise<void> {
  const normalised: Subject = {
    ...subject,
    year: subject.year ?? new Date().getFullYear(),
    code: subject.code && subject.code.trim() ? subject.code.trim().toUpperCase() : null,
    title: subject.title.trim(),
  };

  await setDoc(subjectDoc(normalised.userId, normalised.id), normalised, { merge: true });
  window.dispatchEvent(new Event("subjects-changed"));
}

export async function deleteSubject(userId: string, subjectId: string): Promise<void> {
  // Soft delete (archive) so imports/templates don't immediately recreate subjects.
  await setDoc(subjectDoc(userId, subjectId), { archived: true }, { merge: true });
  window.dispatchEvent(new Event("subjects-changed"));
}

export async function restoreSubject(userId: string, subjectId: string): Promise<void> {
  await setDoc(subjectDoc(userId, subjectId), { archived: false }, { merge: true });
  window.dispatchEvent(new Event("subjects-changed"));
}
