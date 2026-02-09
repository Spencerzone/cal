// src/pages/TodayPage.tsx 1
import { useEffect, useMemo, useState } from "react";
import { getEventsForRange, todayRangeUtc } from "../db/queries";
import { formatEventTime, isNowWithin } from "../util/time";
import type { BaseEvent } from "../ics/parseIcs";

export default function TodayPage() {
  const [events, setEvents] = useState<BaseEvent[]>([]);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const { startUtc, endUtc } = todayRangeUtc(new Date());
      const evs = await getEventsForRange(startUtc, endUtc);
      evs.sort((a, b) => a.dtStartUtc - b.dtStartUtc);
      setEvents(evs);
    })();
  }, []);

  const current = useMemo(() => events.find((e) => isNowWithin(now, e.dtStartUtc, e.dtEndUtc)) ?? null, [events, now]);
  const next = useMemo(() => events.find((e) => e.dtStartUtc > now.getTime()) ?? null, [events, now]);

  return (
    <div className="grid">
      <h1>Today</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <div className="badge">Now</div>{" "}
            {current ? (
              <>
                <strong>{current.title}</strong> <span className="muted">({formatEventTime(current)})</span>
              </>
            ) : (
              <span className="muted">No current period</span>
            )}
          </div>
          <div>
            <div className="badge">Next</div>{" "}
            {next ? (
              <>
                <strong>{next.title}</strong> <span className="muted">({formatEventTime(next)})</span>
              </>
            ) : (
              <span className="muted">No upcoming events</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid">
        {events.length === 0 ? (
          <div className="card">
            <div>No events found. Import an ICS file.</div>
          </div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{e.title}</strong>{" "}
                  {e.code ? <span className="muted">({e.code})</span> : null}
                </div>
                <div className="muted">{formatEventTime(e)}</div>
              </div>
              <div className="space" />
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <div className="muted">
                  {e.periodCode ? <span className="badge">Period {e.periodCode}</span> : null}{" "}
                  {e.room ? <span className="badge">Room {e.room}</span> : null}{" "}
                  <span className="badge">{e.type}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}