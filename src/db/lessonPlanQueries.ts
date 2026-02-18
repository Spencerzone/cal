// src/db/lessonPlanQueries.ts (Firestore + Firebase Storage)

import { deleteDoc, getDoc, getDocs, query, setDoc, where, writeBatch } from "firebase/firestore";
import { deleteObject, getDownloadURL, getStorage, ref as storageRef, uploadBytes } from "firebase/storage";
import { db } from "../firebase";
import {
  lessonAttachmentDoc,
  lessonAttachmentsCol,
  lessonPlanDoc,
  lessonPlansCol,
  type LessonAttachment,
  type LessonPlan,
  type SlotId,
} from "./db";

function planKeyFor(dateKey: string, slotId: SlotId) {
  return `${dateKey}::${slotId}`;
}

function attachmentStoragePath(userId: string, attachmentId: string, filename: string) {
  const safe = filename.replaceAll("/", "_");
  return `users/${userId}/attachments/${attachmentId}/${safe}`;
}

export async function getLessonPlansForDate(userId: string, dateKey: string): Promise<LessonPlan[]> {
  const snap = await getDocs(query(lessonPlansCol(userId), where("dateKey", "==", dateKey)));
  return snap.docs.map((d) => d.data() as LessonPlan);
}

export async function upsertLessonPlan(userId: string, dateKey: string, slotId: SlotId, html: string): Promise<void> {
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

  const atts = await getAttachmentsForPlan(userId, key);
  const storage = getStorage();

  for (const a of atts) {
    try {
      await deleteObject(storageRef(storage, a.storagePath));
    } catch {
      // ignore
    }
  }

  if (atts.length) {
    const batch = writeBatch(db);
    for (const a of atts) batch.delete(lessonAttachmentDoc(userId, a.id));
    await batch.commit();
  }

  await deleteDoc(lessonPlanDoc(userId, key));
}

export async function getAttachmentsForPlan(userId: string, planKey: string): Promise<LessonAttachment[]> {
  const snap = await getDocs(query(lessonAttachmentsCol(userId), where("planKey", "==", planKey)));
  return snap.docs.map((d) => d.data() as LessonAttachment);
}

export async function addAttachmentToPlan(userId: string, planKey: string, file: File): Promise<void> {
  const id = crypto.randomUUID();
  const storage = getStorage();

  const path = attachmentStoragePath(userId, id, file.name);
  const sref = storageRef(storage, path);

  await uploadBytes(sref, file, { contentType: file.type || "application/octet-stream" });
  const url = await getDownloadURL(sref);

  const att: LessonAttachment = {
    id,
    userId,
    planKey,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    storagePath: path,
    downloadUrl: url,
    createdAt: Date.now(),
  };

  await setDoc(lessonAttachmentDoc(userId, id), att, { merge: false });
  window.dispatchEvent(new Event("lessonplans-changed"));
}

export async function deleteAttachment(userId: string, id: string): Promise<void> {
  const snap = await getDoc(lessonAttachmentDoc(userId, id));
  if (snap.exists()) {
    const att = snap.data() as LessonAttachment;
    const storage = getStorage();
    try {
      await deleteObject(storageRef(storage, att.storagePath));
    } catch {
      // ignore
    }
  }

  await deleteDoc(lessonAttachmentDoc(userId, id));
  window.dispatchEvent(new Event("lessonplans-changed"));
}
