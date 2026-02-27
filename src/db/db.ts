// src/db/db.ts (Firestore source-of-truth)

import { collection, doc } from "firebase/firestore";
import { db } from "../firebase";
import type { BaseEvent } from "../ics/parseIcs";

/**
 * TYPES (kept)
 */

export type BlockKind = "class" | "break" | "duty" | "admin" | "other";

export interface UserEventMeta {
  eventId: string;
  hidden: boolean;
  colour: string | null;
  note: string | null;
}

export type ItemType = "class" | "duty" | "break" | "event" | "other";

export type Item = {
  id: string; // uuid
  userId: string;
  type: ItemType;
  title: string;
  location?: string;
  color: string;
  metaJson?: string;
};

export type Block = {
  id: string; // uuid
  userId: string;
  name: string;
  kind: BlockKind;
  orderIndex: number;
  isVisible: 0 | 1;
};

export type SubjectKind = "subject" | "duty" | "break" | "other";

export type Subject = {
  id: string;
  userId: string;
  year?: number;
  kind: SubjectKind;
  code: string | null;
  title: string;
  color: string;
  // Soft-delete flag. Archived subjects are hidden by default and will not be
  // auto-recreated during imports.
  archived?: boolean;
};

export type DayLabel =
  | "MonA"
  | "TueA"
  | "WedA"
  | "ThuA"
  | "FriA"
  | "MonB"
  | "TueB"
  | "WedB"
  | "ThuB"
  | "FriB";

export interface CycleTemplateEvent {
  id: string;
  year?: number;
  dayLabel: DayLabel;
  startMinutes: number;
  endMinutes: number;
  periodCode: string | null;
  type: "class" | "duty" | "break";
  code: string | null;
  title: string;
  room: string | null;
}

export interface ImportRow {
  importId: string;
  importedAt: number;
  icsName: string;
  icsHash: string;
}

export type SlotId =
  | "before"
  | "rc"
  | "p1"
  | "p2"
  | "r1"
  | "r2"
  | "p3"
  | "p4"
  | "l1"
  | "l2"
  | "p5"
  | "p6"
  | "after";

export type AssignmentKind = "class" | "duty" | "break" | "free";

export type SlotAssignment = {
  key: string;
  year: number;
  dayLabel: DayLabel;
  slotId: SlotId;
  kind: AssignmentKind;
  sourceTemplateEventId?: string;
  manualTitle?: string;
  manualCode?: string | null;
  manualRoom?: string | null;
};

export type Placement = {
  key: string; // `${year}::${dayLabel}::${slotId}` (or legacy without year)
  year?: number;
  userId: string;
  dayLabel: DayLabel;
  slotId: SlotId;
  subjectId?: string | null;
  roomOverride?: string | null;
};

export type LessonPlan = {
  key: string; // `${dateKey}::${slotId}`
  year?: number;
  userId: string;
  dateKey: string; // yyyy-MM-dd
  slotId: SlotId;
  html: string;
  updatedAt: number;
};

export type LessonAttachment = {
  id: string;
  year?: number;
  userId: string;
  planKey: string;
  // kind defaults to "file" for older docs
  kind?: "file" | "url";

  // Display name/title
  name: string;

  // URL attachment fields
  url?: string;

  // File attachment fields (kept for compatibility; file uploads are currently disabled)
  mime?: string;
  size?: number;
  storagePath?: string;
  downloadUrl?: string;
  createdAt: number;
};

export type SettingRow = { key: string; value: any };

// Kept for compatibility
export type BaseEventRow = BaseEvent;

/**
 * FIRESTORE PATH HELPERS (per-user subtree)
 */

export function userDoc(uid: string) {
  return doc(db, "users", uid);
}

export function subjectsCol(uid: string) {
  return collection(db, "users", uid, "subjects");
}

// Firestore document IDs cannot contain '/' (it is treated as a path separator).
export function safeDocId(id: string): string {
  return (id ?? "").trim().replaceAll("/", "_");
}

export function subjectDoc(uid: string, subjectId: string) {
  return doc(subjectsCol(uid), safeDocId(subjectId));
}

export function placementsCol(uid: string) {
  return collection(db, "users", uid, "placements");
}
export function placementDoc(uid: string, key: string) {
  return doc(db, "users", uid, "placements", key);
}

export function slotAssignmentsCol(uid: string) {
  return collection(db, "users", uid, "slotAssignments");
}
export function slotAssignmentDoc(uid: string, key: string) {
  return doc(db, "users", uid, "slotAssignments", key);
}

export function cycleTemplateEventsCol(uid: string) {
  return collection(db, "users", uid, "cycleTemplateEvents");
}
export function cycleTemplateEventDoc(uid: string, id: string) {
  return doc(db, "users", uid, "cycleTemplateEvents", id);
}

export function lessonPlansCol(uid: string) {
  return collection(db, "users", uid, "lessonPlans");
}
export function lessonPlanDoc(uid: string, key: string) {
  return doc(db, "users", uid, "lessonPlans", key);
}

export function lessonAttachmentsCol(uid: string) {
  return collection(db, "users", uid, "lessonAttachments");
}
export function lessonAttachmentDoc(uid: string, id: string) {
  return doc(db, "users", uid, "lessonAttachments", id);
}

export function importsCol(uid: string) {
  return collection(db, "users", uid, "imports");
}
export function importDoc(uid: string, importId: string) {
  return doc(db, "users", uid, "imports", importId);
}

export function settingsCol(uid: string) {
  return collection(db, "users", uid, "settings");
}
export function settingDoc(uid: string, key: string) {
  return doc(db, "users", uid, "settings", key);
}

export function baseEventsCol(uid: string) {
  return collection(db, "users", uid, "baseEvents");
}
export function baseEventDoc(uid: string, id: string) {
  return doc(db, "users", uid, "baseEvents", id);
}

export function blocksCol(uid: string) {
  return collection(db, "users", uid, "blocks");
}
export function blockDoc(uid: string, id: string) {
  return doc(db, "users", uid, "blocks", id);
}

export function itemsCol(uid: string) {
  return collection(db, "users", uid, "items");
}
export function itemDoc(uid: string, id: string) {
  return doc(db, "users", uid, "items", id);
}

export function userEventMetaCol(uid: string) {
  return collection(db, "users", uid, "userEventMeta");
}
export function userEventMetaDoc(uid: string, eventId: string) {
  return doc(db, "users", uid, "userEventMeta", eventId);
}
