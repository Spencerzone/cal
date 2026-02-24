// src/pages/SubjectPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { BaseEventRow, LessonPlan, SlotId, Subject } from "../db/db";
import { getAllSubjectsByUser } from "../db/subjectQueries";
import { getEventsForRange } from "../db/queries";
import { getLessonPlansForDate } from "../db/lessonPlanQueries";
import type { RollingSettings } from "../rolling/settings";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { termWeekForDate } from "../rolling/termWeek";
import { format, addDays, parseISO, isValid } from "date-fns";
import { toLocalDayKey } from "../util/time";

type TermKey = "t1" | "t2" | "t3" | "t4";

type RangeMode = "term" | "custom";

function normalisePeriodCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

function slotForEvent(periodCode: string | null | undefined, title: string): SlotId | null {
  const p = normalisePeriodCode(periodCode);

  if (p === "BEFORE SCHOOL" || p === "BEFORE") return "before";
  if (p === "AFTER SCHOOL" || p === "AFTER") return "after";

  if (p === "RC" || p === "ROLL CALL" || p === "ROLLCALL") return "rc";
  if (p === "1") return "p1";
  if (p === "2") return "p2";
  if (p === "3") return "p3";
  if (p === "4") return "p4";
  if (p === "5") return "p5";
  if (p === "6") return "p6";

  if (p === "R1" || p === "RECESS 1" || p === "RECESS") return "r1";
  if (p === "R2" || p === "RECESS 2") return "r2";
  if (p === "L1" || p === "LUNCH 1" || p === "LUNCH") return "l1";
  if (p === "L2" || p === "LUNCH 2") return "l2";

  const t = (title ?? "").toUpperCase();
  if (t.includes("BEFORE SCHOOL")) return "before";
  if (t.includes("AFTER SCHOOL")) return "after";

  return null;
}

function slotLabel(slotId: SlotId | null, periodCode: string | null): string {
  if (!slotId) return periodCode ? `Period ${periodCode}` : "Lesson";
  const m: Record<SlotId, string> = {
    before: "Before school",
    rc: "Roll call",
    p1: "Period 1",
    p2: "Period 2",
    r1: "Recess 1",
    r2: "Recess 2",
    p3: "Period 3",
    p4: "Period 4",
    l1: "Lunch 1",
    l2: "Lunch 2",
    p5: "Period 5",
    p6: "Period 6",
    after: "After school",
  };
  return m[slotId];
}

