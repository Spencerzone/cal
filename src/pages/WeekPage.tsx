import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { getDb } from "../db/db";
import type { CycleTemplateEvent, DayLabel, SlotAssignment, SlotId } from "../db/db";
import { SLOT_DEFS } from "../rolling/slots";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";

type DayColumn = {
  dateKey: string; // YYYY-MM-DD
  header: string;  // Mon 12 Feb
  storedLabel: DayLabel | null;
  assignmentBySlot: Map<SlotId, SlotAssignment>;
};

function localDateFromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y!, (m! - 1), d!);
}

function minutesToLocalDateTime(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, minutes, 0, 0);
  return d;
}

function timeRangeFromTemplate(day: Date, e: CycleTemplateEvent): string {
  const s = minutesToLocalDateTime(day, e.startMinutes);
  const t = minutesToLocalDateTime(day, e.endMinutes);
  return `${format(s, "H:mm")}–${format(t, "H:mm")}`;
}

export default function WeekPage() {
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }) // Monday
  );

  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());
  const [days, setDays] = useState<DayColumn[]>([]);

  // load template once
  useEffect(() => {
    (async () => {
      const db = await getDb();
      const template = await db.getAll("cycleTemplateEvents");
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, []);

  // load week columns whenever weekStart changes
  useEffect(() => {
    (async () => {
      const settings = await getRollingSettings();
      const meta = await getTemplateMeta();
      const db = await getDb();

      const cols: DayColumn[] = [];

      for (let i = 0; i < 5; i++) {
        const d = addDays(weekStart, i);
        const dateKey = format(d, "yyyy-MM-dd");
        const header = format(d, "EEE d MMM");

        const canonical = dayLabelForDate(dateKey, settings) as DayLabel | null;
        const storedLabel = canonical ? (meta ? applyMetaToLabel(canonical, meta) : canonical) : null;

        const assignmentBySlot = new Map<SlotId, SlotAssignment>();

        if (storedLabel) {
          const idx = db.transaction("slotAssignments").store.index("byDayLabel");
          const rows = await idx.getAll(storedLabel);
          for (const a of rows) assignmentBySlot.set(a.slotId, a);
        }

        cols.push({ dateKey, header, storedLabel, assignmentBySlot });
      }

      setDays(cols);
    })();
  }, [weekStart]);

  const weekLabel = useMemo(() => {
    const end = addDays(weekStart, 4);
    return `${format(weekStart, "d MMM")} – ${format(end, "d MMM")}`;
  }, [weekStart]);

  function moveWeek(delta: number) {
    setWeekStart((d) => addDays(d, delta * 7));
  }

  const hasTemplate = templateById.size > 0;

  return (
    <div className="grid">
      <h1>Week</h1>

      <div className="card">
        <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={() => moveWeek(-1)}>Prev</button>
          <div className="badge">{weekLabel}</div>
          <button className="btn" onClick={() => moveWeek(1)}>Next</button>

          <div style={{ flex: 1 }} />

          <button className="btn" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            This week
          </button>
        </div>
        <div className="space" />
        <div className="muted">Shows Mon–Fri using slot assignments; blanks appear where no assignment exists.</div>
      </div>

      {!hasTemplate ? (
        <div className="card">
          <div><strong>No template found.</strong></div>
          <div className="muted">Import ICS and build template first.</div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 160 }} className="muted">Slot</th>
                {days.map((day) => (
                  <th key={day.dateKey} style={{ textAlign: "left", minWidth: 230 }}>
                    <div>{day.header}</div>
                    <div className="muted">
                      {day.storedLabel ? `Cycle: ${day.storedLabel}` : "—"}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {SLOT_DEFS.map((slot) => (
                <tr key={slot.id}>
                  <td style={{ verticalAlign: "top" }}>
                    <div className="badge">{slot.label}</div>
                  </td>

                  {days.map((day) => {
                    const a = day.assignmentBySlot.get(slot.id);
                    const dayDate = localDateFromKey(day.dateKey);

                    // blank if no school day or no assignment
                    if (!day.storedLabel || !a) {
                      return (
                        <td key={`${day.dateKey}::${slot.id}`} style={{ verticalAlign: "top" }}>
                          <div className="card" style={{ background: "#0f0f0f", minHeight: 60 }}>
                            <div className="muted">—</div>
                          </div>
                        </td>
                      );
                    }

                    if (a.kind === "free") {
                      return (
                        <td key={`${day.dateKey}::${slot.id}`} style={{ verticalAlign: "top" }}>
                          <div className="card" style={{ background: "#0f0f0f", minHeight: 60 }}>
                            <div className="muted">Free</div>
                          </div>
                        </td>
                      );
                    }

                    if (a.manualTitle) {
                      return (
                        <td key={`${day.dateKey}::${slot.id}`} style={{ verticalAlign: "top" }}>
                          <div className="card" style={{ background: "#0f0f0f", minHeight: 60 }}>
                            <div>
                              <strong>{a.manualTitle}</strong>{" "}
                              {a.manualCode ? <span className="muted">({a.manualCode})</span> : null}
                            </div>
                            <div className="muted">
                              {a.manualRoom ? <span className="badge">Room {a.manualRoom}</span> : null}{" "}
                              <span className="badge">{a.kind}</span>
                            </div>
                          </div>
                        </td>
                      );
                    }

                    const e = a.sourceTemplateEventId ? templateById.get(a.sourceTemplateEventId) : undefined;

                    return (
                      <td key={`${day.dateKey}::${slot.id}`} style={{ verticalAlign: "top" }}>
                        <div className="card" style={{ background: "#0f0f0f", minHeight: 60 }}>
                          {!e ? (
                            <div className="muted">—</div>
                          ) : (
                            <>
                              <div>
                                <strong>{e.title}</strong>{" "}
                                {e.code ? <span className="muted">({e.code})</span> : null}
                                <span style={{ marginLeft: 10 }} className="muted">
                                  {timeRangeFromTemplate(dayDate, e)}
                                </span>
                              </div>
                              <div className="muted">
                                {e.room ? <span className="badge">Room {e.room}</span> : null}{" "}
                                {e.periodCode ? <span className="badge">{e.periodCode}</span> : null}{" "}
                                <span className="badge">{a.kind}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}