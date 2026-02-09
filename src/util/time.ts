// src/util/time.ts
import { format } from "date-fns";
import { utcToZonedTime } from "date-fns-tz";
import type { BaseEvent } from "../ics/parseIcs";

const TZ = "Australia/Sydney";

export function toLocal(dtUtcMs: number): Date {
  return utcToZonedTime(new Date(dtUtcMs), TZ);
}

export function toLocalDayKey(dtUtcMs: number): string {
  const d = toLocal(dtUtcMs);
  return format(d, "yyyy-MM-dd");
}

export function formatDayLabel(dayKey: string): string {
  // dayKey "yyyy-MM-dd" interpreted as local date label
  const [y, m, d] = dayKey.split("-").map(Number);
  const local = new Date(y!, (m! - 1), d!);
  return format(local, "EEEE d MMM");
}

export function formatEventTime(e: BaseEvent): string {
  const s = toLocal(e.dtStartUtc);
  const en = toLocal(e.dtEndUtc);
  return `${format(s, "H:mm")}–${format(en, "H:mm")}`;
}

export function isNowWithin(now: Date, startUtc: number, endUtc: number): boolean {
  const t = now.getTime();
  return t >= startUtc && t < endUtc;
}