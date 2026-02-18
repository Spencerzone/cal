// src/rolling/settings.ts (Firestore source-of-truth)

import { getDoc, setDoc } from "firebase/firestore";
import { settingDoc } from "../db/db";

export type WeekSet = "A" | "B";

export interface RollingSettings {
  cycleStartDate: string; // YYYY-MM-DD meaning this date is MonA
  excludedDates: string[];
  overrides: Array<{ date: string; set: WeekSet }>;

  termStarts?: {
    t1?: string;
    t2?: string;
    t3?: string;
    t4?: string;
  };

  termEnds?: {
    t1?: string;
    t2?: string;
    t3?: string;
    t4?: string;
  };
}

const KEY = "rolling";

const DEFAULTS: RollingSettings = {
  cycleStartDate: "2026-01-01",
  excludedDates: [],
  overrides: [],
};

export async function getRollingSettings(userId: string): Promise<RollingSettings> {
  const snap = await getDoc(settingDoc(userId, KEY));
  const v = snap.exists() ? (snap.data() as any).value : null;
  if (v) return v as RollingSettings;
  return DEFAULTS;
}

export async function setRollingSettings(userId: string, next: RollingSettings): Promise<void> {
  await setDoc(settingDoc(userId, KEY), { key: KEY, value: next }, { merge: true });
  window.dispatchEvent(new Event("rolling-settings-changed"));
}
