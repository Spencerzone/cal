import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

function dayNoteDoc(userId: string, dateKey: string) {
  return doc(db, "users", userId, "dayNotes", dateKey);
}

export async function getDayNote(
  userId: string,
  dateKey: string,
): Promise<string> {
  const snap = await getDoc(dayNoteDoc(userId, dateKey));
  if (!snap.exists()) return "";
  const data = snap.data();
  // Support both old 'text' field and new 'html' field
  return (data?.html as string) ?? (data?.text as string) ?? "";
}

function isHtmlEffectivelyEmpty(raw: string): boolean {
  const s = (raw ?? "").trim();
  if (!s) return true;
  return s
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim()
    .length === 0;
}

export async function setDayNote(
  userId: string,
  dateKey: string,
  html: string,
): Promise<void> {
  if (isHtmlEffectivelyEmpty(html)) {
    await deleteDoc(dayNoteDoc(userId, dateKey));
  } else {
    await setDoc(dayNoteDoc(userId, dateKey), {
      dateKey,
      html,
      updatedAt: Date.now(),
    });
  }
  window.dispatchEvent(new Event("daynote-changed"));
}
