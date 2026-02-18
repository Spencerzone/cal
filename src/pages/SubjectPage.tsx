// src/pages/SubjectPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { getLessonsForSubject } from "../db/queries";
import { formatEventTime, toLocalDayKey, formatDayLabel } from "../util/time";
import type { BaseEvent } from "../ics/parseIcs";

export default function SubjectPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";

  const params = useParams();
  const code = (params.code || "").toUpperCase();

  const [events, setEvents] = useState<BaseEvent[]>([]);

  useEffect(() => {
    if (!userId || !code) return;
    (async () => {
      const rows = await getLessonsForSubject(userId, code);
      setEvents(rows.filter((e) => (e as any).active !== false));
    })();
  }, [userId, code]);

  const grouped = useMemo(() => {
    const m = new Map<string, BaseEvent[]>();
    for (const e of events) {
      const dayKey = toLocalDayKey(new Date(e.dtStartUtc));
      if (!m.has(dayKey)) m.set(dayKey, []);
      m.get(dayKey)!.push(e);
    }
    for (const [k, arr] of m) arr.sort((a, b) => a.dtStartUtc - b.dtStartUtc);
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [events]);

  return (
    <div className="grid">
      <h1>Lessons for {code || "(unknown)"}</h1>

      {grouped.length === 0 ? (
        <div className="card">
          <div className="muted">No lessons found.</div>
        </div>
      ) : (
        grouped.map(([dayKey, rows]) => (
          <div key={dayKey} className="card">
            <div>
              <strong>{formatDayLabel(dayKey)}</strong>
            </div>
            <div className="space" />
            <div className="grid" style={{ gap: 8 }}>
              {rows.map((e) => (
                <div key={e.id}>
                  <div>
                    <strong>{e.title}</strong> {e.room ? <span className="muted">({e.room})</span> : null}
                  </div>
                  <div className="muted">{formatEventTime(e.dtStartUtc, e.dtEndUtc)}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
