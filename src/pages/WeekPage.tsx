// src/pages/WeekPage.tsx 3
import { useEffect, useMemo, useState } from "react";
import { getEventsForRange, weekRangeUtc } from "../db/queries";
import { formatDayLabel, formatEventTime, toLocalDayKey } from "../util/time";
import type { BaseEvent } from "../ics/parseIcs";

export default function WeekPage() {
  const [events, setEvents] = useState<BaseEvent[]>([]);

  useEffect(() => {
    (async () => {
      const { startUtc, endUtc } = weekRangeUtc(new Date());
      const evs = await getEventsForRange(startUtc, endUtc);
      evs.sort((a, b) => a.dtStartUtc - b.dtStartUtc);
      setEvents(evs);
    })();
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, BaseEvent[]>();
    for (const e of events) {
      const k = toLocalDayKey(e.dtStartUtc);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [events]);

  return (
    <div className="grid">
      <h1>Week</h1>

      {grouped.length === 0 ? (
        <div className="card">No events found. Import an ICS file.</div>
      ) : (
        grouped.map(([dayKey, dayEvents]) => (
          <div key={dayKey} className="card">
            <h2>{formatDayLabel(dayKey)}</h2>
            <div className="grid">
              {dayEvents.map((e) => (
                <div key={e.id} className="card" style={{ background: "#0f0f0f" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <strong>{e.title}</strong>{" "}
                      {e.code ? <span className="muted">({e.code})</span> : null}
                    </div>
                    <div className="muted">{formatEventTime(e)}</div>
                  </div>
                  <div className="space" />
                  <div className="muted">
                    {e.periodCode ? <span className="badge">Period {e.periodCode}</span> : null}{" "}
                    {e.room ? <span className="badge">Room {e.room}</span> : null}{" "}
                    <span className="badge">{e.type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}