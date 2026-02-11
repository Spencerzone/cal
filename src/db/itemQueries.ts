// src/db/itemQueries.ts
import { getDb, type Item, type ItemType, type CycleTemplateEvent } from "./db";

export async function upsertItem(item: Item): Promise<void> {
  const db = await getDb();
  await db.put("items", item);
}

export async function getItemsByUser(userId: string): Promise<Item[]> {
  const db = await getDb();
  return db.getAllFromIndex("items", "byUserId", userId);
}

// Old (leave if you want for migration/debug; don't use for new logic)
export function makeTemplateItemId(userId: string, templateEventId: string) {
  return `${userId}::tpl::${templateEventId}`;
}

function normCode(code: string) {
  return code.trim().toUpperCase();
}

function normTitle(title: string) {
  return title.trim().replace(/\s+/g, " ");
}

function slug(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "");
}

// Similar to autoHexColorForString but stable per canonical item (not per template event which can change).
function normKey(s: string) {
  return s.trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9]/g, "");
}

function deriveCodeFromTitle(type: string, title: string): string | null {
  const t = title.trim();

  // Handles: "Duty.OvalN", "Duty: OvalN", "Duty - OvalN"
  if (type === "duty") {
    const m = t.match(/^duty[\s\.\:\-]+(.+)$/i);
    if (m?.[1]) return normKey(m[1]);
  }

  return null;
}

/**
 * Canonical ID: one Item per (type + code) where possible.
 * Fallback: (type + normalised title).
 */
export function makeCanonicalItemId(
  userId: string,
  type: string,
  code: string | null | undefined,
  title: string
) {
  const fromCode = code && code.trim() ? normKey(code) : null;
  const fromTitle = deriveCodeFromTitle(type, title);

  const key =
    fromCode ? `code:${fromCode}` :
    fromTitle ? `code:${fromTitle}` :
    `title:${title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "")}`;

  return `${userId}::item::${type}::${key}`;
}

export function canonicalItemIdFromTemplate(userId: string, e: CycleTemplateEvent) {
  return makeCanonicalItemId(userId, e.type, e.code ?? null, e.title);
}

export function makeItem(
  userId: string,
  id: string,
  type: ItemType,
  title: string,
  color: string,
  location?: string,
  meta?: any
): Item {
  return {
    id,
    userId,
    type,
    title,
    location,
    color,
    metaJson: meta ? JSON.stringify(meta) : undefined,
  };
}