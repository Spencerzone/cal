// src/db/seedItemsFromTemplates.ts
import { getDb, type CycleTemplateEvent, type ItemType } from "./db";
import { makeItem, makeTemplateItemId, upsertItem } from "./itemQueries";

function typeFromTemplate(e: CycleTemplateEvent): ItemType {
  return e.type; // "class" | "duty" | "break" matches ItemType subset
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function hslToHex(h: number, s: number, l: number): string {
  // h: 0..360, s/l: 0..1
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

function autoHexColorForString(s: string): string {
  // deterministic hash -> hue, then fixed s/l tuned for dark UI
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 0.7, 0.45);
}

export async function ensureItemsForTemplates(userId: string) {
  const db = await getDb();
  const templates = await db.getAll("cycleTemplateEvents");

  // Only create items for template events that are referenced by assignments
  // (optional optimisation; can skip and just create all)
  for (const e of templates) {
    const id = makeTemplateItemId(userId, e.id);

    // If it already exists, leave it alone (preserves manual colour edits)
    const existing = await db.get("items", id);
    if (existing) continue;

    const title = e.title;
    const color = autoHexColorForString(`${e.type}:${e.code ?? ""}:${title}`);
    
    await upsertItem(
      makeItem(
        userId,
        id,
        typeFromTemplate(e),
        title,
        color,
        e.room ?? undefined,
        { templateEventId: e.id, code: e.code, periodCode: e.periodCode }
      )
    );
  }
}