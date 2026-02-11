// src/pages/WeekPage.tsx
import { useEffect, useMemo, useState } from "react";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import { getDb } from "../db/db";
import type { Block, CycleTemplateEvent, DayLabel, SlotAssignment, SlotId, Subject } from "../db/db";
import { SLOT_DEFS } from "../rolling/slots";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";

import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
import { getSubjectsByUser } from "../db/subjectQueries";
import { subjectIdForTemplateEvent, detailForTemplateEvent, displayTitle } from "../db/subjectUtils";
import { getPlacementsForDayLabels } from "../db/placementQueries";

type Cell =
  | { kind: "blank" }
  | { kind: "free" }
  | { kind: "manual"; a: SlotAssignment }
  | { kind: "placed"; subjectId: string }
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const userId = "local";

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id])
) as Record<string, SlotId>;

export default function WeekPage() {
  const [subjectById, setSubjectById] = useState<Map<string, Subject>>(new Map());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());

  // Map keyed by dateKey ("yyyy-MM-dd") => assignments for that dayLabel
  const [assignmentsByDate, setAssignmentsByDate] = useState<Map<string, Map<SlotId, SlotAssignment>>>(new Map());

  // Map keyed by dateKey => resolved canonical dayLabel (after meta mapping)
  const [dayLabelByDate, setDayLabelByDate] = useState<Map<string, DayLabel>>(new Map());

  // Map keyed by dateKey => slotId -> subjectId|null (null = blank override)
  const [placementsByDate, setPlacementsByDate] = useState<Map<string, Map<SlotId, string | null>>>(new Map());

  // Cursor is Monday of the week being viewed
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Load blocks
  useEffect(() => {
    (async () => {
      await ensureDefaultBlocks(userId);
      setBlocks(await getVisibleBlocks(userId));
    })();
  }, []);

  async function loadSubjects() {
    await ensureSubjectsFromTemplates(userId);
    const subs = await getSubjectsByUser(userId);
    setSubjectById(new Map(subs.map((s) => [s.id, s])));
  }

  // Load subjects and keep them in sync with edits.
  useEffect(() => {
    loadSubjects();

    const onChanged = () => loadSubjects();
    const onFocus = () => loadSubjects();
    const onVis = () => {
      if (document.visibilityState === "visible") loadSubjects();
    };

    window.addEventListener("subjects-changed", onChanged as any);
    window.addEventListener("focus", onFocus as any);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("subjects-changed", onChanged as any);
      window.removeEventListener("focus", onFocus as any);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Load templates
  useEffect(() => {
    (async () => {
      const db = await getDb();
      const template = await db.getAll("cycleTemplateEvents");
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, []);

  // Load assignments for each Mon-Fri date in the viewed week
  useEffect(() => {
    (async () => {
      const settings = await getRollingSettings();
      const meta = await getTemplateMeta();

      const db = await getDb();
      const out = new Map<string, Map<SlotId, SlotAssignment>>();
      const dlOut = new Map<string, DayLabel>();

      for (const d of weekDays) {
        const dateKey = format(d, "yyyy-MM-dd");

        const canonical = dayLabelForDate(dateKey, settings) as DayLabel | null;
        if (!canonical) {
          out.set(dateKey, new Map()); // non-school day
          continue;
        }

        const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;
        dlOut.set(dateKey, stored);

        const idx = db.transaction("slotAssignments").store.index("byDayLabel");
        const rows = await idx.getAll(stored);

        const m = new Map<SlotId, SlotAssignment>();
        for (const a of rows) m.set(a.slotId, a);

        out.set(dateKey, m);
      }

      setAssignmentsByDate(out);
      setDayLabelByDate(dlOut);
    })();
  }, [weekDays]);

  // Load placements for the dayLabels used this week
  useEffect(() => {
    (async () => {
      const unique = Array.from(new Set(Array.from(dayLabelByDate.values())));
      if (unique.length === 0) {
        setPlacementsByDate(new Map());
        return;
      }
      const ps = await getPlacementsForDayLabels(userId, unique);

      // Build mapping by dayLabel -> slotId -> subjectId
      const byLabel = new Map<DayLabel, Map<SlotId, string | null>>();
      for (const p of ps) {
        const m = byLabel.get(p.dayLabel) ?? new Map<SlotId, string | null>();
        m.set(p.slotId, p.subjectId);
        byLabel.set(p.dayLabel, m);
      }

      // Map into dateKeys for this week
      const byDate = new Map<string, Map<SlotId, string | null>>();
      for (const [dateKey, dl] of dayLabelByDate) {
        byDate.set(dateKey, byLabel.get(dl) ?? new Map());
      }
      setPlacementsByDate(byDate);
    })();
  }, [dayLabelByDate]);

  // Refresh placements when changed elsewhere
  useEffect(() => {
    const onChanged = () => {
      // re-run effect by cloning dayLabelByDate
      setDayLabelByDate(new Map(dayLabelByDate));
    };
    window.addEventListener("placements-changed", onChanged as any);
    return () => window.removeEventListener("placements-changed", onChanged as any);
  }, [dayLabelByDate]);

  // Build grid: rows=blocks, cols=weekDays
  const grid = useMemo(() => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name]; // undefined for custom blocks => blanks
      const rowCells = weekDays.map((d) => {
        const dateKey = format(d, "yyyy-MM-dd");
        if (!slotId) return { kind: "blank" } as Cell;

        const overrideMap = placementsByDate.get(dateKey);
        if (overrideMap && overrideMap.has(slotId)) {
          const ov = overrideMap.get(slotId);
          if (ov === null) return { kind: "blank" } as Cell;
          if (typeof ov === "string") return { kind: "placed", subjectId: ov } as Cell;
        }

        const a = assignmentsByDate.get(dateKey)?.get(slotId);

        if (!a) return { kind: "blank" } as Cell;
        if (a.kind === "free") return { kind: "free" } as Cell;
        if (a.manualTitle) return { kind: "manual", a } as Cell;

        if (a.sourceTemplateEventId) {
          const e = templateById.get(a.sourceTemplateEventId);
          if (e) return { kind: "template", a, e } as Cell;
        }

        return { kind: "blank" } as Cell;
      });

      return { block: b, cells: rowCells };
    });
  }, [blocks, weekDays, assignmentsByDate, templateById, placementsByDate]);

  return (
    <div className="grid">
      <h1>Week</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <strong>
              {format(weekStart, "d MMM")} – {format(addDays(weekStart, 4), "d MMM")}
            </strong>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => setWeekStart((d) => addWeeks(d, -1))}>Prev</button>
            <button onClick={() => setWeekStart((d) => addWeeks(d, 1))}>Next</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: 180 }} className="muted">
                Block
              </th>
              {weekDays.map((d) => (
                <th key={format(d, "yyyy-MM-dd")} style={{ textAlign: "left" }} className="muted">
                  {format(d, "EEE")} <span className="muted">{format(d, "d/M")}</span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {grid.map(({ block, cells }) => (
              <tr key={block.id}>
                <td style={{ verticalAlign: "top" }}>
                  <div className="badge">{block.name}</div>
                </td>

                {cells.map((cell, i) => {
                  const dateKey = format(weekDays[i], "yyyy-MM-dd");
                  const slotId = SLOT_LABEL_TO_ID[block.name];
                  const override = slotId ? placementsByDate.get(dateKey)?.get(slotId) : undefined;

                  const overrideSubject = typeof override === "string" ? subjectById.get(override) : undefined;

                  const subject =
                    cell.kind === "template" ? subjectById.get(subjectIdForTemplateEvent(cell.e)) : undefined;
                  const detail = cell.kind === "template" ? detailForTemplateEvent(cell.e) : null;
                  const bg = override === null ? "#0f0f0f" : (overrideSubject?.color ?? subject?.color);

                  return (
                    <td key={`${block.id}:${dateKey}`} style={{ verticalAlign: "top" }}>
                      <div className="card" style={{ background: bg ?? "#0f0f0f" }}>
                        {override === null ? (
                          <div className="muted">—</div>
                        ) : overrideSubject ? (
                          <>
                            <div>
                              <strong>{overrideSubject.title}</strong> {overrideSubject.code ? <span className="muted">({overrideSubject.code})</span> : null}
                            </div>
                            <div className="muted">
                              <span className="badge">{overrideSubject.kind}</span>
                            </div>
                          </>
                        ) : cell.kind === "blank" ? (
                          <div className="muted">—</div>
                        ) : cell.kind === "free" ? (
                          <div className="muted">Free</div>
                        ) : cell.kind === "manual" ? (
                          <>
                            <div>
                              <strong>{cell.a.manualTitle}</strong>{" "}
                              {cell.a.manualCode ? <span className="muted">({cell.a.manualCode})</span> : null}
                            </div>
                            <div className="muted">
                              {cell.a.manualRoom ? <span className="badge">Room {cell.a.manualRoom}</span> : null}{" "}
                              <span className="badge">{cell.a.kind}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <strong>{subject ? displayTitle(subject, detail) : cell.e.title}</strong>{" "}
                              {cell.e.code ? <span className="muted">({cell.e.code})</span> : null}
                            </div>
                            <div className="muted">
                              {cell.e.room ? <span className="badge">Room {cell.e.room}</span> : null}{" "}
                              {cell.e.periodCode ? <span className="badge">{cell.e.periodCode}</span> : null}{" "}
                              <span className="badge">{cell.a.kind}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}

            {grid.length === 0 ? (
              <tr>
                <td colSpan={1 + weekDays.length} className="muted">
                  No data.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}