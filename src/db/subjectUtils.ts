// src/db/subjectUtils.ts
import type { CycleTemplateEvent, Subject, SubjectKind } from "./db";

export function subjectIdForTemplateEvent(e: CycleTemplateEvent): string {
  // Primary identity is code if present (your examples confirm this)
  if (e.code && e.code.trim()) return `code::${e.code.trim()}`;

  // If no code, fall back to type/title buckets
  if (e.type === "duty") {
    // Use the duty "area" as identity (room is used as area for duties)
    const area = (e.room?.trim() || e.title.trim() || "duty");
    return `duty::${normaliseKey(area)}`;
  }

  return `title::${normaliseKey(e.title)}`;
}

export function subjectKindForTemplateEvent(e: CycleTemplateEvent): SubjectKind {
  if (e.type === "duty") return "duty";
  if (e.type === "break") return "break";
  return "subject";
}

export function displayTitle(subject: Subject, detail?: string | null): string {
  // Subjects are canonical display entities.
  // For duties we make the subject itself the specific duty area, so no special prefixing.
  return subject.title;
}

export function detailForTemplateEvent(e: CycleTemplateEvent): string | null {
  // If you want a secondary line for a template event, add it here.
  // (For duties the subject title is already the area, so no detail.)
  return null;
}

function normaliseKey(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
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

  let r1 = 0, g1 = 0, b1 = 0;
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

  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function autoHexColorForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 0.7, 0.45);
}