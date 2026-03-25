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
  return (snap.data()?.text as string) ?? "";
}

export async function setDayNote(
  userId: string,
  dateKey: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    await deleteDoc(dayNoteDoc(userId, dateKey));
  } else {
    await setDoc(dayNoteDoc(userId, dateKey), {
      dateKey,
      text: trimmed,
      updatedAt: Date.now(),
    });
  }
  window.dispatchEvent(new Event("daynote-changed"));
}