function isHtmlEffectivelyEmpty(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (!s) return true;
  const stripped = s
    .replace(/<br\s*\/?>/gi, "")
    .replace(/<\/p>\s*<p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return stripped.length === 0;
}

function ymd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function inclusiveDateKeys(startKey: string, endKey: string): string[] {
  const s = parseISO(startKey);
  const e = parseISO(endKey);
  if (!isValid(s) || !isValid(e)) return [];
  const out: string[] = [];
  for (let d = s; d.getTime() <= e.getTime(); d = addDays(d, 1)) out.push(ymd(d));
  return out;
}

export default function SubjectPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");

  const [rollingSettings, setRollingSettingsState] = useState<RollingSettings | null>(null);

  const [rangeMode, setRangeMode] = useState<RangeMode>("term");
  const [term, setTerm] = useState<TermKey>("t1");
  const [startKey, setStartKey] = useState<string>("2026-02-01");
  const [endKey, setEndKey] = useState<string>("2026-02-28");

  const [showEmpty, setShowEmpty] = useState<boolean>(true);

  const [rows, setRows] = useState<
    Array<{
      event: BaseEventRow;
      dateKey: string;
      slotId: SlotId | null;
      planHtml: string | null;
    }>
  >([]);

  // Load rolling settings (term dates + week set overrides)
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const rs = await getRollingSettings(userId);
      setRollingSettingsState(rs);
    })();

    const onChanged = async () => {
      const rs = await getRollingSettings(userId);
      setRollingSettingsState(rs);
    };
    window.addEventListener("rolling-settings-changed", onChanged as any);
    return () => window.removeEventListener("rolling-settings-changed", onChanged as any);
  }, [userId]);

  // Load subjects (dropdown)
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const all = await getAllSubjectsByUser(userId);
      const subs = all.filter((s) => s.kind === "subject" && !s.archived);
      subs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      setSubjects(subs);
      if (!subjectId && subs.length) setSubjectId(subs[0].id);
    })();
  }, [userId]);

  // Apply term start/end to date range when term changes
  useEffect(() => {
    if (!rollingSettings) return;
    const s = rollingSettings.termStarts?.[term];
    const e = rollingSettings.termEnds?.[term];
    if (s) setStartKey(s);
    if (e) setEndKey(e);
  }, [rollingSettings, term]);

  const selectedSubject = useMemo(() => subjects.find((s) => s.id === subjectId) ?? null, [subjects, subjectId]);

  const effectiveRange = useMemo(() => {
    return { startKey, endKey };
  }, [rangeMode, startKey, endKey]);

  // Load lessons for subject+range
  useEffect(() => {
    if (!userId) return;
    if (!selectedSubject?.code) {
      setRows([]);
      return;
    }

    (async () => {
      // baseEvents query uses UTC ms; for lesson listing, this is sufficient.
      const startD = parseISO(effectiveRange.startKey);
      const endD = parseISO(effectiveRange.endKey);
      if (!isValid(startD) || !isValid(endD)) {
        setRows([]);
        return;
      }

      const startUtc = startD.getTime();
      const endUtc = addDays(endD, 1).getTime() - 1;

      const events = await getEventsForRange(userId, startUtc, endUtc);
      const code = selectedSubject.code.toUpperCase();

      const matching = events.filter((e) => (e.code ?? "").toUpperCase() === code && (e as any).active !== false);

      // Prefetch lesson plans for all dates in range
      const dayKeys = inclusiveDateKeys(effectiveRange.startKey, effectiveRange.endKey);
      const plansByDate = new Map<string, Map<string, LessonPlan>>();
      await Promise.all(
        dayKeys.map(async (dk) => {
          const ps = await getLessonPlansForDate(userId, dk);
          plansByDate.set(dk, new Map(ps.map((p) => [p.slotId, p])));
        })
      );

      const out = matching
        .map((e) => {
          const dateKey = toLocalDayKey(e.dtStartUtc);
          const slotId = slotForEvent(e.periodCode, e.title);
          const plan = slotId ? plansByDate.get(dateKey)?.get(slotId) : undefined;
          const planHtml = plan?.html ?? null;
          return { event: e, dateKey, slotId, planHtml };
        })
        .filter((r) => (showEmpty ? true : !isHtmlEffectivelyEmpty(r.planHtml)));

      out.sort((a, b) => a.event.dtStartUtc - b.event.dtStartUtc);
      setRows(out);
    })();
  }, [userId, selectedSubject?.id, selectedSubject?.code, effectiveRange.startKey, effectiveRange.endKey, showEmpty]);

  function headerForRow(r: { event: BaseEventRow; dateKey: string; slotId: SlotId | null }) {
    const d = parseISO(r.dateKey);
    const dow = isValid(d) ? format(d, "EEE") : "";
    const dateLabel = isValid(d) ? format(d, "dd/MM/yyyy") : r.dateKey;

    const label = rollingSettings ? dayLabelForDate(r.dateKey, rollingSettings) : null;
    const suffix = label ? label.slice(-1) : "";

    const tw = rollingSettings ? termWeekForDate(d, rollingSettings.termStarts, rollingSettings.termEnds) : null;
    const termPart = tw ? `Term ${tw.term}` : "";
    const weekPart = tw ? `Week ${tw.week}${suffix}` : "";

    const pc = slotLabel(r.slotId, r.event.periodCode);

    const parts = [dow, termPart, weekPart, pc].filter(Boolean).join(" ");
    return `${parts} - ${dateLabel}`;
  }

  function exportPdf() {
    const subj = selectedSubject?.title ?? "Lessons";
    const title = `${subj} (${effectiveRange.startKey} to ${effectiveRange.endKey})`;

    const docHtml = `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${title}</title>
<style>
  body{font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin:24px; color:#111;}
  h1{font-size:20px; margin:0 0 12px;}
  .meta{color:#444; margin:0 0 18px;}
  .lesson{border-left:4px solid #f59e0b; padding:10px 12px; margin:0 0 14px; page-break-inside: avoid;}
  .hdr{font-weight:700; margin:0 0 8px;}
  .sub{color:#444; margin:0 0 10px; font-size:12px;}
  .empty{color:#666; font-style:italic;}
  a{color:#0b5fff;}
</style>
</head>
<body>
  <h1>${subj}</h1>
  <div class="meta">${effectiveRange.startKey} → ${effectiveRange.endKey}${showEmpty ? "" : " (non-empty only)"}</div>
  ${rows
    .map((r) => {
      const room = r.event.room ? `Room ${r.event.room}` : "";
      const time = (() => {
        try {
          const s = new Date(r.event.dtStartUtc);
          const e = new Date(r.event.dtEndUtc);
          return `${format(s, "H:mm")}–${format(e, "H:mm")}`;
        } catch {
          return "";
        }
      })();
      const sub = [time, room].filter(Boolean).join(" · ");
      const body = !isHtmlEffectivelyEmpty(r.planHtml) ? r.planHtml! : `<div class="empty">(empty)</div>`;
      return `<div class="lesson"><div class="hdr">${headerForRow(r)}</div>${sub ? `<div class="sub">${sub}</div>` : ""}${body}</div>`;
    })
    .join("\n")}
<script>window.print()</script>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(docHtml);
    w.document.close();
  }

  return (
    <div className="grid">
      <h1>Lessons</h1>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 260 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Subject
            </div>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ width: "100%" }}>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.code ? ` (${s.code})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 220 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Time period
            </div>
            <div className="row" style={{ gap: 8 }}>
              <select value={rangeMode} onChange={(e) => setRangeMode(e.target.value as RangeMode)}>
                <option value="term">Term</option>
                <option value="custom">Custom</option>
              </select>

              {rangeMode === "term" ? (
                <select value={term} onChange={(e) => setTerm(e.target.value as TermKey)}>
                  <option value="t1">Term 1</option>
                  <option value="t2">Term 2</option>
                  <option value="t3">Term 3</option>
                  <option value="t4">Term 4</option>
                </select>
              ) : null}
            </div>
          </div>

          <div style={{ minWidth: 240 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Range
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input type="date" value={startKey} onChange={(e) => setStartKey(e.target.value)} />
              <span className="muted">to</span>
              <input type="date" value={endKey} onChange={(e) => setEndKey(e.target.value)} />
            </div>
          </div>

          <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
            Show empty lessons
          </label>

          <button className="btn" onClick={exportPdf} disabled={!rows.length}>
            Export PDF
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <div className="muted">No lessons found for the selected subject and period.</div>
        </div>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {rows.map((r) => {
            const header = headerForRow(r);
            const time = (() => {
              try {
                const s = new Date(r.event.dtStartUtc);
                const e = new Date(r.event.dtEndUtc);
                return `${format(s, "H:mm")}–${format(e, "H:mm")}`;
              } catch {
                return "";
              }
            })();
            const room = r.event.room ? `Room ${r.event.room}` : "";
            const sub = [time, room].filter(Boolean).join(" · ");

            return (
              <div key={r.event.id} className="card" style={{ borderLeft: "4px solid #f59e0b" }}>
                <div>
                  <strong>{header}</strong>
                  {sub ? (
                    <div className="muted" style={{ marginTop: 4 }}>
                      {sub}
                    </div>
                  ) : null}
                </div>

                <div className="space" />
                {!isHtmlEffectivelyEmpty(r.planHtml) ? (
                  <div dangerouslySetInnerHTML={{ __html: r.planHtml! }} />
                ) : (
                  <div className="muted" style={{ fontStyle: "italic" }}>
                    (empty)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
