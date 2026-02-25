import type { RollingSettings, WeekSet } from "./settings";
import { termInfoForDate, termWeekForDate } from "./termWeek";

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

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isWeekend(d: Date): boolean {
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function latestOverrideAnchor(
  target: string,
  overrides: RollingSettings["overrides"],
) {
  let best: { date: string; set: WeekSet } | null = null;
  for (const o of overrides) {
    if (o.date <= target && (!best || o.date > best.date)) best = o;
  }
  return best;
}

function countSchoolDaysInclusive(
  start: Date,
  end: Date,
  excluded: Set<string>,
): number {
  let count = 0;
  for (let cur = new Date(start); cur <= end; cur = addDays(cur, 1)) {
    const key = formatLocalDate(cur);
    if (isWeekend(cur)) continue;
    if (excluded.has(key)) continue;
    count++;
  }
  return count;
}

export function dayLabelForDate(
  targetDate: string,
  settings: RollingSettings,
): DayLabel | null {
  const excluded = new Set(settings.excludedDates ?? []);
  const target = parseLocalDate(targetDate);
  if (isWeekend(target)) return null;
  if (excluded.has(targetDate)) return null;

  // Prefer term-based A/B when term dates are configured. Outside term ranges are treated as holidays.
  const hasAnyTerms =
    (settings.termYears && settings.termYears.length > 0) ||
    !!settings.termStarts;
  if (hasAnyTerms) {
    const ti = termInfoForDate(target, settings);
    if (!ti) return null; // holiday / non-term
    const wd = target.getDay();
    const weekdayIdx = wd - 1;
    if (weekdayIdx < 0 || weekdayIdx > 4) return null;
    return `${DOW[weekdayIdx]}${ti.set}` as DayLabel;
  }


  const ov = latestOverrideAnchor(targetDate, settings.overrides ?? []);
  const anchorDateStr = ov?.date ?? settings.cycleStartDate;
  const anchorSet: WeekSet = ov?.set ?? "A";

  const anchor = parseLocalDate(anchorDateStr);
  if (target < anchor) return null;

  const anchorDow = anchor.getDay(); // 1..5
  const anchorDowIdx = anchorDow - 1; // Mon=0..Fri=4
  if (anchorDowIdx < 0 || anchorDowIdx > 4) return null;

  const daysCount = countSchoolDaysInclusive(anchor, target, excluded);
  const offset = daysCount - 1;

  const weekdayIdx = (anchorDowIdx + (offset % 5)) % 5;
  const weekBlocks = Math.floor((anchorDowIdx + offset) / 5);
  const set: WeekSet =
    weekBlocks % 2 === 0 ? anchorSet : anchorSet === "A" ? "B" : "A";

  return `${DOW[weekdayIdx]}${set}` as DayLabel;
}
