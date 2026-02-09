// src/ics/parseIcs.ts
import ICAL from "ical.js";

export type EventType = "class" | "duty" | "break";

export interface BaseEvent {
  id: string;
  uid: string | null;
  dtStartUtc: number;
  dtEndUtc: number;
  summaryRaw: string;
  code: string | null;
  title: string;
  room: string | null;
  periodCode: string | null;
  type: EventType;
  sourceHash: string;
  active: boolean;
  lastSeenImportId: string;
}

function firstLine(s: string): string {
  return s.split(/\r?\n/)[0]?.trim() ?? "";
}

function extractPeriodCode(description: string | null): string | null {
  if (!description) return null;
  // Sentral: "Period: X"
  const m = description.match(/Period:\s*([^\r\n]+)/i);
  return m ? m[1].trim() : null;
}

function extractRoom(location: string | null): string | null {
  if (!location) return null;
  // Sentral: "Room: A02"
  const m = location.match(/Room:\s*([^\r\n]+)/i);
  return m ? m[1].trim() : location.trim() || null;
}

function splitSummary(summary: string): { code: string | null; title: string } {
  const idx = summary.indexOf(":");
  if (idx === -1) return { code: null, title: summary.trim() };
  const left = summary.slice(0, idx).trim();
  const right = summary.slice(idx + 1).trim();
  return { code: left || null, title: right || summary.trim() };
}

// Stable lightweight hash (not cryptographic) for change detection.
export function hashString(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function deriveId(uid: string | null, dtStartUtc: number, dtEndUtc: number, summary: string, room: string | null) {
  if (uid) return uid;
  return hashString(`${dtStartUtc}|${dtEndUtc}|${summary}|${room ?? ""}`);
}

function inferType(summaryRaw: string, periodCode: string | null): EventType {
  const s = summaryRaw.trim();
  if (s.startsWith("Duty.")) return "duty";
  // Optional: treat recess/lunch as break if periodCode matches
  if (periodCode && /^R\d+|^L\d+/i.test(periodCode)) return "break";
  return "class";
}

export function parseIcsToBaseEvents(icsText: string, importId: string): BaseEvent[] {
  const jcal = ICAL.parse(icsText);
  const comp = new ICAL.Component(jcal);

  const vevents = comp.getAllSubcomponents("vevent");
  const out: BaseEvent[] = [];

  for (const v of vevents) {
    const evt = new ICAL.Event(v);

    const uid = evt.uid ?? null;
    const summaryRaw = firstLine(evt.summary ?? "");
    const description = evt.description ?? null;
    const location = evt.location ?? null;

    const start = evt.startDate?.toJSDate();
    const end = evt.endDate?.toJSDate();
    if (!start || !end) continue;

    const dtStartUtc = start.getTime();
    const dtEndUtc = end.getTime();

    const periodCode = extractPeriodCode(description);
    const room = extractRoom(location);

    const { code, title } = splitSummary(summaryRaw);
    const type = inferType(summaryRaw, periodCode);

    // Use the raw VEVENT string as a source-hash basis (good enough for change detect)
    const veventText = v.toString();
    const sourceHash = hashString(veventText);

    const id = deriveId(uid, dtStartUtc, dtEndUtc, summaryRaw, room);

    out.push({
      id,
      uid,
      dtStartUtc,
      dtEndUtc,
      summaryRaw,
      code,
      title,
      room,
      periodCode,
      type,
      sourceHash,
      active: true,
      lastSeenImportId: importId,
    });
  }

  return out;
}