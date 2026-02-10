import { useEffect, useMemo, useState } from "react";
import { dayLabelsForSet } from "../db/templateQueries";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";
import { getDb } from "../db/db";
import type { CycleTemplateEvent, DayLabel, SlotAssignment, SlotId } from "../db/db";

type SlotDef = { id: SlotId; label: string };

const SLOT_DEFS: SlotDef[] = [
  { id: "before", label: "Before school" },
  { id: "rc", label: "Roll call" },
  { id: "p1", label: "Period 1" },
  { id: "p2", label: "Period 2" },
  { id: "r1", label: "Recess 1" },
  { id: "r2", label: "Recess 2" },
  { id: "p3", label: "Period 3" },
  { id: "p4", label: "Period 4" },
  { id: "l1", label: "Lunch 1" },
  { id: "l2", label: "Lunch 2" },
  { id: "p5", label: "Period 5" },
  { id: "p6", label: "Period 6" },
  { id: "after", label: "After school" },
];

function weekdayFromLabel(label: DayLabel): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" {
  return label.slice(0, 3) as any;
}

export default function MatrixPage() {
  const [set, setSet] = useState<"A" | "B">("A");

  // These now filter ASSIGNMENTS, not raw events
  const [showBreaks, setShowBreaks] = useState(true);
  const [showDuties, setShowDuties] = useState(true);

  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());
  const [assignments, setAssignments] = useState<SlotAssignment[]>([]);

  const labels = useMemo(() => dayLabelsForSet(set), [set]);
  const rows = useMemo(() => SLOT_DEFS, []);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const template = await db.getAll("cycleTemplateEvents");
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const a = await getAssignmentsForDayLabels(labels);
      setAssignments(a);
    })();
  }, [labels]);

  const filteredAssignments = useMemo(() => {
    return assignments.filter((a) => {
      if (!showBreaks && a.kind === "break") return false;
      if (!showDuties && a.kind === "duty") return false;
      return true;
    });
  }, [assignments, showBreaks, showDuties]);

  // Cell lookup: `${dayLabel}::${slotId}` -> single resolved entry
  const cell = useMemo(() => {
    const m = new Map<
      string,
      { kind: SlotAssignment["kind"]; item?: CycleTemplateEvent; manual?: SlotAssignment }
    >();

    for (const a of filteredAssignments) {
      const k = `${a.dayLabel}::${a.slotId}`;

      if (a.kind === "free") {
        m.set(k, { kind: "free" });
        continue;
      }

      if (a.manualTitle) {
        m.set(k, { kind: a.kind, manual: a });
        continue;
      }

      if (a.sourceTemplateEventId) {
        const te = templateById.get(a.sourceTemplateEventId);
        if (te) m.set(k, { kind: a.kind, item: te });
      }
    }

    return m;
  }, [filteredAssignments, templateById]);

  const hasTemplate = templateById.size > 0;

  return (
    <div className="grid">
      <h1>Fortnight matrix</h1>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setSet("A")} aria-pressed={set === "A"}>
            Week A
          </button>
          <button className="btn" onClick={() => setSet("B")} aria-pressed={set === "B"}>
            Week B
          </button>

          <div style={{ flex: 1 }} />

          <label className="row muted" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={showBreaks}
              onChange={(e) => setShowBreaks(e.target.checked)}
            />
            breaks
          </label>
          <label className="row muted" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={showDuties}
              onChange={(e) => setShowDuties(e.target.checked)}
            />
            duties
          </label>
        </div>

        <div className="space" />
        <div className="muted">
          Shows the {set}-week template (Mon–Fri). One assignment per slot.
        </div>
      </div>

      {!hasTemplate ? (
        <div className="card">
          <div>
            <strong>No template found.</strong>
          </div>
          <div className="muted">Import an ICS and build the MonA–FriB template first.</div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 140 }} className="muted">
                  Slot
                </th>
                {labels.map((dl) => (
                  <th key={dl} style={{ textAlign: "left", minWidth: 190 }}>
                    {weekdayFromLabel(dl)} <span className="muted">{set}</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ verticalAlign: "top" }}>
                    <div className="badge">{row.label}</div>
                  </td>

                  {labels.map((dl) => {
                    const k = `${dl}::${row.id}`;
                    const entry = cell.get(k);

                    return (
                      <td key={k} style={{ verticalAlign: "top" }}>
                        <div className="card" style={{ background: "#0f0f0f", minHeight: 60 }}>
                          {!entry ? (
                            <div className="muted">—</div>
                          ) : entry.kind === "free" ? (
                            <div className="muted">Free</div>
                          ) : entry.manual ? (
                            <>
                              <div>
                                <strong>{entry.manual.manualTitle}</strong>{" "}
                                {entry.manual.manualCode ? (
                                  <span className="muted">({entry.manual.manualCode})</span>
                                ) : null}
                              </div>
                              <div className="muted">
                                {entry.manual.manualRoom ? (
                                  <span className="badge">Room {entry.manual.manualRoom}</span>
                                ) : null}{" "}
                                <span className="badge">{entry.kind}</span>
                              </div>
                            </>
                          ) : entry.item ? (
                            <>
                              <div>
                                <strong>{entry.item.title}</strong>{" "}
                                {entry.item.code ? <span className="muted">({entry.item.code})</span> : null}
                              </div>
                              <div className="muted">
                                {entry.item.room ? <span className="badge">Room {entry.item.room}</span> : null}{" "}
                                {entry.item.periodCode ? (
                                  <span className="badge">{entry.item.periodCode}</span>
                                ) : null}{" "}
                                <span className="badge">{entry.kind}</span>
                              </div>
                            </>
                          ) : (
                            <div className="muted">—</div>
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