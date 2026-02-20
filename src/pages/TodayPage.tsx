import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { useAuth } from "../auth/AuthProvider";
import { getAllCycleTemplateEvents } from "../db/templateQueries";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";
import type {
  Block,
  CycleTemplateEvent,
  DayLabel,
  LessonAttachment,
  LessonPlan,
  SlotAssignment,
  SlotId,
  Subject,
} from "../db/db";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { SLOT_DEFS } from "../rolling/slots";

import { getSubjectsByUser } from "../db/subjectQueries";
import { subjectIdForTemplateEvent, detailForTemplateEvent, displayTitle } from "../db/subjectUtils";
import { getPlacementsForDayLabels } from "../db/placementQueries";
import { getAttachmentsForPlan, getLessonPlansForDate } from "../db/lessonPlanQueries";
import RichTextPlanEditor from "../components/RichTextPlanEditor";
import { termWeekForDate } from "../rolling/termWeek";

type Cell =
  | { kind: "blank" }
  | { kind: "free" }
  | { kind: "manual"; a: SlotAssignment }
  | { kind: "placed"; subjectId: string }
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id])
) as Record<string, SlotId>;


function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function adjustToWeekday(d: Date, direction: 1 | -1 = 1): Date {
  let x = new Date(d);
  while (isWeekend(x)) x = addDays(x, direction);
  return x;
}

function weekdayFromLabel(label: DayLabel): string {
  return label.slice(0, 3);
}

function minutesToLocalDateTime(today: Date, minutes: number): Date {
  const d = new Date(today);
  d.setHours(0, minutes, 0, 0);
  return d;
}

function timeRangeFromTemplate(today: Date, e: CycleTemplateEvent): string {
  const s = minutesToLocalDateTime(today, e.startMinutes);
  const t = minutesToLocalDateTime(today, e.endMinutes);
  return `${format(s, "H:mm")}–${format(t, "H:mm")}`;
}

function compactBlockLabel(label: string): string {
  const t = label.trim().toLowerCase();
  const mP = t.match(/^period\s*(\d+)/);
  if (mP) return mP[1];
  const mR = t.match(/^recess\s*(\d+)/);
  if (mR) return `R${mR[1]}`;
  const mL = t.match(/^lunch\s*(\d+)/);
  if (mL) return `L${mL[1]}`;
  if (t.includes("roll")) return "RC";
  if (t.includes("before")) return "B";
  if (t.includes("after")) return "A";
  return label;
}

