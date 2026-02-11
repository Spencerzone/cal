// src/db/lessonPlanQueries.ts
import { getDb, type LessonAttachment, type LessonPlan, type SlotId } from "./db";

function planKeyFor(dateKey: string, slotId: SlotId) {
  return `${dateKey}::${slotId}`;
}

export async function getLessonPlansForDate(userId: string, dateKey: string): Promise<LessonPlan[]> {
  const db = await getDb();
  const tx = db.transaction("lessonPlans");
  const idx = tx.store.index("byUserIdDateKey");
  const rows = await idx.getAll([userId, dateKey]);
  await tx.done;
  return rows;
}

export async function upsertLessonPlan(
  userId: string,
  dateKey: string,
  slotId: SlotId,
  html: string
): Promise<void> {
  const db = await getDb();
  const key = planKeyFor(dateKey, slotId);
  const trimmed = html.trim();

  if (!trimmed) {
    // Delete plan and attachments if the plan is emptied.
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
  await db.put("lessonPlans", plan);
  window.dispatchEvent(new Event("lessonplans-changed"));
}

export async function deleteLessonPlan(userId: string, dateKey: string, slotId: SlotId): Promise<void> {
  const db = await getDb();
  const key = planKeyFor(dateKey, slotId);

  // Remove attachments for this plan.
  const tx = db.transaction("lessonAttachments", "readwrite");
  const idx = tx.store.index("byPlanKey");
  const atts = await idx.getAll(key);
  for (const a of atts) await tx.store.delete(a.id);
  await tx.done;

  await db.delete("lessonPlans", key);
}

export async function getAttachmentsForPlan(planKey: string): Promise<LessonAttachment[]> {
  const db = await getDb();
  const tx = db.transaction("lessonAttachments");
  const idx = tx.store.index("byPlanKey");
  const rows = await idx.getAll(planKey);
  await tx.done;
  return rows;
}

export async function addAttachmentToPlan(
  userId: string,
  planKey: string,
  file: File
): Promise<void> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const att: LessonAttachment = {
    id,
    userId,
    planKey,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    blob: file,
    createdAt: Date.now(),
  };
  await db.put("lessonAttachments", att);
  window.dispatchEvent(new Event("lessonplans-changed"));
}

export async function deleteAttachment(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("lessonAttachments", id);
  window.dispatchEvent(new Event("lessonplans-changed"));
}
