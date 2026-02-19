import ICAL from "ical.js";
import { toZonedTime } from "date-fns-tz";
import { format } from "date-fns";
import { getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { cycleTemplateEventsCol, cycleTemplateEventDoc } from "../db/db";
import { setTemplateMeta } from "./templateMapping";
import type { CycleTemplateEvent, DayLabel } from "../db/db";

const TZ = "Australia/Sydney";
const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

function firstLine(s: string): string {
  return s.split(/\r?\n/)[0]?.trim() ?? "";
}

function extractPeriodCode(description: string | null): string | null {
  if (!description) return null;
  const m = description.match(/Period:\s*([^\r\n]+)/i);
  return m ? m[1].trim() : null;
}

function extractRoom(location: string | null): string | null {
  if (!location) return null;
  const m = location.match(/Room:\s*([^\r\n]+)/i);
  return m ? m[1].trim() : (location.trim() || null);
}

function splitSummary(summary: string): { code: string | null; title: string } {
  const idx = summary.indexOf(":");
  // Support both:
  //   CODE: Title
  //   Title (CODE)   (common in Sentral/Edval exports)
  if (idx === -1) {
    const m = summary.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    if (m) {
      const title = (m[1] ?? "").trim();
      const code = (m[2] ?? "").trim();
      return { code: code ? code : null, title: title || summary.trim() };
    }
    return { code: null, title: summary.trim() };
  }
  const left = summary.slice(0, idx).trim();
  const right = summary.slice(idx + 1).trim();
  return { code: left || null, title: right || summary.trim() };
}

function inferType(summaryRaw: string, periodCode: string | null): CycleTemplateEvent["type"] {
  if (summaryRaw.startsWith("Duty.")) return "duty";
  if (periodCode && /^(R\d+|L\d+)$/i.test(periodCode)) return "break";
  return "class";
}

function minutesSinceMidnightLocal(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function isWeekdayLocal(d: Date): boolean {
  const wd = d.getDay(); // 0 Sun .. 6 Sat (local)
  return wd >= 1 && wd <= 5;
}

function dayKeyLocal(d: Date): string {
  // local YYYY-MM-DD
  return format(d, "yyyy-MM-dd");
}

function toLocal(dtUtc: Date): Date {
  return toZonedTime(dtUtc, TZ);
}

function dayLabelFromIndex(i: number): DayLabel {
  const weekdayIdx = i % 5;                 // 0..4
  const set: "A" | "B" = i < 5 ? "A" : "B"; // 0..4 A, 5..9 B
  return `${DAY_ORDER[weekdayIdx]}${set}` as DayLabel;
}

function stableId(parts: Array<string | number | null | undefined>): string {
  const s = parts.map(p => (p ?? "")).join("|");
  // simple stable hash
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

type ParsedEvent = {
  localDateKey: string;          // YYYY-MM-DD in AU local time
  localDow: number;              // 1..5
  startMinutes: number;
  endMinutes: number;
  periodCode: string | null;
  type: CycleTemplateEvent["type"];
  code: string | null;
  title: string;
  room: string | null;
};

export async function buildCycleTemplateFromIcs(userId: string, icsText: string) {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");

  const parsed: ParsedEvent[] = [];

  for (const v of vevents) {
    const evt = new ICAL.Event(v);

    const startUtc = evt.startDate?.toJSDate();
    const endUtc = evt.endDate?.toJSDate();
    if (!startUtc || !endUtc) continue;

    const startLocal = toLocal(startUtc);
    const endLocal = toLocal(endUtc);

    if (!isWeekdayLocal(startLocal)) continue;

    const summaryRaw = firstLine(evt.summary ?? "");
    const { code, title } = splitSummary(summaryRaw);

    const periodCode = extractPeriodCode(evt.description ?? null);
    const room = extractRoom(evt.location ?? null);
    const type = inferType(summaryRaw, periodCode);

    parsed.push({
      localDateKey: dayKeyLocal(startLocal),
      localDow: startLocal.getDay(), // 1..5
      startMinutes: minutesSinceMidnightLocal(startLocal),
      endMinutes: minutesSinceMidnightLocal(endLocal),
      periodCode,
      type,
      code,
      title,
      room,
    });
  }

  if (parsed.length === 0) {
    throw new Error("No weekday events found in ICS.");
  }

  // Group by local date
  const byDate = new Map<string, ParsedEvent[]>();
  for (const e of parsed) {
    if (!byDate.has(e.localDateKey)) byDate.set(e.localDateKey, []);
    byDate.get(e.localDateKey)!.push(e);
  }

  const allDates = [...byDate.keys()].sort(); // YYYY-MM-DD sorts correctly

  // Find earliest Monday to anchor as MonA
  const mondayDates = allDates.filter(dk => {
    const sample = byDate.get(dk)![0]!;
    return sample.localDow === 1; // Monday
  });

  if (mondayDates.length === 0) {
    throw new Error("No Monday found in ICS to anchor MonA.");
  }

  const anchorMonday = mondayDates[0]!;
  const anchorIdx = allDates.indexOf(anchorMonday);

  // Build 10 school days starting from anchorMonday, skipping weekends implicitly (dates are from file)
  // We take the first 10 distinct dates from anchorIdx onward that are Mon..Fri.
  const cycleDates: string[] = [];
  for (let i = anchorIdx; i < allDates.length && cycleDates.length < 10; i++) {
    const dk = allDates[i]!;
    const sample = byDate.get(dk)![0]!;
    if (sample.localDow >= 1 && sample.localDow <= 5) cycleDates.push(dk);
  }

  if (cycleDates.length < 10) {
    throw new Error(`Need at least 10 consecutive school dates from first Monday; found ${cycleDates.length}.`);
  }

  const dateToLabel = new Map<string, DayLabel>();
  for (let i = 0; i < 10; i++) {
    dateToLabel.set(cycleDates[i]!, dayLabelFromIndex(i));
  }

  const templateEvents: CycleTemplateEvent[] = [];

  for (const dk of cycleDates) {
    const label = dateToLabel.get(dk)!;
    const evs = (byDate.get(dk) ?? []).slice();

    // sort within day by start time then periodCode
    evs.sort((a, b) => (a.startMinutes - b.startMinutes) || (String(a.periodCode).localeCompare(String(b.periodCode))));

    for (const e of evs) {
      const id = `${label}-${stableId([e.periodCode, e.startMinutes, e.endMinutes, e.code, e.title, e.room, e.type])}`;
      templateEvents.push({
        id,
        dayLabel: label,
        startMinutes: e.startMinutes,
        endMinutes: e.endMinutes,
        periodCode: e.periodCode,
        type: e.type,
        code: e.code,
        title: e.title,
        room: e.room,
      });
    }
  }


  // Persist: replace existing template (Firestore)
  // Delete existing docs
  const existingSnap = await getDocs(cycleTemplateEventsCol(userId));
  if (!existingSnap.empty) {
    const batchDel = writeBatch(db);
    for (const d of existingSnap.docs) batchDel.delete(d.ref);
    await batchDel.commit();
  }

  // Write new docs (chunked under 500 writes)
  const CHUNK = 400;
  for (let i = 0; i < templateEvents.length; i += CHUNK) {
    const chunk = templateEvents.slice(i, i + CHUNK);
    const batch = writeBatch(db);
    for (const te of chunk) {
      batch.set(cycleTemplateEventDoc(userId, te.id), te, { merge: false });
    }
    await batch.commit();
  }

  await setTemplateMeta(userId, {
    anchorMonday,
    cycleDates,
    shift: 0,
    flipped: false,
    builtAt: Date.now(),
  });

  return {

    anchorMonday,
    cycleDates,
    count: templateEvents.length,
  };
}