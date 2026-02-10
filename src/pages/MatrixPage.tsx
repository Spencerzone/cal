import { useEffect, useMemo, useState } from "react";
import { getAllCycleTemplateEvents, dayLabelsForSet } from "../db/templateQueries";
import type { CycleTemplateEvent, DayLabel } from "../db/db";

type SlotKey = string;

type SlotId =
  | "before"
  | "rc"
  | "p1"
  | "p2"
  | "r1"
  | "r2"
  | "p3"
  | "p4"
  | "l1"
  | "l2"
  | "p5"
  | "p6"
  | "after"
  | "other";

type SlotDef = {
  id: SlotId;
  label: string;
};

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
  { id: "p6", label: "Period 6" }, // will just be blank on most days if no events exist
  { id: "after", label: "After school" },
];

function normalisePeriodCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toUpperCase();
}

function slotForEvent(periodCode: string | null | undefined, title: string): SlotId {
  const p = normalisePeriodCode(periodCode);

  // Sentral duties often use "Before School"/"After School" as Period
  if (p === "BEFORE SCHOOL" || p === "BEFORE") return "before";
  if (p === "AFTER SCHOOL" || p === "AFTER") return "after";

  // Standard codes
  if (p === "RC" || p === "ROLL CALL" || p === "ROLLCALL") return "rc";
  if (p === "1") return "p1";
  if (p === "2") return "p2";
  if (p === "3") return "p3";
  if (p === "4") return "p4";
  if (p === "5") return "p5";
  if (p === "6") return "p6";

  // Recess/Lunch split
  if (p === "R1" || p === "RECESS 1") return "r1";
  if (p === "R2" || p === "RECESS 2") return "r2";
  if (p === "L1" || p === "LUNCH 1") return "l1";
  if (p === "L2" || p === "LUNCH 2") return "l2";

  // Some exports label breaks as just "RECESS"/"LUNCH"
  if (p === "RECESS") return "r1";
  if (p === "LUNCH") return "l1";

  // Fallback: duties sometimes encode it in title
  const t = title.toUpperCase();
  if (t.includes("BEFORE SCHOOL")) return "before";
  if (t.includes("AFTER SCHOOL")) return "after";

  return "other";
}

function mmToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function slotKey(e: CycleTemplateEvent): SlotKey {
  // prefer periodCode alignment; fall back to time range
  const p = e.periodCode ?? "";
  return `${p}|${e.startMinutes}-${e.endMinutes}`;
}

function slotLabelFromKey(k: SlotKey): string {
  const [p, times] = k.split("|");
  const [s, e] = (times ?? "").split("-").map((x) => Number(x));
  const t = Number.isFinite(s) && Number.isFinite(e) ? `${mmToTime(s)}–${mmToTime(e)}` : "";
  return p ? `P${p} ${t}`.trim() : t;
}

function weekdayFromLabel(label: DayLabel): "Mon"|"Tue"|"Wed"|"Thu"|"Fri" {
  return label.slice(0, 3) as any;
}

export default function MatrixPage() {
  const [set, setSet] = useState<"A"|"B">("A");
  const [showBreaks, setShowBreaks] = useState(true);
  const [showDuties, setShowDuties] = useState(true);
  const [events, setEvents] = useState<CycleTemplateEvent[]>([]);

  useEffect(() => {
    (async () => {
      const all = await getAllCycleTemplateEvents();
      setEvents(all);
    })();
  }, []);

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (!showBreaks && e.type === "break") return false;
      if (!showDuties && e.type === "duty") return false;
      return true;
    });
  }, [events, showBreaks, showDuties]);

  const labels = useMemo(() => dayLabelsForSet(set), [set]);

  // Determine canonical “rows” (time/period slots) for the chosen set
  const rows = useMemo(() => SLOT_DEFS, []);

  // Cell lookup: dayLabel + slotKey -> events
  const cell = useMemo(() => {
  const m = new Map<string, CycleTemplateEvent[]>();
  for (const e of filtered) {
    if (!labels.includes(e.dayLabel)) continue;

    const slotId = slotForEvent(e.periodCode, e.title);
    const k = `${e.dayLabel}::${slotId}`;

    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(e);
  }

  // Sort within each cell: class first, then duties/breaks, then by time/title
  for (const [k, arr] of m) {
    arr.sort((a, b) => {
      const typeRank = (x: CycleTemplateEvent["type"]) =>
        x === "class" ? 0 : x === "duty" ? 1 : 2;

      return (
        typeRank(a.type) - typeRank(b.type) ||
        a.startMinutes - b.startMinutes ||
        a.title.localeCompare(b.title)
      );
    });
    m.set(k, arr);
  }
  return m;
}, [filtered, labels]);

  const hasTemplate = events.length > 0;

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
            <input type="checkbox" checked={showBreaks} onChange={(e) => setShowBreaks(e.target.checked)} />
            breaks
          </label>
          <label className="row muted" style={{ gap: 6 }}>
            <input type="checkbox" checked={showDuties} onChange={(e) => setShowDuties(e.target.checked)} />
            duties
          </label>
        </div>

        <div className="space" />
        <div className="muted">
          Shows the {set}-week template (Mon–Fri). Rolling dates are generated elsewhere; this is the pattern view.
        </div>
      </div>

      {!hasTemplate ? (
        <div className="card">
          <div><strong>No template found.</strong></div>
          <div className="muted">
            Import an ICS and build the MonA–FriB template first.
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 140 }} className="muted">Slot</th>
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
        const items = cell.get(k) ?? [];
        return (
          <td key={k} style={{ verticalAlign: "top" }}>
            <div className="card" style={{ background: "#0f0f0f", minHeight: 60 }}>
              {items.length === 0 ? (
                <div className="muted">—</div>
              ) : (
                <div className="grid" style={{ gap: 8 }}>
                  {items.map((e) => (
                    <div key={e.id}>
                      <div>
                        <strong>{e.title}</strong>{" "}
                        {e.code ? <span className="muted">({e.code})</span> : null}
                      </div>
                      <div className="muted">
                        {e.room ? <span className="badge">Room {e.room}</span> : null}{" "}
                        {e.periodCode ? <span className="badge">{e.periodCode}</span> : null}{" "}
                        <span className="badge">{e.type}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  ))}

  {/* Optional: show "Other" row only if needed */}
  {(() => {
    const hasOther = labels.some((dl) => (cell.get(`${dl}::other`) ?? []).length > 0);
    if (!hasOther) return null;
    return (
      <tr>
        <td style={{ verticalAlign: "top" }}>
          <div className="badge">Other</div>
        </td>
        {labels.map((dl) => {
          const k = `${dl}::other`;
          const items = cell.get(k) ?? [];
          return (
            <td key={k} style={{ verticalAlign: "top" }}>
              <div className="card" style={{ background: "#0f0f0f", minHeight: 60 }}>
                {items.length === 0 ? (
                  <div className="muted">—</div>
                ) : (
                  <div className="grid" style={{ gap: 8 }}>
                    {items.map((e) => (
                      <div key={e.id}>
                        <div>
                          <strong>{e.title}</strong>{" "}
                          {e.code ? <span className="muted">({e.code})</span> : null}
                        </div>
                        <div className="muted">
                          {e.room ? <span className="badge">Room {e.room}</span> : null}{" "}
                          {e.periodCode ? <span className="badge">{e.periodCode}</span> : null}{" "}
                          <span className="badge">{e.type}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </td>
          );
        })}
      </tr>
    );
  })()}
</tbody>
          </table>
        </div>
      )}
    </div>
  );
}