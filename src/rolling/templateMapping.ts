// src/rolling/templateMapping.ts (Firestore source-of-truth)

import { getDoc, setDoc } from "firebase/firestore";
import type { DayLabel } from "../db/db";
import { settingDoc } from "../db/db";

export type TemplateMeta = {
  anchorMonday: string; // YYYY-MM-DD
  cycleDates: string[]; // length 10
  shift: number; // 0..9
  flipped: boolean;
  builtAt: number;
};

const CANON_LABELS: DayLabel[] = [
  "MonA","TueA","WedA","ThuA","FriA",
  "MonB","TueB","WedB","ThuB","FriB",
];

function rot<T>(arr: T[], shift: number): T[] {
  const s = ((shift % arr.length) + arr.length) % arr.length;
  return arr.slice(s).concat(arr.slice(0, s));
}

export function applyMetaToLabel(canonical: DayLabel, meta: TemplateMeta): DayLabel {
  const base = meta.flipped
    ? ([...CANON_LABELS.slice(5), ...CANON_LABELS.slice(0, 5)] as DayLabel[])
    : CANON_LABELS;

  const rotated = rot(base, meta.shift);
  const i = CANON_LABELS.indexOf(canonical);
  return rotated[i] ?? canonical;
}

export function applyMetaFromLabel(stored: DayLabel, meta: TemplateMeta): DayLabel {
  const base = meta.flipped
    ? ([...CANON_LABELS.slice(5), ...CANON_LABELS.slice(0, 5)] as DayLabel[])
    : CANON_LABELS;

  const rotated = rot(base, meta.shift);
  const i = rotated.indexOf(stored);
  return CANON_LABELS[i] ?? stored;
}

const KEY = "templateMeta";

export async function getTemplateMeta(userId: string): Promise<TemplateMeta | null> {
  const snap = await getDoc(settingDoc(userId, KEY));
  const v = snap.exists() ? (snap.data() as any).value : null;
  return v ? (v as TemplateMeta) : null;
}

export async function setTemplateMeta(userId: string, meta: TemplateMeta): Promise<void> {
  await setDoc(settingDoc(userId, KEY), { key: KEY, value: meta }, { merge: true });
  window.dispatchEvent(new Event("template-meta-changed"));
}
