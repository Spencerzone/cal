// src/db/lessonPlanQueries.ts (Firestore-only; attachments disabled)

import {
  deleteDoc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { lessonAttachmentsCol, lessonAttachmentDoc, lessonPlanDoc, lessonPlansCol } from "./db";
import type { LessonAttachment, LessonPlan, SlotId } from "./db";

function planKeyFor(dateKey: string, slotId: SlotId) {
  return `${dateKey}::${slotId}`;
}

export async function getLessonPlansForDate(userId: string, dateKey: string): Promise<LessonPlan[]> {
  const snap = await getDocs(query(lessonPlansCol(userId), where("dateKey", "==", dateKey)));
  return snap.docs.map((d) => d.data() as LessonPlan);
}

export async function upsertLessonPlan(
  userId: string,
  dateKey: string,
  slotId: SlotId,
  html: string
): Promise<void> {
  const key = planKeyFor(dateKey, slotId);
  const trimmed = html.trim();

  if (!trimmed) {
    await deleteLessonPlan(userId, dateKey, slotId);
    window.dispatchEvent(new Event("lessonplans-changed"));
    return;
  }

  const plan: LessonPlan = {
    key,
    userId,
    dateKey,
    slotId,
    html,
    updatedAt: Date.now(),
  };

  await setDoc(lessonPlanDoc(userId, key), plan, { merge: false });
  window.dispatchEvent(new Event("lessonplans-changed"));
}

export async function deleteLessonPlan(userId: string, dateKey: string, slotId: SlotId): Promise<void> {
  const key = planKeyFor(dateKey, slotId);

  // Delete any attachment metadata docs (if they exist from earlier experiments)
  const snap = await getDocs(query(lessonAttachmentsCol(userId), where("planKey", "==", key)));
  for (const d of snap.docs) {
    await deleteDoc(d.ref);
  }

  await deleteDoc(lessonPlanDoc(userId, key));
}

export async function getAttachmentsForPlan(_userId: string, _planKey: string): Promise<LessonAttachment[]> {
  // Attachments disabled (no Firebase Storage).
  return [];
}

export async function addAttachmentToPlan(_userId: string, _planKey: string, _file: File): Promise<void> {
  // Attachments disabled (no Firebase Storage).
  throw new Error("Attachments are disabled (Firebase Storage not enabled).");
}

export async function deleteAttachment(userId: string, id: string): Promise<void> {
  // Delete metadata doc if it exists
  await deleteDoc(lessonAttachmentDoc(userId, id));
  window.dispatchEvent(new Event("lessonplans-changed"));
}