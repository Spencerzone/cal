// src/pages/WeekPage.tsx
import { useEffect, useMemo, useState } from "react";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import { getDb } from "../db/db";
import type { Block, CycleTemplateEvent, DayLabel, SlotAssignment, SlotId } from "../db/db";
import { SLOT_DEFS } from "../rolling/slots";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";
import type { Item } from "../db/db";
import { getItemsByUser, makeTemplateItemId } from "../db/itemQueries";
import { ensureItemsForTemplates } from "../db/seedItemsFromTemplates";

type Cell =
  | { kind: "blank" }
  | { kind: "free" }
  | { kind: "manual"; a: SlotAssignment }
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const userId = "local";

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id])
) as Record<string, SlotId>;

export default function WeekPage() {
  const [itemById, setItemById] = useState<Map<string, Item>>(new Map());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());

  // Map keyed by dateKey ("yyyy-MM-dd") => assignments for that dayLabel
  const [assignmentsByDate, setAssignmentsByDate] = useState<Map<string, Map<SlotId, SlotAssignment>>>(new Map());

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

  // Load templates
  useEffect(() => {
  (async () => {
    await ensureItemsForTemplates(userId);
    const items = await getItemsByUser(userId);
    setItemById(new Map(items.map((it) => [it.id, it])));
  })();
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

      for (const d of weekDays) {
        const dateKey = format(d, "yyyy-MM-dd");

        const canonical = dayLabelForDate(dateKey, settings) as DayLabel | null;
        if (!canonical) {
          out.set(dateKey, new Map()); // non-school day
          continue;
        }

        const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;

        const idx = db.transaction("slotAssignments").store.index("byDayLabel");
        const rows = await idx.getAll(stored);

        const m = new Map<SlotId, SlotAssignment>();
        for (const a of rows) m.set(a.slotId, a);

        out.set(dateKey, m);
      }

      setAssignmentsByDate(out);
    })();
  }, [weekDays]);

  // Build grid: rows=blocks, cols=weekDays
  const grid = useMemo(() => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name]; // undefined for custom blocks => blanks
      const rowCells = weekDays.map((d) => {
        const dateKey = format(d, "yyyy-MM-dd");
        const a = slotId ? assignmentsByDate.get(dateKey)?.get(slotId) : undefined;

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
  }, [blocks, weekDays, assignmentsByDate, templateById]);

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

                    const bg =
                      cell.kind === "template"
                        ? itemById.get(makeTemplateItemId(userId, cell.e.id))?.color
                        : undefined;

                    return (
                      <td key={`${block.id}:${dateKey}`} style={{ verticalAlign: "top" }}>
                        <div className="card" style={{ background: bg ?? "#0f0f0f" }}>
                        {cell.kind === "blank" ? (
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
                              <strong>{cell.e.title}</strong>{" "}
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