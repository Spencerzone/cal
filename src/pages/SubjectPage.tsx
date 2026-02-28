// src/pages/SubjectPage.tsx
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { getRollingSettings, setRollingSettings } from "../rolling/settings";
import { getLessonsForSubject } from "../db/queries";
import { formatEventTime, toLocalDayKey, formatDayLabel } from "../util/time";
import type { BaseEvent } from "../ics/parseIcs";

import {
  getLessonPlansForDate,
  getAttachmentsForPlan,
} from "../db/lessonPlanQueries";
import type { LessonAttachment, LessonPlan, SlotId } from "../db/db";
import RichTextPlanEditor from "../components/RichTextPlanEditor";

function slotIdForBaseEvent(e: any): SlotId | null {
  const pcRaw = String(e?.periodCode ?? e?.period ?? e?.code ?? "").trim();
  const pc = pcRaw.toUpperCase();

  const map: Record<string, SlotId> = {
    BEFORE: "before",
    BEFORESCHOOL: "before",
    "BEFORE SCHOOL": "before",
    RC: "rc",
    ROLL: "rc",
    "ROLL CALL": "rc",
    P1: "p1",
    P2: "p2",
    P3: "p3",
    P4: "p4",
    P5: "p5",
    P6: "p6",
    R1: "r1",
    R2: "r2",
    L1: "l1",
    L2: "l2",
    AFTER: "after",
    AFTERSCHOOL: "after",
    "AFTER SCHOOL": "after",
  };

  if (pc in map) return map[pc];
  const lower = pcRaw.toLowerCase();
  if (
    [
      "before",
      "rc",
      "p1",
      "p2",
      "r1",
      "r2",
      "p3",
      "p4",
      "l1",
      "l2",
      "p5",
      "p6",
      "after",
    ].includes(lower)
  )
    return lower as SlotId;

  return null;
}

export default function SubjectPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const params = useParams();
  const code = (params.code || "").toUpperCase();

  const [rollingSettings, setRollingSettingsState] = useState<any>(null);
  const activeYear = useMemo(
    () => (rollingSettings?.activeYear ?? new Date().getFullYear()) as number,
    [rollingSettings],
  );

  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    ys.add(new Date().getFullYear());

    const tys: any[] = rollingSettings?.termYears ?? [];
    for (const ty of tys) {
      if (typeof ty?.year === "number") ys.add(ty.year);
    }

    const legacyAnyStart =
      rollingSettings?.termStarts?.t1 ||
      rollingSettings?.termStarts?.t2 ||
      rollingSettings?.termStarts?.t3 ||
      rollingSettings?.termStarts?.t4;

    if (typeof legacyAnyStart === "string" && legacyAnyStart.length >= 4) {
      const y = parseInt(legacyAnyStart.slice(0, 4), 10);
      if (Number.isFinite(y)) ys.add(y);
    }

    return Array.from(ys).sort((a, b) => b - a);
  }, [rollingSettings]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;

    const load = async () => {
      const s = await getRollingSettings(userId);
      if (!alive) return;
      setRollingSettingsState(s);
    };

    load();
    const onChange = () => load();
    window.addEventListener("rolling-settings-changed", onChange as any);

    return () => {
      alive = false;
      window.removeEventListener("rolling-settings-changed", onChange as any);
    };
  }, [userId]);

  const [events, setEvents] = useState<BaseEvent[]>([]);
  const [plansByDayKey, setPlansByDayKey] = useState<
    Map<string, Map<string, LessonPlan>>
  >(new Map());
  const [attsByPlanKey, setAttsByPlanKey] = useState<
    Map<string, LessonAttachment[]>
  >(new Map());
  const [loadingPlans, setLoadingPlans] = useState<boolean>(false);

  useEffect(() => {
    if (!userId || !code) return;
    (async () => {
      const subjectId = code.startsWith("code::") ? code : `code::${code}`;
      const rows = await getLessonsForSubject(userId, activeYear, subjectId);
      setEvents(rows.filter((e) => (e as any).active !== false));
    })();
  }, [userId, code, activeYear]);

  const grouped = useMemo(() => {
    const m = new Map<string, BaseEvent[]>();
    for (const e of events) {
      const dayKey = toLocalDayKey(e.dtStartUtc);
      if (!m.has(dayKey)) m.set(dayKey, []);
      m.get(dayKey)!.push(e);
    }
    for (const [, arr] of m) arr.sort((a, b) => a.dtStartUtc - b.dtStartUtc);
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [events]);

  // Load plans/attachments for the days shown on this page
  useEffect(() => {
    if (!userId) return;

    if (grouped.length === 0) {
      setPlansByDayKey(new Map());
      setAttsByPlanKey(new Map());
      return;
    }

    let alive = true;

    (async () => {
      setLoadingPlans(true);
      try {
        const nextPlans = new Map<string, Map<string, LessonPlan>>();
        const nextAtts = new Map<string, LessonAttachment[]>();

        for (const [dayKey] of grouped) {
          const plans = await getLessonPlansForDate(userId, activeYear, dayKey);
          const map = new Map<string, LessonPlan>();

          for (const p of plans) {
            map.set(p.slotId, p);
            const atts = await getAttachmentsForPlan(userId, activeYear, p.key);
            nextAtts.set(p.key, atts ?? []);
          }

          nextPlans.set(dayKey, map);
        }

        if (!alive) return;
        setPlansByDayKey(nextPlans);
        setAttsByPlanKey(nextAtts);
      } finally {
        if (alive) setLoadingPlans(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userId, activeYear, grouped]);

  return (
    <div className="grid">
      <h1>Lessons for {code || "(unknown)"}</h1>

      <div className="card">
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong>Active year</strong>
          </div>
          <select
            value={activeYear}
            onChange={async (e: React.ChangeEvent<HTMLSelectElement>) => {
              const y = parseInt(e.target.value, 10);
              if (!userId || !Number.isFinite(y)) return;

              await setRollingSettings(userId, { activeYear: y } as any);

              setRollingSettingsState((prev: any) => ({
                ...(prev ?? {}),
                activeYear: y,
              }));
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadingPlans ? (
        <div className="card">
          <div className="muted">Loading lesson plans…</div>
        </div>
      ) : null}

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

            <div className="grid" style={{ gap: 10 }}>
              {rows.map((e) => {
                const slotId = slotIdForBaseEvent(e as any);
                const dayPlans = plansByDayKey.get(dayKey);
                const plan =
                  slotId && dayPlans ? dayPlans.get(slotId) : undefined;
                const atts = plan ? (attsByPlanKey.get(plan.key) ?? []) : [];

                return (
                  <div key={e.id} className="card" style={{ padding: 12 }}>
                    <div>
                      <strong>{e.title}</strong>{" "}
                      {e.room ? (
                        <span className="muted">({e.room})</span>
                      ) : null}
                    </div>
                    <div className="muted">{formatEventTime(e)}</div>

                    {slotId ? (
                      <>
                        <div className="space" />
                        <RichTextPlanEditor
                          userId={userId}
                          year={activeYear}
                          dateKey={dayKey}
                          slotId={slotId}
                          initialHtml={plan?.html ?? ""}
                          attachments={atts}
                        />
                      </>
                    ) : (
                      <div className="muted" style={{ marginTop: 8 }}>
                        No slot mapping for this event (periodCode missing).
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
