import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { getDb } from "../db/db";
import { getRollingSettings } from "../rolling/settings";
import { generateForDate } from "../rolling/generate";

function formatTimeRange(startUtc: number, endUtc: number): string {
  const s = new Date(startUtc);
  const e = new Date(endUtc);
  // local display
  return `${format(s, "H:mm")}–${format(e, "H:mm")}`;
}

export default function TodayPage() {
  const [events, setEvents] = useState<Array<any>>([]);
  const [now, setNow] = useState<Date>(new Date());
  const todayKey = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const templateCount = await db.count("cycleTemplateEvents");

      if (templateCount > 0) {
        const settings = await getRollingSettings();
        const gen = await generateForDate(todayKey, settings);
        setEvents(gen);
        return;
      }

      setEvents([]);
    })();
  }, [todayKey]);

  const current = useMemo(() => events.find((e) => now.getTime() >= e.startUtc && now.getTime() < e.endUtc) ?? null, [events, now]);
  const next = useMemo(() => events.find((e) => e.startUtc > now.getTime()) ?? null, [events, now]);

  return (
    <div className="grid">
      <h1>Today</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <div className="badge">Now</div>{" "}
            {current ? (
              <>
                <strong>{current.title}</strong> <span className="muted">({formatTimeRange(current.startUtc, current.endUtc)})</span>
              </>
            ) : (
              <span className="muted">No current period</span>
            )}
          </div>
          <div>
            <div className="badge">Next</div>{" "}
            {next ? (
              <>
                <strong>{next.title}</strong> <span className="muted">({formatTimeRange(next.startUtc, next.endUtc)})</span>
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
            <div>No rolling events found for today.</div>
            <div className="muted">If this is a weekend/holiday, that is expected. Otherwise check cycleStartDate in settings.</div>
          </div>
        ) : (
          events.map((e: any) => (
            <div key={e.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{e.title}</strong>{" "}
                  {e.code ? <span className="muted">({e.code})</span> : null}
                </div>
                <div className="muted">{formatTimeRange(e.startUtc, e.endUtc)}</div>
              </div>
              <div className="space" />
              <div className="muted">
                {e.periodCode ? <span className="badge">Period {e.periodCode}</span> : null}{" "}
                {e.room ? <span className="badge">Room {e.room}</span> : null}{" "}
                <span className="badge">{e.type}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}