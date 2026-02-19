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

function extractRoom(location: string | null, description: string | null): string | null {
  // Prefer LOCATION if present.
  const loc = (location ?? "").trim();
  if (loc) {
    // Sentral sometimes uses "Room: A02" inside LOCATION.
    const m = loc.match(/Room:\s*([^\r\n]+)/i);
    return m ? m[1].trim() : loc;
  }

  // Fallback: some exports put room inside DESCRIPTION.
  const desc = (description ?? "").trim();
  if (desc) {
    const m = desc.match(/\bRoom:\s*([^\r\n]+)/i);
    if (m) return m[1].trim();
    const m2 = desc.match(/\bLocation:\s*([^\r\n]+)/i);
    if (m2) return m2[1].trim();
  }

  return null;
}

function splitSummary(summary: string): { code: string | null; title: string } {
  const s = summary.trim();

  // Common Sentral formats:
  // 1) "CODE: Title"
  // 2) "Title (CODE)"  (often used for roll call / class codes)
  const idx = s.indexOf(":");
  if (idx !== -1) {
    const left = s.slice(0, idx).trim();
    const right = s.slice(idx + 1).trim();
    return { code: left || null, title: right || s };
  }

  // Trailing "(CODE)" pattern
  const m = s.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (m) {
    const title = (m[1] ?? "").trim();
    const code = (m[2] ?? "").trim();
    // Only treat it as a code if it looks like a short-ish identifier.
    if (code && code.length <= 24) {
      return { code, title: title || s };
    }
  }

  return { code: null, title: s };
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
    const room = extractRoom(location, description);

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