export default function TodayPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [subjectById, setSubjectById] = useState<Map<string, Subject>>(new Map());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [now, setNow] = useState<Date>(new Date());

  const [label, setLabel] = useState<DayLabel | null>(null);
  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());
  const [assignmentBySlot, setAssignmentBySlot] = useState<Map<SlotId, SlotAssignment>>(new Map());
  const [placementBySlot, setPlacementBySlot] = useState<
    Map<SlotId, { subjectId?: string | null; roomOverride?: string | null }>
  >(new Map());

  const [planBySlot, setPlanBySlot] = useState<Map<SlotId, LessonPlan>>(new Map());
  const [attachmentsBySlot, setAttachmentsBySlot] = useState<Map<SlotId, LessonAttachment[]>>(new Map());
  const [openPlanSlot, setOpenPlanSlot] = useState<SlotId | null>(null);
  const [activePlanSlot, setActivePlanSlot] = useState<SlotId | null>(null);
  const openPlanHasEverHadContentRef = useRef<Map<SlotId, boolean>>(new Map());

  const [selectedDate, setSelectedDate] = useState<Date>(() => adjustToWeekday(new Date(), 1));
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);

  const [rollingSettings, setRollingSettingsState] = useState<any>(null);

  const dateKey = useMemo(() => format(selectedDate, "yyyy-MM-dd"), [selectedDate]);
  const dateLocal = useMemo(() => new Date(selectedDate), [selectedDate]);
  const isViewingToday = useMemo(() => format(new Date(), "yyyy-MM-dd") === dateKey, [dateKey]);

  function isHtmlEffectivelyEmpty(raw: string | null | undefined): boolean {
    const s = (raw ?? "").trim();
    if (!s) return true;
    const text = s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?p[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    return text.length === 0;
  }

  // coerce weekend selections to next weekday
  useEffect(() => {
    if (isWeekend(selectedDate)) setSelectedDate(adjustToWeekday(selectedDate, 1));
  }, [selectedDate]);

  // clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // load rolling settings for cycle + optional term/week display
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const s = await getRollingSettings(userId);
      setRollingSettingsState(s);
    })();
  }, [userId]);

  async function loadSubjects() {
    const subs = await getSubjectsByUser(userId);
    setSubjectById(new Map(subs.map((s) => [s.id, s])));
  }

  const subjectPalette = useMemo(() => {
  // works whether you store subjects in a Map or an array
  const values =
    subjectById instanceof Map
      ? Array.from(subjectById.values())
      : Array.isArray(subjectById)
      ? subjectById
      : [];

  const colours = values
    .map((s: any) => s?.color)
    .filter((c: any) => typeof c === "string" && c.trim().length > 0)
    .map((c: string) => c.trim().toLowerCase());

  return Array.from(new Set(colours)).sort();
}, [subjectById]);

  // load subjects and keep in sync with edits
  useEffect(() => {
    if (!userId) return;
    loadSubjects();

    const onChanged = () => loadSubjects();
    const onFocus = () => loadSubjects();
    const onVis = () => {
      if (document.visibilityState === "visible") loadSubjects();
    };

    window.addEventListener("subjects-changed", onChanged as any);
    window.addEventListener("focus", onFocus as any);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("subjects-changed", onChanged as any);
      window.removeEventListener("focus", onFocus as any);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [userId]);

  // load templateById
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const template = await getAllCycleTemplateEvents(userId);
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, [userId]);

  // load blocks once
  useEffect(() => {
    (async () => {
      await ensureDefaultBlocks(userId);
      setBlocks(await getVisibleBlocks(userId));
    })();
  }, []);

  // compute day’s DayLabel (canonical), then apply mapping to reach stored label
  useEffect(() => {
    (async () => {
      const settings = await getRollingSettings(userId);
      const canonical = dayLabelForDate(dateKey, settings) as DayLabel | null;

      if (!canonical) {
        setLabel(null);
        setAssignmentBySlot(new Map());
        return;
      }

      const meta = await getTemplateMeta(userId);
      const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;
      setLabel(stored);

      const rows = await getAssignmentsForDayLabels(userId, [stored]);
      const m = new Map<SlotId, SlotAssignment>();
      for (const a of rows) if (a.dayLabel === stored) m.set(a.slotId, a);
      setAssignmentBySlot(m);
})();
  }, [dateKey]);

  // Load placements for the day’s stored label
  useEffect(() => {
    if (!label) {
      setPlacementBySlot(new Map());
      return;
    }

    const load = async () => {
      const ps = await getPlacementsForDayLabels(userId, [label]);
      const m = new Map<SlotId, { subjectId?: string | null; roomOverride?: string | null }>();
      for (const p of ps) {
        const o: { subjectId?: string | null; roomOverride?: string | null } = {};
        if (Object.prototype.hasOwnProperty.call(p, "subjectId")) o.subjectId = p.subjectId;
        if (Object.prototype.hasOwnProperty.call(p, "roomOverride")) o.roomOverride = p.roomOverride;
        m.set(p.slotId, o);
      }
      setPlacementBySlot(m);
    };

    load();
    const onChanged = () => load();
    window.addEventListener("placements-changed", onChanged as any);
    return () => window.removeEventListener("placements-changed", onChanged as any);
  }, [label]);

  // Load lesson plans + attachments for the selected date
  useEffect(() => {
    const load = async () => {
      const plans = await getLessonPlansForDate(userId, dateKey);
      const pMap = new Map<SlotId, LessonPlan>();
      const aMap = new Map<SlotId, LessonAttachment[]>();

      for (const p of plans) pMap.set(p.slotId, p);
      for (const [slotId] of pMap) {
        const planKey = `${dateKey}::${slotId}`;
        try {
          const atts = await getAttachmentsForPlan(userId, planKey);
          aMap.set(slotId, atts);
        } catch (e) {
          console.warn("getAttachmentsForPlan failed", { planKey, e });
          aMap.set(slotId, []);
        }
      }

      setPlanBySlot(pMap);
      setAttachmentsBySlot(aMap);
    };

    load();
    const onChanged = () => load();
    window.addEventListener("lessonplans-changed", onChanged as any);
    return () => window.removeEventListener("lessonplans-changed", onChanged as any);
  }, [dateKey]);

  // If a plan is emptied/deleted, collapse the editor back to hidden state.
  useEffect(() => {
    if (!openPlanSlot) return;
    if (activePlanSlot === openPlanSlot) return;

    const plan = planBySlot.get(openPlanSlot);
    const atts = attachmentsBySlot.get(openPlanSlot) ?? [];
    const hasPlan = (!!plan && !isHtmlEffectivelyEmpty(plan.html)) || atts.length > 0;

    if (hasPlan) {
      openPlanHasEverHadContentRef.current.set(openPlanSlot, true);
      return;
    }

    const hadContentBefore = openPlanHasEverHadContentRef.current.get(openPlanSlot) ?? false;
    if (hadContentBefore) {
      openPlanHasEverHadContentRef.current.delete(openPlanSlot);
      setOpenPlanSlot(null);
    }
  }, [openPlanSlot, activePlanSlot, planBySlot, attachmentsBySlot]);

  // Build “cells” for each block: ALWAYS render a row, blank if no assignment / overridden blank
  const cells = useMemo((): Array<{ block: Block; slotId?: SlotId; cell: Cell }> => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name];
      if (!slotId) return { block: b, slotId: undefined, cell: { kind: "blank" } };

      // placement override (subjectId)
      const ov = placementBySlot.get(slotId);
      if (ov && Object.prototype.hasOwnProperty.call(ov, "subjectId")) {
        const sid = ov.subjectId;
        if (sid === null) return { block: b, slotId, cell: { kind: "blank" } };
        if (typeof sid === "string") return { block: b, slotId, cell: { kind: "placed", subjectId: sid } };
      }

      const a = assignmentBySlot.get(slotId);
      if (!a) return { block: b, slotId, cell: { kind: "blank" } };
      if (a.kind === "free") return { block: b, slotId, cell: { kind: "free" } };
      if (a.sourceTemplateEventId) {
        const e = templateById.get(a.sourceTemplateEventId);
        if (e) return { block: b, slotId, cell: { kind: "template", a, e } };
      }

      if (a.manualTitle) return { block: b, slotId, cell: { kind: "manual", a } };

      return { block: b, slotId, cell: { kind: "blank" } };
    });
  }, [blocks, assignmentBySlot, placementBySlot, templateById]);

  // current/next computed only from template events (ignore blank/free/manual/placed)
  const currentNext = useMemo(() => {
    const realEvents = cells
      .filter((x) => x.cell.kind === "template")
      .map((x) => {
        const e = (x.cell as any).e as CycleTemplateEvent;
        const start = minutesToLocalDateTime(dateLocal, e.startMinutes).getTime();
        const end = minutesToLocalDateTime(dateLocal, e.endMinutes).getTime();

        const subject = subjectById.get(subjectIdForTemplateEvent(e));
        const detail = detailForTemplateEvent(e);
        const title = subject ? displayTitle(subject, detail) : e.title;

        return { title, start, end };
      })
      .sort((a, b) => a.start - b.start);

    const nowMs = now.getTime();
    const current = realEvents.find((e) => nowMs >= e.start && nowMs < e.end) ?? null;
    const next = realEvents.find((e) => e.start > nowMs) ?? null;
    return { current, next };
  }, [cells, now, dateLocal, subjectById]);

  function onPrevDay() {
    setSelectedDate((d) => adjustToWeekday(addDays(d, -1), -1));
    setShowDatePicker(false);
  }
  function onNextDay() {
    setSelectedDate((d) => adjustToWeekday(addDays(d, 1), 1));
    setShowDatePicker(false);
  }
  function onGoToday() {
    setSelectedDate(adjustToWeekday(new Date(), 1));
    setShowDatePicker(false);
  }

  function DatePickerPopover() {
    const value = format(selectedDate, "yyyy-MM-dd");
    const labelText = `${format(selectedDate, "EEE d MMM")}`;

    return (
      <div style={{ position: "relative" }}>
        <button className="btn" type="button" onClick={() => setShowDatePicker((v) => !v)} aria-label="Choose date">
          {labelText}
        </button>

        {showDatePicker ? (
          <div
            className="card"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 8px)",
              zIndex: 50,
              width: 280,
              background: "#0b0b0b",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="muted">Jump to date</div>
              <button className="btn" type="button" onClick={() => setShowDatePicker(false)}>
                ✕
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                type="date"
                value={value}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) return;
                  setSelectedDate(adjustToWeekday(new Date(`${next}T00:00:00`), 1));
                  setShowDatePicker(false);
                }}
                style={{ width: "100%" }}
              />
            </div>

            <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  onGoToday();
                  setShowDatePicker(false);
                }}
              >
                Today
              </button>
              <button className="btn" type="button" onClick={() => setShowDatePicker(false)}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid">
      <h1>Today</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="btn" type="button" onClick={onPrevDay}>
              ← Prev
            </button>
            <DatePickerPopover />
            <button className="btn" type="button" onClick={onNextDay}>
              Next →
            </button>
          </div>

          <div className="row" style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <span className="muted">Cycle:</span>{" "}
              {label ? (
                <strong>
                  {weekdayFromLabel(label)} {label.slice(3)}
                </strong>
              ) : (
                <span className="muted">No school day</span>
              )}
            </div>

            <div>
              <span className="muted">Now:</span>{" "}
              {isViewingToday && currentNext.current ? (
                <strong>{currentNext.current.title}</strong>
              ) : (
                <span className="muted">—</span>
              )}
            </div>

            <div>
              <span className="muted">Next:</span>{" "}
              {isViewingToday && currentNext.next ? <strong>{currentNext.next.title}</strong> : <span className="muted">—</span>}
            </div>

            <div>
              {(() => {
                const tw = rollingSettings
                  ? termWeekForDate(selectedDate, rollingSettings.termStarts, rollingSettings.termEnds)
                  : null;
                return tw ? <span className="muted">Term {tw.term} · Week {tw.week}</span> : <span className="muted">&nbsp;</span>;
              })()}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: 80 }} className="muted">
                Slot
              </th>
              <th style={{ textAlign: "left" }} className="muted">
                Details
              </th>
            </tr>
          </thead>

          <tbody>
            {cells.map(({ block, slotId, cell }) => {
              const plan = slotId ? planBySlot.get(slotId) : undefined;
              const atts = slotId ? attachmentsBySlot.get(slotId) ?? [] : [];
              const hasPlan = (!!plan && !isHtmlEffectivelyEmpty(plan.html)) || atts.length > 0;

              const showPlanEditor = !!slotId && (hasPlan || openPlanSlot === slotId);
              const ov = slotId ? placementBySlot.get(slotId) : undefined;
              const roomOverride =
                ov && Object.prototype.hasOwnProperty.call(ov, "roomOverride") ? ov.roomOverride : undefined;

              const subject =
                cell.kind === "template"
                  ? subjectById.get(subjectIdForTemplateEvent(cell.e))
                  : cell.kind === "placed"
                  ? subjectById.get(cell.subjectId)
                  : undefined;

              const detail = cell.kind === "template" ? detailForTemplateEvent(cell.e) : null;

              const strip = subject?.color ?? "#2a2a2a";

              const resolvedRoom =
                cell.kind === "template"
                  ? roomOverride === undefined
                    ? cell.e.room
                    : roomOverride
                  : cell.kind === "manual"
                  ? roomOverride === undefined
                    ? cell.a.manualRoom
                    : roomOverride
                  : subject
                  ? roomOverride
                  : null;

              const codeText =
                subject?.code ??
                (cell.kind === "template" ? cell.e.code : null) ??
                (cell.kind === "manual" ? cell.a.manualCode ?? null : null);

              const titleText =
                cell.kind === "blank"
                  ? "—"
                  : cell.kind === "free"
                  ? "Free"
                  : cell.kind === "manual"
                  ? cell.a.manualTitle
                  : cell.kind === "placed"
                  ? subject?.title ?? "—"
                  : subject
                  ? displayTitle(subject, detail)
                  : cell.e.title;

              const timeText = cell.kind === "template" ? timeRangeFromTemplate(dateLocal, cell.e) : null;

              return (
                <tr key={block.id}>
                  <td style={{ verticalAlign: "top" }}>
                    <div className="badge">{compactBlockLabel(block.name)}</div>
                  </td>

                  <td style={{ verticalAlign: "top" }}>
                    <div
                      className="slotCard slotClickable"
                      style={{ ...({ ["--slotStrip" as any]: strip } as any) }}
                      role={slotId ? "button" : undefined}
                      tabIndex={slotId ? 0 : undefined}
                      onClick={() => {
                        if (!slotId) return;
                        if (hasPlan) openPlanHasEverHadContentRef.current.set(slotId, true);
                        setOpenPlanSlot((cur) => (cur === slotId ? null : slotId));
                      }}
                      onKeyDown={(e) => {
                        const t = e.target as HTMLElement | null;
                        if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
                        if (!slotId) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (hasPlan) openPlanHasEverHadContentRef.current.set(slotId, true);
                          setOpenPlanSlot((cur) => (cur === slotId ? null : slotId));
                        }
                      }}
                    >
                      <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
  <div className="row" style={{ gap: 10, alignItems: "center", minWidth: 0 }}>
    {/* circular slot badge */}
    <span
      title={block.name}
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        background: strip,
        color: "#0b0b0b",
        flex: "0 0 auto",
      }}
    >
      {compactBlockLabel(block.name)}
    </span>

    {/* coloured subject title */}
    <div style={{ minWidth: 0 }}>
      <strong style={{ color: strip }}>{titleText}</strong>{" "}
      {codeText ? <span className="muted">({codeText})</span> : null}
    </div>
  </div>

  <div className="muted" style={{ whiteSpace: "nowrap" }}>
    {timeText ?? ""}
  </div>
</div>

                      <div className="muted" style={{ marginTop: 4 }}>
                        {resolvedRoom ? <span className="badge">Room {resolvedRoom}</span> : null}{" "}
                        {cell.kind === "template" ? <span className="badge">{cell.a.kind}</span> : null}
                        {cell.kind === "manual" ? <span className="badge">{cell.a.kind}</span> : null}
                      </div>

                      {slotId && showPlanEditor ? (
  <div
    style={{ marginTop: 10 }}
    onFocusCapture={() => setActivePlanSlot(slotId)}
    onBlurCapture={() => setActivePlanSlot((cur) => (cur === slotId ? null : cur))}
  >
    <RichTextPlanEditor
      userId={userId}
      dateKey={dateKey}
      slotId={slotId}
      initialHtml={plan?.html ?? ""}
      attachments={atts}
      palette={subjectPalette}
    />
  </div>
) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isViewingToday ? null : (
        <div className="card">
          <button className="btn" type="button" onClick={onGoToday}>
            Back to today
          </button>
        </div>
      )}
    </div>
  );
}