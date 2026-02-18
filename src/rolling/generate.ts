// src/rolling/generate.ts (Firestore-backed)

import type { CycleTemplateEvent, DayLabel, SlotId, SlotAssignment } from "../db/db";
import type { RollingSettings } from "./settings";
import { dayLabelForDate } from "./cycle";
import { getTemplateMeta, applyMetaToLabel } from "./templateMapping";
import { getAllCycleTemplateEvents } from "../db/templateQueries";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";

export type GeneratedEvent = {
  slotId: SlotId;
  kind: SlotAssignment["kind"];
  templateEvent?: CycleTemplateEvent;
};

export async function generateForDate(
  userId: string,
  localDateKey: string,
  settings: RollingSettings
): Promise<GeneratedEvent[]> {
  const canonical = dayLabelForDate(localDateKey, settings) as DayLabel | null;
  if (!canonical) return [];

  const meta = await getTemplateMeta(userId);
  const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;

  const [templateEvents, assignments] = await Promise.all([
    getAllCycleTemplateEvents(userId),
    getAssignmentsForDayLabels(userId, [stored]),
  ]);

  const templateById = new Map(templateEvents.map((e) => [e.id, e]));
  const bySlot = new Map<SlotId, SlotAssignment>();
  for (const a of assignments) if (a.dayLabel === stored) bySlot.set(a.slotId, a);

  const out: GeneratedEvent[] = [];
  for (const a of bySlot.values()) {
    out.push({
      slotId: a.slotId,
      kind: a.kind,
      templateEvent: a.sourceTemplateEventId ? templateById.get(a.sourceTemplateEventId) : undefined,
    });
  }
  return out;
}
