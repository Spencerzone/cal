// src/pages/SubjectPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { LessonPlan, Placement, SlotAssignment, SlotId, Subject } from "../db/db";
import { getAllSubjectsByUser } from "../db/subjectQueries";
import { getLessonPlansForDate } from "../db/lessonPlanQueries";
import type { RollingSettings } from "../rolling/settings";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { termWeekForDate } from "../rolling/termWeek";
import { format, addDays, parseISO, isValid } from "date-fns";
import { getAllCycleTemplateEvents } from "../db/templateQueries";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";
import { getPlacementsForDayLabels } from "../db/placementQueries";
import type { CycleTemplateEvent, DayLabel } from "../db/db";
import { subjectIdForTemplateEvent } from "../db/subjectUtils";

type TermKey = "t1" | "t2" | "t3" | "t4";

type RangeMode = "term" | "custom";

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

function slotLabel(slotId: SlotId): string {
  return SLOT_DEFS.find((s) => s.id === slotId)?.label ?? slotId;
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

  const activeYear = (rollingSettings?.activeYear ?? new Date().getFullYear()) as number;

  const [rangeMode, setRangeMode] = useState<RangeMode>("term");
  const [term, setTerm] = useState<TermKey>("t1");
  const [startKey, setStartKey] = useState<string>("2026-02-01");
  const [endKey, setEndKey] = useState<string>("2026-02-28");

  const [showEmpty, setShowEmpty] = useState<boolean>(true);

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [rows, setRows] = useState<
    Array<{
      dateKey: string;
      slotId: SlotId;
      room: string;
      planHtml: string | null;
      subjectColor: string;
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
      const all = await getAllSubjectsByUser(userId, activeYear);
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
    if (!selectedSubject) {
      setRows([]);
      return;
    }
    if (!rollingSettings) {
      setRows([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setIsLoading(true);

      const startD = parseISO(effectiveRange.startKey);
      const endD = parseISO(effectiveRange.endKey);
      if (!isValid(startD) || !isValid(endD)) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      const dayKeys = inclusiveDateKeys(effectiveRange.startKey, effectiveRange.endKey);
      const dayLabels = Array.from(
        new Set(dayKeys.map((dk) => dayLabelForDate(dk, rollingSettings)).filter(Boolean))
      ) as DayLabel[];

      const [templateEvents, assignments, placements] = await Promise.all([
        getAllCycleTemplateEvents(userId, activeYear),
        getAssignmentsForDayLabels(userId, activeYear, dayLabels),
        getPlacementsForDayLabels(userId, activeYear, dayLabels),
      ]);

      if (cancelled) return;

      const templateById = new Map<string, CycleTemplateEvent>(templateEvents.map((e) => [e.id, e]));
      const assignmentByKey = new Map<string, SlotAssignment>(assignments.map((a) => [a.key, a]));
      const placementByKey = new Map<string, Placement>();
      for (const p of placements) placementByKey.set(`${p.dayLabel}::${p.slotId}`, p);

      const plansByDate = new Map<string, Map<SlotId, LessonPlan>>();
      await Promise.all(
        dayKeys.map(async (dk) => {
          const ps = await getLessonPlansForDate(userId, activeYear, dk);
          plansByDate.set(dk, new Map(ps.map((p) => [p.slotId, p])));
        })
      );

      const subjectById = new Map(subjects.map((s) => [s.id, s]));
      const selectedId = selectedSubject.id;

      function resolveFor(dayLabel: DayLabel, slotId: SlotId): { subjectId: string | null; room: string } {
        const pk = `${dayLabel}::${slotId}`;
        const p = placementByKey.get(pk);

        // Placement override (authoritative)
        if (p && Object.prototype.hasOwnProperty.call(p, "subjectId")) {
          const sid = p.subjectId === null ? null : (p.subjectId ?? null);
          const room =
            p && Object.prototype.hasOwnProperty.call(p, "roomOverride")
              ? p.roomOverride === null
                ? ""
                : p.roomOverride ?? ""
              : "";
          return { subjectId: sid, room };
        }

        const a = assignmentByKey.get(pk);
        if (!a) return { subjectId: null, room: "" };
        if (a.kind === "free") return { subjectId: null, room: "" };

        if (a.manualTitle) {
          const code = (a.manualCode ?? "").trim();
          const sid = code ? `code::${code.toUpperCase()}` : null;
          const room = (a.manualRoom ?? "").trim();
          return { subjectId: sid, room };
        }

        if (a.sourceTemplateEventId) {
          const te = templateById.get(a.sourceTemplateEventId);
          if (!te) return { subjectId: null, room: "" };
          const sid = subjectIdForTemplateEvent(te);

          // room override might still exist even without subject override
          const roomOverride =
            p && Object.prototype.hasOwnProperty.call(p, "roomOverride")
              ? p.roomOverride === null
                ? ""
                : p.roomOverride ?? ""
              : undefined;
          const room = roomOverride !== undefined ? roomOverride : (te.room ?? "");
          return { subjectId: sid, room };
        }

        return { subjectId: null, room: "" };
      }

      const out: Array<{ dateKey: string; slotId: SlotId; room: string; planHtml: string | null; subjectColor: string; dtSort: number }> = [];

      for (const dk of dayKeys) {
        const dl = dayLabelForDate(dk, rollingSettings) as DayLabel;
        for (const s of SLOT_DEFS) {
          const resolved = resolveFor(dl, s.id);
          if (!resolved.subjectId) continue;
          if (resolved.subjectId !== selectedId) continue;

          const plan = plansByDate.get(dk)?.get(s.id);
          const planHtml = plan?.html ?? null;
          if (!showEmpty && isHtmlEffectivelyEmpty(planHtml)) continue;

          const subj = subjectById.get(resolved.subjectId);
          const color = subj?.color ?? "#f59e0b";

          const dtSort = parseISO(dk).getTime();
          out.push({ dateKey: dk, slotId: s.id, room: resolved.room, planHtml, subjectColor: color, dtSort });
        }
      }

      out.sort(
        (a, b) =>
          a.dtSort - b.dtSort ||
          SLOT_DEFS.findIndex((s) => s.id === a.slotId) - SLOT_DEFS.findIndex((s) => s.id === b.slotId)
      );
      setRows(out.map(({ dtSort, ...r }) => r));
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, selectedSubject?.id, effectiveRange.startKey, effectiveRange.endKey, showEmpty, rollingSettings, subjects]);

  function headerForRow(r: { dateKey: string; slotId: SlotId }) {
    const d = parseISO(r.dateKey);
    const dow = isValid(d) ? format(d, "EEE") : "";
    const dateLabel = isValid(d) ? format(d, "dd/MM/yyyy") : r.dateKey;

    const label = rollingSettings ? dayLabelForDate(r.dateKey, rollingSettings) : null;
    const suffix = label ? label.slice(-1) : "";

    const tw = rollingSettings ? termWeekForDate(d, rollingSettings.termStarts, rollingSettings.termEnds) : null;
    const termPart = tw ? `Term ${tw.term}` : "";
    const weekPart = tw ? `Week ${tw.week}${suffix}` : "";

    const pc = slotLabel(r.slotId);

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
      const room = r.room ? `Room ${r.room}` : "";
      const sub = room;
      const body = !isHtmlEffectivelyEmpty(r.planHtml) ? r.planHtml! : `<div class="empty">(empty)</div>`;
      return `<div class="lesson" style="border-left-color:${r.subjectColor}"><div class="hdr">${headerForRow(r)}</div>${sub ? `<div class="sub">${sub}</div>` : ""}${body}</div>`;
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

      {isLoading ? (
        <div className="card">
          <div className="muted">Loading…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="muted">No lessons found for the selected subject and period.</div>
        </div>
      ) : (
        <div className="grid" style={{ gap: 10 }}>
          {rows.map((r) => {
            const header = headerForRow(r);
            const room = r.room ? `Room ${r.room}` : "";
            const sub = room;

            return (
              <div key={`${r.dateKey}::${r.slotId}`} className="card" style={{ borderLeft: `4px solid ${r.subjectColor}` }}>
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
