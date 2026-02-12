import { getDb } from "../db/db";

export type WeekSet = "A" | "B";

export interface RollingSettings {
  cycleStartDate: string; // YYYY-MM-DD meaning this date is MonA
  excludedDates: string[];
  overrides: Array<{ date: string; set: WeekSet }>;

  // Optional NSW term start dates for displaying Term/Week in Today/Week.
  // If omitted, Term/Week is not shown.
  termStarts?: {
    t1?: string; // YYYY-MM-DD
    t2?: string;
    t3?: string;
    t4?: string;
  };
}

const KEY = "rolling";

export async function getRollingSettings(): Promise<RollingSettings> {
  const db = await getDb();
  const row = await db.get("settings", KEY);
  if (row?.value) return row.value as RollingSettings;

  // default: pick something sensible; user can change later
  const defaultSettings: RollingSettings = {
    cycleStartDate: "2026-02-02", // you can update this via UI later
    excludedDates: [],
    overrides: [],
    termStarts: {
      // Leave blank by default; set via Today/Week date popover.
      t1: "",
      t2: "",
      t3: "",
      t4: "",
    },
  };

  await db.put("settings", { key: KEY, value: defaultSettings });
  return defaultSettings;
}

export async function setRollingSettings(value: RollingSettings) {
  const db = await getDb();
  await db.put("settings", { key: KEY, value });
}