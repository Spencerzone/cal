import { useEffect, useMemo, useState } from "react";
import { getAllCycleTemplateEvents, dayLabelsForSet } from "../db/templateQueries";
import type { CycleTemplateEvent, DayLabel } from "../db/db";

type SlotKey = string;

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
  const slots = useMemo(() => {
    const slotMap = new Map<SlotKey, { sort: number }>();
    for (const e of filtered) {
      if (!labels.includes(e.dayLabel)) continue;
      const k = slotKey(e);
      // sort by startMinutes primarily
      const sort = e.startMinutes * 10 + (e.periodCode ? 0 : 1);
      if (!slotMap.has(k)) slotMap.set(k, { sort });
      else slotMap.get(k)!.sort = Math.min(slotMap.get(k)!.sort, sort);
    }
    return [...slotMap.entries()]
      .sort((a,b) => a[1].sort - b[1].sort)
      .map(([k]) => k);
  }, [filtered, labels]);

  // Cell lookup: dayLabel + slotKey -> events
  const cell = useMemo(() => {
    const m = new Map<string, CycleTemplateEvent[]>();
    for (const e of filtered) {
      if (!labels.includes(e.dayLabel)) continue;
      const k = `${e.dayLabel}::${slotKey(e)}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    // stable order inside cells: startMinutes then title
    for (const [k, arr] of m) {
      arr.sort((a,b) => (a.startMinutes - b.startMinutes) || a.title.localeCompare(b.title));
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
              {slots.map((sk) => (
                <tr key={sk}>
                  <td style={{ verticalAlign: "top" }}>
                    <div className="badge">{slotLabelFromKey(sk)}</div>
                  </td>
                  {labels.map((dl) => {
                    const k = `${dl}::${sk}`;
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
                                    {e.periodCode ? <span className="badge">P{e.periodCode}</span> : null}{" "}
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}