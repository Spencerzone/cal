// src/db/subjectUtils.ts
import type { CycleTemplateEvent, Subject, SubjectKind } from "./db";

// Legacy ID from earlier versions (single global duty subject). Kept for migration/cleanup.
export const LEGACY_DUTY_SUBJECT_ID = "duty";

function normaliseSpaces(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function normaliseKey(s: string) {
  return normaliseSpaces(s).toLowerCase();
}

function normaliseCode(code: string) {
  return code.trim().toUpperCase();
}

/**
 * Subject identity for a template event.
 *
 * Canonical rules (Subjects are the source of truth):
 * - If a code exists, that is the identity: `code::<CODE>` (always uppercased).
 * - Duty identity is per duty area: `duty::<area>` where area comes from room if present.
 * - Otherwise fall back to title buckets: `title::<normalised title>`.
 */
export function subjectIdForTemplateEvent(e: CycleTemplateEvent): string {
  if (e.code && e.code.trim()) return `code::${normaliseCode(e.code)}`;

  if (e.type === "duty") {
    const area = normaliseKey(e.room?.trim() || e.title);
    return `duty::${area}`;
  }

  if (e.type === "break") {
    return `break::${normaliseKey(e.title)}`;
  }

  return `title::${normaliseKey(e.title)}`;
}

export function subjectKindForTemplateEvent(e: CycleTemplateEvent): SubjectKind {
  if (e.type === "duty") return "duty";
  if (e.type === "break") return "break";
  return "subject";
}

export function detailForTemplateEvent(e: CycleTemplateEvent): string | null {
  // For duty, treat room as area
  if (e.type === "duty") return e.room?.trim() || null;
  return null;
}

export function displayTitle(subject: Subject, detail?: string | null): string {
  // If duty and we have an area detail, show the edited title directly (default title is area anyway).
  // Keep detail unused to avoid surprising prefixes.
  return subject.title;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp01(s);
  l = clamp01(l);

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  return `#${[r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

// Deterministic colour for a subject id; tuned for dark UI.
export function autoHexColorForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 0.7, 0.45);
}
