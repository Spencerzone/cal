import { getDb } from "../db/db";
import type { DayLabel, CycleTemplateEvent } from "../db/db";

export type TemplateMeta = {
  anchorMonday: string;  // YYYY-MM-DD
  cycleDates: string[];  // length 10
  shift: number;         // 0..9
  flipped: boolean;
  builtAt: number;
};

const CANON_LABELS: DayLabel[] = [
  "MonA","TueA","WedA","ThuA","FriA",
  "MonB","TueB","WedB","ThuB","FriB",
];

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function rotateLabels(labels: DayLabel[], shift: number): DayLabel[] {
  const s = mod(shift, labels.length);
  return labels.map((_, i) => labels[mod(i + s, labels.length)]!);
}

function flipLabel(l: DayLabel): DayLabel {
  const d = l.slice(0, 3);           // Mon
  const set = l.slice(3) as "A"|"B"; // A/B
  return `${d}${set === "A" ? "B" : "A"}` as DayLabel;
}

export async function getTemplateMeta(): Promise<TemplateMeta | null> {
  const db = await getDb();
  const row = await db.get("settings", "templateMeta");
  return (row?.value as TemplateMeta) ?? null;
}

export async function saveTemplateMeta(meta: TemplateMeta) {
  const db = await getDb();
  await db.put("settings", { key: "templateMeta", value: meta });
}

export function mappingPreview(meta: TemplateMeta): Array<{ date: string; label: DayLabel }> {
  const base = CANON_LABELS.slice();
  let labels = rotateLabels(base, meta.shift);
  if (meta.flipped) labels = labels.map(flipLabel);
  return meta.cycleDates.map((date, i) => ({ date, label: labels[i]! }));
}

export async function applyTemplateMapping(nextShift: number, nextFlipped: boolean) {
  const db = await getDb();
  const meta = await getTemplateMeta();
  if (!meta) throw new Error("No templateMeta found. Rebuild template from ICS first.");

  // Build old->new dayLabel mapping based on canonical labels
  const oldBase = CANON_LABELS.slice();
  let oldLabels = rotateLabels(oldBase, meta.shift);
  if (meta.flipped) oldLabels = oldLabels.map(flipLabel);

  let newLabels = rotateLabels(oldBase, nextShift);
  if (nextFlipped) newLabels = newLabels.map(flipLabel);

  const map = new Map<DayLabel, DayLabel>();
  for (let i = 0; i < oldLabels.length; i++) {
    map.set(oldLabels[i]!, newLabels[i]!);
  }

  const tx = db.transaction(["cycleTemplateEvents", "settings"], "readwrite");
  const store = tx.objectStore("cycleTemplateEvents");

  let cursor = await store.openCursor();
  while (cursor) {
    const ev = cursor.value as CycleTemplateEvent;
    const newLabel = map.get(ev.dayLabel);
    if (newLabel && newLabel !== ev.dayLabel) {
      // Update label and keep id stable-ish by rewriting the prefix.
      // If your id format is `${label}-${hash}`, this preserves uniqueness.
      const parts = ev.id.split("-");
      const newId = [newLabel, ...parts.slice(1)].join("-");
      await cursor.delete();
      await store.put({ ...ev, dayLabel: newLabel, id: newId });
    }
    cursor = await cursor.continue();
  }

  const nextMeta: TemplateMeta = {
    ...meta,
    shift: ((nextShift % 10) + 10) % 10,
    flipped: nextFlipped,
  };
  await tx.objectStore("settings").put({ key: "templateMeta", value: nextMeta });

  await tx.done;
}