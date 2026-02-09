// src/db/queries.ts
import { getDb } from "./db";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { startOfDay, endOfDay, startOfWeek, endOfWeek } from "date-fns";



const TZ = "Australia/Sydney";

function isWithin(startUtc: number, endUtc: number, rangeStartUtc: number, rangeEndUtc: number) {
  return startUtc < rangeEndUtc && endUtc > rangeStartUtc;
}

export async function getEventsForRange(rangeStartUtc: number, rangeEndUtc: number) {
  const db = await getDb();
  const idx = db.transaction("baseEvents").store.index("byStartUtc");

  // Simple approach: iterate from rangeStart; stop when start > rangeEnd
  const out: any[] = [];
  let cursor = await idx.openCursor(rangeStartUtc);
  while (cursor) {
    const ev = cursor.value;
    if (ev.dtStartUtc > rangeEndUtc) break;
    if (ev.active && isWithin(ev.dtStartUtc, ev.dtEndUtc, rangeStartUtc, rangeEndUtc)) out.push(ev);
    cursor = await cursor.continue();
  }
  return out;
}

export function todayRangeUtc(now = new Date()) {
  const local = toZonedTime(now, TZ);
  const startLocal = startOfDay(local);
  const endLocal = endOfDay(local);
  // Convert local boundaries back to UTC ms by constructing Date from ISO with TZ offset
  // Simplest: use date-fns-tz zonedTimeToUtc, but keep this concise:
  return {
    startUtc: fromZonedTime(startLocal, TZ).getTime(),
    endUtc: fromZonedTime(endLocal, TZ).getTime(),
  };
}

export function weekRangeUtc(now = new Date()) {
  const local = toZonedTime(now, TZ);
  const startLocal = startOfWeek(local, { weekStartsOn: 1 });
  const endLocal = endOfWeek(local, { weekStartsOn: 1 });
  return {
    startUtc: fromZonedTime(startLocal, TZ).getTime(),
    endUtc: fromZonedTime(endLocal, TZ).getTime(),
  };
}

export async function getLessonsForSubject(code: string, rangeStartUtc: number, rangeEndUtc: number) {
  const events = await getEventsForRange(rangeStartUtc, rangeEndUtc);
  return events
    .filter(e => e.type === "class" && e.code?.toLowerCase() === code.toLowerCase())
    .sort((a, b) => a.dtStartUtc - b.dtStartUtc);
}
