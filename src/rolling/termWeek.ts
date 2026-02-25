import { parseISO, isValid } from "date-fns";

import type { RollingSettings, WeekSet, TermKey, TermYear } from "./settings";

export type TermWeek = { term: 1 | 2 | 3 | 4; week: number };
export type TermInfo = {
  year: number;
  term: 1 | 2 | 3 | 4;
  week: number;
  set: WeekSet;
};

/**
 * Calculate NSW-style Term/Week given term start dates.
 *
 * - termStarts: YYYY-MM-DD strings. Empty/invalid strings are ignored.
 * - If date is before the first valid term start, returns null.
 */
export function termWeekForDate(
  date: Date,
  termStarts?: { t1?: string; t2?: string; t3?: string; t4?: string },
  termEnds?: { t1?: string; t2?: string; t3?: string; t4?: string },
): TermWeek | null {
  if (!termStarts) return null;

  const starts: Array<{ term: 1 | 2 | 3 | 4; d: Date }> = [];
  const push = (term: 1 | 2 | 3 | 4, iso?: string) => {
    const s = (iso ?? "").trim();
    if (!s) return;
    const d = parseISO(s);
    if (isValid(d)) starts.push({ term, d });
  };
  push(1, termStarts.t1);
  push(2, termStarts.t2);
  push(3, termStarts.t3);
  push(4, termStarts.t4);
  if (starts.length === 0) return null;

  starts.sort((a, b) => a.d.getTime() - b.d.getTime());

  const ms = date.getTime();
  let active: { term: 1 | 2 | 3 | 4; d: Date } | null = null;
  for (const s of starts) {
    if (s.d.getTime() <= ms) active = s;
    else break;
  }
  if (!active) return null;

  // If an end date is provided for the active term, suppress Term/Week outside the range.
  if (termEnds) {
    const endIso =
      (active.term === 1
        ? termEnds.t1
        : active.term === 2
          ? termEnds.t2
          : active.term === 3
            ? termEnds.t3
            : termEnds.t4) ?? "";
    const endS = endIso.trim();
    if (endS) {
      const endD = parseISO(endS);
      if (isValid(endD) && ms > endD.getTime()) return null;
    }
  }

  const start = new Date(active.d);
  start.setHours(0, 0, 0, 0);
  // Week 1 starts on the Monday of the week containing the selected term start date.
  // JS: Sun=0..Sat=6, convert so Mon=0..Sun=6
  const monIndex = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - monIndex);

  const diffDays = Math.floor((ms - start.getTime()) / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return { term: active.term, week: Math.max(1, week) };
}

function mondayOfWeekContaining(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const monIndex = (x.getDay() + 6) % 7; // Mon=0..Sun=6
  x.setDate(x.getDate() - monIndex);
  return x;
}

function computeSet(week1Set: WeekSet, week: number): WeekSet {
  const flips = (Math.max(1, week) - 1) % 2;
  return flips === 0 ? week1Set : week1Set === "A" ? "B" : "A";
}

function iterTermYears(settings: RollingSettings): TermYear[] {
  if (settings.termYears && settings.termYears.length)
    return settings.termYears;
  // Backwards compat: treat legacy termStarts/termEnds as a single year
  const anyStart =
    settings.termStarts?.t1 ||
    settings.termStarts?.t2 ||
    settings.termStarts?.t3 ||
    settings.termStarts?.t4;
  const y = anyStart
    ? parseInt(String(anyStart).slice(0, 4), 10)
    : new Date().getFullYear();
  return [
    {
      year: Number.isFinite(y) ? y : new Date().getFullYear(),
      starts: { ...(settings.termStarts ?? {}) },
      ends: { ...(settings.termEnds ?? {}) },
      week1Sets: { ...(settings.termWeek1Sets ?? {}) },
    },
  ];
}

export function termInfoForDate(
  date: Date,
  settings: RollingSettings,
): TermInfo | null {
  const years = iterTermYears(settings);
  const ms = date.getTime();

  const parse = (iso?: string) => {
    const s = (iso ?? "").trim();
    if (!s) return null;
    const d = parseISO(s);
    return isValid(d) ? d : null;
  };

  type TermCandidate = {
    year: number;
    term: 1 | 2 | 3 | 4;
    start: Date;
    end: Date | null;
    week1Set: WeekSet;
  };

  let best: TermCandidate | null = null;

  for (const y of years) {
    const starts = y.starts ?? {};
    const ends = y.ends ?? {};
    const w1 = y.week1Sets ?? {};

    const entries: Array<{ term: 1 | 2 | 3 | 4; key: TermKey }> = [
      { term: 1, key: "t1" },
      { term: 2, key: "t2" },
      { term: 3, key: "t3" },
      { term: 4, key: "t4" },
    ];

    for (const { term, key } of entries) {
      const sd = parse(starts[key]);
      if (!sd) continue;

      if (sd.getTime() > ms) continue; // not started yet

      const ed = parse(ends[key]) ?? null;
      if (ed && ms > ed.getTime()) continue; // already ended

      const week1Set: WeekSet = (w1[key] ?? "A") as WeekSet;

      if (!best || sd.getTime() > best.start.getTime()) {
        best = { year: y.year, term, start: sd, end: ed, week1Set };
      }
    }
  }

  if (!best) return null;

  const week1Monday = mondayOfWeekContaining(best.start);
  const diffDays = Math.floor((ms - week1Monday.getTime()) / 86400000);
  const week = Math.floor(diffDays / 7) + 1;
  const set = computeSet(best.week1Set, week);

  return { year: best.year, term: best.term, week: Math.max(1, week), set };
}

export function nextTermStartAfter(
  dateKey: string,
  settings: RollingSettings,
): string | null {
  const years = iterTermYears(settings);
  const list: string[] = [];
  for (const y of years) {
    const starts = y.starts ?? {};
    for (const k of ["t1", "t2", "t3", "t4"] as TermKey[]) {
      const s = (starts[k] ?? "").trim();
      if (s) list.push(s);
    }
  }
  list.sort(); // YYYY-MM-DD lexicographic
  return list.find((d) => d > dateKey) ?? null;
}
