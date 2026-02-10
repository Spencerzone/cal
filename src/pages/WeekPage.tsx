// src/pages/WeekPage.tsx
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { getDb } from "../db/db";
import type { Block, CycleTemplateEvent, DayLabel, SlotAssignment, SlotId } from "../db/db";
import { SLOT_DEFS } from "../rolling/slots";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";

type Cell =
  | { kind: "blank" }
  | { kind: "free" }
  | { kind: "manual"; a: SlotAssignment }
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const userId = "local";

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id])
) as Record<string, SlotId>;

function weekdayFromLabel(label: DayLabel): string {
  return label.slice(0, 3);
}

export default function WeekPage() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());
  const [assignmentsByLabel, setAssignmentsByLabel] = useState<Map<DayLabel, Map<SlotId, SlotAssignment>>>(new Map());
  const [weekLabels, setWeekLabels] = useState<DayLabel[]>([]);

  const todayKey = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

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
      const db = await getDb();
      const template = await db.getAll("cycleTemplateEvents");
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, []);

  // Compute week labels (A or B) based on today (uses your existing rolling settings + mapping)
  useEffect(() => {
    (async () => {
      const settings = await getRollingSettings();
      const canonicalToday = dayLabelForDate(todayKey, settings) as DayLabel | null;

      if (!canonicalToday) {
        setWeekLabels([]);
        return;
      }

      const meta = await getTemplateMeta();
      const storedToday = meta ? applyMetaToLabel(canonicalToday, meta) : canonicalToday;

      // ---------- EDIT HERE IF YOUR LABEL SYSTEM DIFFERS ----------
      // Determine whether we're in A or B week based on storedToday suffix (MonA -> "A")
      const weekSuffix = storedToday.slice(3) as "A" | "B";
      const labels: DayLabel[] = (["Mon", "Tue", "Wed", "Thu", "Fri"] as const).map(
        (d) => `${d}${weekSuffix}` as DayLabel
      );
      // ------------------------------------------------------------

      setWeekLabels(labels);
    })();
  }, [todayKey]);

  // Load assignments for the week labels
  useEffect(() => {
    (async () => {
      if (weekLabels.length === 0) {
        setAssignmentsByLabel(new Map());
        return;
      }

      const db = await getDb();
      const out = new Map<DayLabel, Map<SlotId, SlotAssignment>>();

      for (const lbl of weekLabels) {
        const idx = db.transaction("slotAssignments").store.index("byDayLabel");
        const rows = await idx.getAll(lbl);

        const m = new Map<SlotId, SlotAssignment>();
        for (const a of rows) m.set(a.slotId, a);
        out.set(lbl, m);
      }

      setAssignmentsByLabel(out);
    })();
  }, [weekLabels]);

  // Build grid: rows=blocks, cols=weekLabels
  const grid = useMemo(() => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name]; // may be undefined for new custom blocks
      const rowCells = weekLabels.map((lbl) => {
        const a = slotId ? assignmentsByLabel.get(lbl)?.get(slotId) : undefined;

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
  }, [blocks, weekLabels, assignmentsByLabel, templateById]);

  return (
    <div className="grid">
      <h1>Week</h1>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: 180 }} className="muted">
                Block
              </th>
              {weekLabels.map((lbl) => (
                <th key={lbl} style={{ textAlign: "left" }} className="muted">
                  {weekdayFromLabel(lbl)}
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

                {cells.map((cell, i) => (
                  <td key={`${block.id}:${weekLabels[i]}`} style={{ verticalAlign: "top" }}>
                    <div className="card" style={{ background: "#0f0f0f" }}>
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
                ))}
              </tr>
            ))}

            {grid.length === 0 ? (
              <tr>
                <td colSpan={1 + weekLabels.length} className="muted">
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