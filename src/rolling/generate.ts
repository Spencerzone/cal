import { getDb } from "../db/db";
import type { CycleTemplateEvent } from "../db/db";
import type { RollingSettings } from "./settings";
import { dayLabelForDate } from "./cycle";
import { getTemplateMeta, applyMetaToLabel } from "./templateMapping";
import type { DayLabel } from "../db/db";

export type GeneratedEvent = {
  id: string;
  startUtc: number;
  endUtc: number;
  periodCode: string | null;
  type: CycleTemplateEvent["type"];
  code: string | null;
  title: string;
  room: string | null;
};

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, (m! - 1), d!);
}

function toUtcMs(localDate: Date, minutes: number): number {
  const d = new Date(localDate);
  d.setHours(0, minutes, 0, 0);
  return d.getTime(); // this Date is local time; getTime() returns UTC ms for that local instant
}

export async function generateForDate(localDateKey: string, settings: RollingSettings): Promise<GeneratedEvent[]> {
  const label = dayLabelForDate(localDateKey, settings);
  const meta = await getTemplateMeta();
  const storedLabel: DayLabel = meta ? applyMetaToLabel(label as DayLabel, meta) : (label as DayLabel);

  if (!label) return [];

  const db = await getDb();
  const idx = db.transaction("cycleTemplateEvents").store.index("byDayLabel");
  const template = await idx.getAll(storedLabel);

  template.sort((a, b) => a.startMinutes - b.startMinutes);

  const localDay = parseLocalDate(localDateKey);
  return template.map((t) => ({
    id: `${localDateKey}-${t.id}`,
    startUtc: toUtcMs(localDay, t.startMinutes),
    endUtc: toUtcMs(localDay, t.endMinutes),
    periodCode: t.periodCode,
    type: t.type,
    code: t.code,
    title: t.title,
    room: t.room,
  }));
}