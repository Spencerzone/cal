// src/db/queries.ts (Firestore-backed queries)

import { getDocs, orderBy, query, where } from 'firebase/firestore';
import { baseEventsCol, type BaseEventRow } from './db';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay, startOfWeek, endOfWeek } from 'date-fns';

const TZ = 'Australia/Sydney';

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

export async function getEventsForRange(
    userId: string,
    startUtc: number,
    endUtc: number,
): Promise<BaseEventRow[]> {
    const col = baseEventsCol(userId);
    const q = query(
        col,
        where('dtStartUtc', '>=', startUtc),
        where('dtStartUtc', '<=', endUtc),
        orderBy('dtStartUtc', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as BaseEventRow);
}

export async function getLessonsForSubject(
    userId: string,
    year: number,
    code: string,
): Promise<BaseEventRow[]>;
export async function getLessonsForSubject(userId: string, code: string): Promise<BaseEventRow[]>;
export async function getLessonsForSubject(
    userId: string,
    yearOrCode: number | string,
    maybeCode?: string,
): Promise<BaseEventRow[]> {
    const year = typeof yearOrCode === 'number' ? yearOrCode : undefined;
    const code = (typeof yearOrCode === 'string' ? yearOrCode : (maybeCode ?? '')).toUpperCase();

    const col = baseEventsCol(userId);
    const q = query(col, where('code', '==', code), orderBy('dtStartUtc', 'desc'));
    const snap = await getDocs(q);
    const rows = snap.docs.map((d) => d.data() as BaseEventRow);

    if (!year) return rows;

    // Filter to the selected academic year using local time (AU/Sydney)
    return rows.filter((r) => {
        const local = toZonedTime(new Date(r.dtStartUtc), TZ);
        return local.getFullYear() === year;
    });
}
