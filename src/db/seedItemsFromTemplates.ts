// src/db/seedItemsFromTemplates.ts
import { getDb, type CycleTemplateEvent, type Item, type ItemType } from "./db";
import {
  makeItem,
  makeTemplateItemId,
  upsertItem,
  getItemsByUser,
  canonicalItemIdFromTemplate,
} from "./itemQueries";

function typeFromTemplate(e: CycleTemplateEvent): ItemType {
  return e.type;
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

function autoHexColorForString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 0.7, 0.45);
}

function safeParseMeta(item: Item): any {
  try {
    return item.metaJson ? JSON.parse(item.metaJson) : undefined;
  } catch {
    return undefined;
  }
}

export async function ensureItemsForTemplates(userId: string) {
  const db = await getDb();
  const templates = await db.getAll("cycleTemplateEvents");

  // Load existing items once (avoid per-loop IndexedDB hits)
  const existingItems = await getItemsByUser(userId);

  // Build a “best old tpl-item per canonical id” map to migrate edits.
  const bestOldByCanonical = new Map<string, Item>();

  for (const it of existingItems) {
    // old template-derived items look like `${userId}::tpl::${templateEventId}`
    if (!it.id.startsWith(`${userId}::tpl::`)) continue;

    const meta = safeParseMeta(it);
    // meta.code/title/type are present from previous seed logic; fall back to item fields.
    const type = (meta?.type ?? it.type) as ItemType;
    const title = (meta?.title ?? it.title) as string;
    const code = meta?.code ?? null;

    // Reconstruct canonical id from stored meta if possible by matching a template
    // If meta lacks enough info, we still can use title+type fallback by calling canonicalItemIdFromTemplate,
    // but we don't have a template event here; so use title/code/type directly:
    const canonicalId =
      `${userId}::item::${type}::` +
      (code && String(code).trim()
        ? `code:${String(code).trim().toUpperCase()}`
        : `title:${title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "")}`);

    // Prefer the first one with a non-default-ish colour? We can’t know default reliably,
    // so just take the first and keep it stable.
    if (!bestOldByCanonical.has(canonicalId)) bestOldByCanonical.set(canonicalId, it);
  }

  // Create (or ensure) canonical items
  for (const e of templates) {
    const id = canonicalItemIdFromTemplate(userId, e);

    const already = await db.get("items", id);
    if (already) continue;

    const migrated = bestOldByCanonical.get(id);

    const title = migrated?.title ?? e.title;
    const color =
      migrated?.color ??
      autoHexColorForString(`${e.type}:${e.code ?? ""}:${e.title}`);

    const location = migrated?.location ?? (e.room ?? undefined);

    await upsertItem(
      makeItem(
        userId,
        id,
        typeFromTemplate(e),
        title,
        color,
        location,
        // keep template linkage optional; not required for identity anymore
        { code: e.code, type: e.type }
      )
    );
  }

  // Cleanup: remove old tpl-derived items (they cause the duplicates UI)
  for (const it of existingItems) {
    if (it.id.startsWith(`${userId}::tpl::`)) {
      await db.delete("items", it.id);
    }
  }
}