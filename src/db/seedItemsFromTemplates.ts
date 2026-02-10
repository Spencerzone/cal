// src/db/seedItemsFromTemplates.ts
import { getDb, type CycleTemplateEvent, type ItemType } from "./db";
import { makeItem, makeTemplateItemId, upsertItem } from "./itemQueries";

function typeFromTemplate(e: CycleTemplateEvent): ItemType {
  return e.type; // "class" | "duty" | "break" matches ItemType subset
}

function autoColorForString(s: string): string {
  // simple deterministic hash -> hue; produces a nice spread
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 45%)`; // works in CSS; change later to hex if you prefer
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
    const color = autoColorForString(`${e.type}:${e.code ?? ""}:${title}`);

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