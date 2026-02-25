// src/rolling/settings.ts (Firestore source-of-truth)

import { getDoc, setDoc } from "firebase/firestore";
import { settingDoc } from "../db/db";

export type WeekSet = "A" | "B";
export type TermKey = "t1" | "t2" | "t3" | "t4";

export interface TermYear {
  year: number;
  starts?: Partial<Record<TermKey, string>>;
  ends?: Partial<Record<TermKey, string>>;
  week1Sets?: Partial<Record<TermKey, WeekSet>>;
}


export interface RollingSettings {
  cycleStartDate: string; // YYYY-MM-DD meaning this date is MonA
  excludedDates: string[];
  overrides: Array<{ date: string; set: WeekSet }>;

  // Which academic year is currently active for all year-scoped data (subjects, template, plans, etc.)
  activeYear?: number;

  // NEW: term configuration for multiple years
  termYears?: TermYear[];

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

  // Which set (A/B) is Week 1 for each term
  termWeek1Sets?: {
    t1?: WeekSet;
    t2?: WeekSet;
    t3?: WeekSet;
    t4?: WeekSet;
  };
}

const KEY = "rolling";

const DEFAULTS: RollingSettings = {
  cycleStartDate: "2026-01-01",
  excludedDates: [],
  overrides: [],
  activeYear: new Date().getFullYear(),
};

export async function getRollingSettings(
  userId: string,
): Promise<RollingSettings> {
  const snap = await getDoc(settingDoc(userId, KEY));
  const v = snap.exists() ? (snap.data() as any).value : null;
  if (v) {
    // MIGRATE termStarts/termEnds/termWeek1Sets -> termYears (one-time, backwards compatible)
    if (!v.termYears && (v.termStarts || v.termEnds || v.termWeek1Sets)) {
      const pickYear = () => {
        const cands = [v.termStarts?.t1, v.termStarts?.t2, v.termStarts?.t3, v.termStarts?.t4].filter(Boolean);
        const first = (cands[0] ?? "").trim();
        const y = parseInt(first.slice(0, 4), 10);
        return Number.isFinite(y) ? y : new Date().getFullYear();
      };
      const year = pickYear();
      v.termYears = [
        {
          year,
          starts: { ...(v.termStarts ?? {}) },
          ends: { ...(v.termEnds ?? {}) },
          week1Sets: { ...(v.termWeek1Sets ?? {}) },
        },
      ];
      // Persist migration without altering other fields
      await setDoc(settingDoc(userId, KEY), { key: KEY, value: v });
      window.dispatchEvent(new Event("rolling-settings-changed"));
    }

    // Ensure an activeYear exists (used to scope year-based data)
    if (!v.activeYear) {
      const years = (v.termYears ?? []).map((t: any) => t.year).filter((n: any) => Number.isFinite(n));
      if (years.length) v.activeYear = years.slice().sort((a: number, b: number) => a - b)[0];
      else {
        const infer = (v.termStarts?.t1 || v.termStarts?.t2 || v.termStarts?.t3 || v.termStarts?.t4 || "").trim();
        const y = parseInt(infer.slice(0,4),10);
        v.activeYear = Number.isFinite(y) ? y : new Date().getFullYear();
      }
      await setDoc(settingDoc(userId, KEY), { key: KEY, value: v });
      window.dispatchEvent(new Event("rolling-settings-changed"));
    }
    return v as RollingSettings;
  }
  return DEFAULTS;
}

export async function setRollingSettings(
  userId: string,
  next: RollingSettings,
): Promise<void> {
  // Deep-merge with existing settings so optional nested fields aren't dropped by partial updates.
  const current = await getRollingSettings(userId);

  const merged: RollingSettings = {
    ...current,
    ...next,
    termStarts: { ...(current.termStarts ?? {}), ...(next.termStarts ?? {}) },
    termEnds: { ...(current.termEnds ?? {}), ...(next.termEnds ?? {}) },
    termWeek1Sets: {
      ...(current.termWeek1Sets ?? {}),
      ...(next.termWeek1Sets ?? {}),
    },
    termYears: next.termYears ?? current.termYears,
  };

  await setDoc(settingDoc(userId, KEY), { key: KEY, value: merged });
  window.dispatchEvent(new Event("rolling-settings-changed"));
}
