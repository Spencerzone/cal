// src/pages/SubjectPage.tsx 2
import { useEffect, useMemo, useState } from "react";
import { getDb } from "../db/db";
import { getLessonsForSubject, weekRangeUtc } from "../db/queries";
import { formatEventTime, toLocalDayKey, formatDayLabel } from "../util/time";
import type { BaseEvent } from "../ics/parseIcs";

async function listSubjectCodes(): Promise<string[]> {
  const db = await getDb();
  const tx = db.transaction("baseEvents");
  const idx = tx.store.index("byCode");
  const codes = new Set<string>();
  let cursor = await idx.openCursor();
  while (cursor) {
    const c = cursor.value.code;
    if (cursor.value.active && cursor.value.type === "class" && c) codes.add(c);
    cursor = await cursor.continue();
  }
  return [...codes].sort();
}

export default function SubjectPage() {
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState<string>("");
  const [events, setEvents] = useState<BaseEvent[]>([]);

  useEffect(() => {
    (async () => {
      const cs = await listSubjectCodes();
      setCodes(cs);
      if (cs.length && !code) setCode(cs[0]!);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!code) return;
    (async () => {
      // default: next 4 weeks from start of this week
      const { startUtc } = weekRangeUtc(new Date());
      const endUtc = startUtc + 28 * 24 * 60 * 60 * 1000;
      const evs = await getLessonsForSubject(code, startUtc, endUtc);
      setEvents(evs);
    })();
  }, [code]);

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
      <h1>Lessons for subject</h1>

      <div className="card">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <label className="muted" style={{ minWidth: 160 }}>
            Subject code
          </label>
          <select
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ maxWidth: 360 }}
          >
            {codes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="space" />
        <div className="muted">Shows the next 4 weeks of lessons for the selected code.</div>
      </div>

      {code && grouped.length === 0 ? (
        <div className="card">No lessons found for {code}. Import an ICS file or choose another subject.</div>
      ) : (
        grouped.map(([dayKey, dayEvents]) => (
          <div key={dayKey} className="card">
            <h2>{formatDayLabel(dayKey)}</h2>
            <div className="grid">
              {dayEvents.map((e) => (
                <div key={e.id} className="card" style={{ background: "#0f0f0f" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div>
                      <strong>{e.title}</strong> <span className="muted">({e.code})</span>
                    </div>
                    <div className="muted">{formatEventTime(e)}</div>
                  </div>
                  <div className="space" />
                  <div className="muted">
                    {e.periodCode ? <span className="badge">Period {e.periodCode}</span> : null}{" "}
                    {e.room ? <span className="badge">Room {e.room}</span> : null}
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