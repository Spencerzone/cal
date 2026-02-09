// src/rolling/cycle.ts
export type WeekSet = "A" | "B";
export type DayLabel =
  | "MonA" | "TueA" | "WedA" | "ThuA" | "FriA"
  | "MonB" | "TueB" | "WedB" | "ThuB" | "FriB";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export interface RollingSettings {
  cycleStartDate: string;        // YYYY-MM-DD meaning this date is "MonA"
  excludedDates?: string[];      // YYYY-MM-DD (optional)
  overrides?: Array<{ date: string; set: WeekSet }>; // date forces week A/B from that point
}

function parseLocalDate(date: string): Date {
  // local midnight
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, (m! - 1), d!);
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isWeekend(d: Date): boolean {
  const wd = d.getDay(); // 0 Sun .. 6 Sat
  return wd === 0 || wd === 6;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function countSchoolDaysInclusive(start: Date, end: Date, excluded: Set<string>): number {
  // count included school days from start -> end (inclusive), assuming start<=end and start itself is included
  let count = 0;
  for (let cur = new Date(start); cur <= end; cur = addDays(cur, 1)) {
    const key = formatLocalDate(cur);
    if (isWeekend(cur)) continue;
    if (excluded.has(key)) continue;
    count++;
  }
  return count;
}

function latestOverrideAnchor(target: string, overrides: RollingSettings["overrides"]): { date: string; set: WeekSet } | null {
  if (!overrides || overrides.length === 0) return null;
  // overrides are small; simple scan
  let best: { date: string; set: WeekSet } | null = null;
  for (const o of overrides) {
    if (o.date <= target && (!best || o.date > best.date)) best = o;
  }
  return best;
}

export function dayLabelForDate(targetDate: string, settings: RollingSettings): DayLabel | null {
  const excluded = new Set(settings.excludedDates ?? []);
  const target = parseLocalDate(targetDate);
  if (isWeekend(target)) return null;
  if (excluded.has(targetDate)) return null;

  const ov = latestOverrideAnchor(targetDate, settings.overrides);
  const anchorDateStr = ov?.date ?? settings.cycleStartDate;

  const anchor = parseLocalDate(anchorDateStr);
  if (target < anchor) return null; // out of range; choose your preferred behaviour

  // Determine anchor's weekday slot (Mon..Fri index)
  // This matters because overrides set week A/B but keep weekday alignment.
  const anchorDow = anchor.getDay(); // 1 Mon .. 5 Fri (in AU local)
  const anchorDowIdx = anchorDow - 1; // Mon=0 .. Fri=4
  if (anchorDowIdx < 0 || anchorDowIdx > 4) return null; // anchor should be a school day

  // Count school days between anchor and target inclusive, then make it 0-based index
  const daysCount = countSchoolDaysInclusive(anchor, target, excluded);
  const offset = daysCount - 1; // anchor date offset = 0

  // Determine which set applies at anchor
  // cycleStartDate is defined as MonA. If we're using an override anchor, apply ov.set.
  const anchorSet: WeekSet = ov?.set ?? "A";

  // Convert offset to "school day index since a Monday of that set"
  // We align within week by weekday index; weekSet by block of 5.
  const weekdayIdx = (anchorDowIdx + (offset % 5)) % 5;

  // Number of full school weeks (5-day blocks) advanced from anchor
  const weekBlocks = Math.floor((anchorDowIdx + offset) / 5);

  // anchorSet toggles each 5-day block
  const set: WeekSet = (weekBlocks % 2 === 0) ? anchorSet : (anchorSet === "A" ? "B" : "A");

  return `${DOW[weekdayIdx]}${set}` as DayLabel;
}