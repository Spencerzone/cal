// src/db/queries.ts (Firestore-backed queries)

import { getDocs, orderBy, query, where } from "firebase/firestore";
import { baseEventsCol, type BaseEventRow } from "./db";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { startOfDay, endOfDay, startOfWeek, endOfWeek } from "date-fns";

const TZ = "Australia/Sydney";

export function todayRangeUtc(localDate: Date = new Date()): { startUtc: number; endUtc: number } {
  const zoned = toZonedTime(localDate, TZ);
  const s = startOfDay(zoned);
  const e = endOfDay(zoned);
  return { startUtc: fromZonedTime(s, TZ).getTime(), endUtc: fromZonedTime(e, TZ).getTime() };
}

export function weekRangeUtc(localDate: Date = new Date()): { startUtc: number; endUtc: number } {
  const zoned = toZonedTime(localDate, TZ);
  const s = startOfWeek(zoned, { weekStartsOn: 1 });
  const e = endOfWeek(zoned, { weekStartsOn: 1 });
  return { startUtc: fromZonedTime(s, TZ).getTime(), endUtc: fromZonedTime(e, TZ).getTime() };
}

export async function getEventsForRange(userId: string, startUtc: number, endUtc: number): Promise<BaseEventRow[]> {
  const col = baseEventsCol(userId);
  const q = query(
    col,
    where("dtStartUtc", ">=", startUtc),
    where("dtStartUtc", "<=", endUtc),
    orderBy("dtStartUtc", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BaseEventRow);
}

export async function getLessonsForSubject(userId: string, code: string): Promise<BaseEventRow[]> {
  const col = baseEventsCol(userId);
  const q = query(col, where("code", "==", code.toUpperCase()), orderBy("dtStartUtc", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as BaseEventRow);
}
