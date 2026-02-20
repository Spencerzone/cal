import { parseISO, isValid } from "date-fns";

export type TermWeek = { term: 1 | 2 | 3 | 4; week: number };

/**
 * Calculate NSW-style Term/Week given term start dates.
 *
 * - termStarts: YYYY-MM-DD strings. Empty/invalid strings are ignored.
 * - If date is before the first valid term start, returns null.
 */
export function termWeekForDate(
  date: Date,
  termStarts?: { t1?: string; t2?: string; t3?: string; t4?: string },
  termEnds?: { t1?: string; t2?: string; t3?: string; t4?: string }
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
    const endIso = (active.term === 1 ? termEnds.t1 : active.term === 2 ? termEnds.t2 : active.term === 3 ? termEnds.t3 : termEnds.t4) ?? "";
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
