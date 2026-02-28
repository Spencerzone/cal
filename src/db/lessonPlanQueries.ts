// src/db/lessonPlanQueries.ts (Firestore-only; attachments disabled)

import {
  deleteDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  lessonAttachmentsCol,
  lessonAttachmentDoc,
  lessonPlanDoc,
  lessonPlansCol,
} from "./db";
import type { LessonAttachment, LessonPlan, SlotId } from "./db";

function planKeyFor(dateKey: string, slotId: SlotId) {
  return `${dateKey}::${slotId}`;
}

export async function getLessonPlansForDate(
  userId: string,
  year: number,
  dateKey: string,
): Promise<LessonPlan[]> {
  const snap = await getDocs(
    query(
      lessonPlansCol(userId),
      where("dateKey", "==", dateKey),
      where("year", "==", year),
    ),
  );
  return snap.docs.map((d) => d.data() as LessonPlan);
}

export async function upsertLessonPlan(
  userId: string,
  year: number,
  dateKey: string,
  slotId: SlotId,
  html: string | undefined | null,
): Promise<void> {
  const key = planKeyFor(dateKey, slotId);
  const trimmed = (html ?? "").trim();

  if (!trimmed) {
    await deleteLessonPlan(userId, year, dateKey, slotId);
    window.dispatchEvent(new Event("lessonplans-changed"));
    return;
  }

  const plan: LessonPlan = {
    year,
    key,
    userId,
    dateKey,
    slotId,
    html: html ?? "",
    updatedAt: Date.now(),
  };

  await setDoc(lessonPlanDoc(userId, key), plan, { merge: false });
  window.dispatchEvent(new Event("lessonplans-changed"));
}

export async function deleteLessonPlan(
  userId: string,
  year: number,
  dateKey: string,
  slotId: SlotId,
): Promise<void> {
  const key = planKeyFor(dateKey, slotId);

  // Delete any attachment metadata docs (if they exist from earlier experiments)
  const snap = await getDocs(
    query(
      lessonAttachmentsCol(userId),
      where("planKey", "==", key),
      where("year", "==", year),
    ),
  );
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
  }

  await deleteDoc(lessonPlanDoc(userId, key));
}

export async function getAttachmentsForPlan(
  _userId: string,
  year: number,
  _planKey: string,
): Promise<LessonAttachment[]> {
  const snap = await getDocs(
    query(
      lessonAttachmentsCol(_userId),
      where("planKey", "==", _planKey),
      where("year", "==", year),
    ),
  );
  const out = snap.docs.map((d) => {
    const data = d.data() as LessonAttachment;
    return { ...data, id: data.id || d.id };
  });
  out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return out;
}

export async function addAttachmentToPlan(
  _userId: string,
  _planKey: string,
  _file: File,
): Promise<void> {
  // Attachments disabled (no Firebase Storage).
  throw new Error("Attachments are disabled (Firebase Storage not enabled).");
}

function normaliseUrl(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  // If it already has a scheme, keep it.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return s;
  return `https://${s}`;
}

export async function addUrlAttachmentToPlan(
  userId: string,
  planKey: string,
  name: string,
  url: string,
): Promise<void> {
  const id = `url_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const normUrl = normaliseUrl(url);
  const display = (name ?? "").trim() || normUrl;

  const att: LessonAttachment = {
    id,
    userId,
    planKey,
    kind: "url",
    name: display,
    url: normUrl,
    // Keep legacy fields present to avoid any older render assumptions.
    mime: "text/url",
    size: 0,
    storagePath: "",
    createdAt: Date.now(),
  };

  await setDoc(lessonAttachmentDoc(userId, id), att, { merge: false });
  window.dispatchEvent(new Event("lessonplans-changed"));
}

export async function updateUrlAttachment(
  userId: string,
  id: string,
  patch: { name?: string; url?: string },
): Promise<void> {
  const next: any = {};
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.url !== undefined) next.url = normaliseUrl(patch.url);
  await updateDoc(lessonAttachmentDoc(userId, id), next);
  window.dispatchEvent(new Event("lessonplans-changed"));
}

export async function deleteAttachment(
  userId: string,
  id: string,
): Promise<void> {
  // Delete metadata doc if it exists
  await deleteDoc(lessonAttachmentDoc(userId, id));
  window.dispatchEvent(new Event("lessonplans-changed"));
}
