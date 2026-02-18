import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { getDb } from "../db/db";
import type { Block, CycleTemplateEvent, DayLabel, LessonAttachment, LessonPlan, SlotAssignment, SlotId, Subject } from "../db/db";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { SLOT_DEFS } from "../rolling/slots";

import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
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
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id])
) as Record<string, SlotId>;

const userId = "local";

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function adjustToWeekday(d: Date, direction: 1 | -1 = 1): Date {
  let x = new Date(d);
  while (isWeekend(x)) {
    x = addDays(x, direction);
  }
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

  // coerce weekend selections to Monday (next weekday)
  useEffect(() => {
    if (isWeekend(selectedDate)) {
      setSelectedDate(adjustToWeekday(selectedDate, 1));
    }
  }, [selectedDate]);

  // clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // load rolling settings for cycle + optional term weeks
  useEffect(() => {
    (async () => {
      const s = await getRollingSettings();
      setRollingSettingsState(s);
    })();
  }, []);

  async function loadSubjects() {
    await ensureSubjectsFromTemplates(userId);
    const subs = await getSubjectsByUser(userId);
    setSubjectById(new Map(subs.map((s) => [s.id, s])));
  }

  // load subjects and keep in sync with edits
  useEffect(() => {
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
  }, []);

  // load templateById once
  useEffect(() => {
    (async () => {
      const db = await getDb();
      const template = await db.getAll("cycleTemplateEvents");
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, []);

  // load blocks once
  useEffect(() => {
    (async () => {
      await ensureDefaultBlocks(userId);
      setBlocks(await getVisibleBlocks(userId));
    })();
  }, []);

  // compute day's DayLabel (canonical), then apply mapping to reach stored label
  useEffect(() => {
    (async () => {
      const settings = await getRollingSettings();
      const canonical = dayLabelForDate(dateKey, settings) as DayLabel | null;

      if (!canonical) {
        setLabel(null);
        setAssignmentBySlot(new Map());
        return;
      }

      const meta = await getTemplateMeta();
      const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;
      setLabel(stored);

      const db = await getDb();
      const idx = db.transaction("slotAssignments").store.index("byDayLabel");
      const rows = await idx.getAll(stored);

      const m = new Map<SlotId, SlotAssignment>();
      for (const a of rows) m.set(a.slotId, a);
      setAssignmentBySlot(m);
    })();
  }, [dateKey]);

  // If a plan is emptied/deleted, collapse the editor back to hidden state.
  useEffect(() => {
    if (!openPlanSlot) return;
    // If the editor is currently focused/active, do not auto-collapse while the user is typing.
    // Collapse can occur on blur/close if the plan is empty and it previously had content.
    if (activePlanSlot === openPlanSlot) return;
    const plan = planBySlot.get(openPlanSlot);
    const atts = attachmentsBySlot.get(openPlanSlot) ?? [];
    const hasPlan = (!!plan && !isHtmlEffectivelyEmpty(plan.html)) || atts.length > 0;
    // Mark as having had content once it becomes non-empty.
    if (hasPlan) {
      openPlanHasEverHadContentRef.current.set(openPlanSlot, true);
      return;
    }

    // Do NOT auto-collapse a freshly-opened, never-before-saved editor.
    // Only collapse when the slot previously had content and is now empty.
    const hadContentBefore = openPlanHasEverHadContentRef.current.get(openPlanSlot) ?? false;
    if (hadContentBefore) {
      // Once the user clears a plan and it's deleted, treat future opens as "new" again.
      // Otherwise the editor will immediately auto-collapse on subsequent opens.
      openPlanHasEverHadContentRef.current.delete(openPlanSlot);
      setOpenPlanSlot(null);
    }
  }, [openPlanSlot, activePlanSlot, planBySlot, attachmentsBySlot]);

  // Load placements for today's stored label
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

  const cells: Array<{ blockId: string; blockLabel: string; slotId: SlotId | null; cell: Cell }> = useMemo(() => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name];
      const a = slotId ? assignmentBySlot.get(slotId) : undefined;

      if (!a) return { blockId: b.id, blockLabel: b.name, slotId: slotId ?? null, cell: { kind: "blank" } };
      if (a.kind === "free") return { blockId: b.id, blockLabel: b.name, slotId: slotId ?? null, cell: { kind: "free" } };
      if (a.manualTitle) return { blockId: b.id, blockLabel: b.name, slotId: slotId ?? null, cell: { kind: "manual", a } };

      if (a.sourceTemplateEventId) {
        const e = templateById.get(a.sourceTemplateEventId);
          if (e) return { blockId: b.id, blockLabel: b.name, slotId: slotId ?? null, cell: { kind: "template", a, e } };
      }

      return { blockId: b.id, blockLabel: b.name, slotId: slotId ?? null, cell: { kind: "blank" } };
    });
  }, [blocks, assignmentBySlot, templateById]);

  // current/next computed only from template events (ignore blank/free/manual)
  const currentNext = useMemo(() => {
    if (!isViewingToday) return { current: null, next: null };
    const realEvents = cells
      .filter((x) => x.cell.kind === "template")
      .map((x) => {
        const e = (x.cell as any).e as CycleTemplateEvent;
        const start = minutesToLocalDateTime(dateLocal, e.startMinutes).getTime();
        const end = minutesToLocalDateTime(dateLocal, e.endMinutes).getTime();
        const slotId = x.slotId;

        // Slot-level placement override
        const ov = x.slotId ? placementBySlot.get(x.slotId) : undefined;
        const overrideSubjectId = ov && Object.prototype.hasOwnProperty.call(ov, "subjectId") ? ov.subjectId : undefined;
        if (overrideSubjectId === null) return null;

        if (typeof overrideSubjectId === "string") {
          const s = subjectById.get(overrideSubjectId);
          const title = s ? s.title : e.title;
          return { title, start, end, color: s?.color ?? null };
        }

        const subject = subjectById.get(subjectIdForTemplateEvent(e));
        const detail = detailForTemplateEvent(e);
        const title = subject ? displayTitle(subject, detail) : e.title;
        return { title, start, end, color: subject?.color ?? null };
      })
      .filter((x): x is { title: string; start: number; end: number; color: string | null } => !!x)
      .sort((a, b) => a.start - b.start);

    const nowMs = now.getTime();
    const current = realEvents.find((e) => nowMs >= e.start && nowMs < e.end) ?? null;
    const next = realEvents.find((e) => e.start > nowMs) ?? null;
    return { current, next };
  }, [cells, now, dateLocal, subjectById, placementBySlot, isViewingToday]);

  // Load lesson plans + attachments for this date
  useEffect(() => {
    const load = async () => {
      const plans = await getLessonPlansForDate(userId, dateKey);
      const pMap = new Map<SlotId, LessonPlan>();
      const aMap = new Map<SlotId, LessonAttachment[]>();

      for (const p of plans) {
        pMap.set(p.slotId, p);
      }

      // Load attachments per plan (only for plans that exist)
      for (const [slotId, plan] of pMap) {
        const atts = await getAttachmentsForPlan(plan.key);
        aMap.set(slotId, atts);
      }

      setPlanBySlot(pMap);
      setAttachmentsBySlot(aMap);
    };

    load();
    const onChanged = () => load();
    window.addEventListener("lessonplans-changed", onChanged as any);
    return () => window.removeEventListener("lessonplans-changed", onChanged as any);
  }, [dateKey]);

  function onPrevDay() {
    setSelectedDate((d) => adjustToWeekday(addDays(d, -1), -1));
  }
  function onNextDay() {
    setSelectedDate((d) => adjustToWeekday(addDays(d, 1), 1));
  }

  function onGoToday() {
    setSelectedDate(adjustToWeekday(new Date(), 1));
  }

  function DatePickerPopover() {
    const value = format(selectedDate, "yyyy-MM-dd");
    return (
      <div style={{ position: "relative" }}>
        <button
          className="btn"
          type="button"
          onClick={() => setShowDatePicker((v) => !v)}
          aria-label="Choose date"
        >
          {formatDisplayDate(selectedDate)}
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
                  // Use local date without timezone surprises
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
function formatDisplayDate(d: Date) {
    return format(d, "EEE d MMM yyyy");
  }

  return (
    <div className="grid">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <h1>Today</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" type="button" onClick={onPrevDay}>
            ← Prev
          </button>
          <DatePickerPopover />
          <button className="btn" type="button" onClick={onNextDay}>
            Next →
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <span className="muted">Cycle day</span>{" "}
            {label ? (
              <strong>
                {weekdayFromLabel(label)} {label.slice(3)}
              </strong>
            ) : (
              <span className="muted">No school day</span>
            )}
            {(() => {
              const tw = rollingSettings ? termWeekForDate(dateLocal, rollingSettings.termStarts, rollingSettings.termEnds) : null;
              return tw ? (
                <div style={{ marginTop: 6 }}>
                  <span className="muted">Term {tw.term} · Week {tw.week}</span>
                </div>
              ) : null;
            })()}
          </div>

          <div>
            <span className="muted" style={{ color: currentNext.current?.color ?? undefined }}>Now</span>{" "}
            {currentNext.current ? (
              <strong style={{ color: currentNext.current.color ?? undefined }}>{currentNext.current.title}</strong>
            ) : (
              <span className="muted">—</span>
            )}
          </div>

          <div>
            <span className="muted" style={{ color: currentNext.next?.color ?? undefined }}>Next</span>{" "}
            {currentNext.next ? (
              <strong style={{ color: currentNext.next.color ?? undefined }}>{currentNext.next.title}</strong>
            ) : (
              <span className="muted">—</span>
            )}
          </div>
        </div>
      </div>

      <div className="slotsGridFull">
        {cells.map(({ blockId, blockLabel, slotId, cell }) => {
          const override = slotId ? placementBySlot.get(slotId) : undefined;
          const overrideSubjectId =
            override && Object.prototype.hasOwnProperty.call(override, "subjectId")
              ? override.subjectId
              : undefined;
          const overrideSubject = typeof overrideSubjectId === "string" ? subjectById.get(overrideSubjectId) : undefined;

          const roomOverride =
            override && Object.prototype.hasOwnProperty.call(override, "roomOverride")
              ? override.roomOverride
              : undefined;

          const subject = cell.kind === "template" ? subjectById.get(subjectIdForTemplateEvent(cell.e)) : undefined;
          const detail = cell.kind === "template" ? detailForTemplateEvent(cell.e) : null;
          const strip =
            overrideSubjectId === null
              ? "#2a2a2a"
              : overrideSubject?.color ?? subject?.color ?? "#2a2a2a";

          const resolvedRoom =
            cell.kind === "template"
              ? roomOverride === undefined
                ? cell.e.room
                : roomOverride
              : cell.kind === "manual"
              ? roomOverride === undefined
                ? cell.a.manualRoom
                : roomOverride
              : overrideSubject
              ? roomOverride
              : null;

          const codeText =
            overrideSubject?.code ??
            (cell.kind === "template" ? cell.e.code : null) ??
            (cell.kind === "manual" ? cell.a.manualCode ?? null : null);

          const timeText = cell.kind === "template" ? timeRangeFromTemplate(dateLocal, cell.e) : null;

          const plan = slotId ? planBySlot.get(slotId) : undefined;
          const atts = slotId ? attachmentsBySlot.get(slotId) ?? [] : [];
          const hasPlan = (!!plan && !isHtmlEffectivelyEmpty(plan.html)) || atts.length > 0;
          const showPlanEditor = !!slotId && (hasPlan || openPlanSlot === slotId);

          return (
            <div
              key={blockId}
              className="slotCard slotClickable"
              style={{ ...( { ["--slotStrip" as any]: strip } as any) }}
              role={slotId ? "button" : undefined}
              tabIndex={slotId ? 0 : undefined}
              onClick={() => {
                if (!slotId) return;
                const planNow = planBySlot.get(slotId);
                const attsNow = attachmentsBySlot.get(slotId) ?? [];
                const hasNow = (!!planNow && !isHtmlEffectivelyEmpty(planNow.html)) || attsNow.length > 0;
                if (hasNow) openPlanHasEverHadContentRef.current.set(slotId, true);
                setOpenPlanSlot((cur) => (cur === slotId ? null : slotId));
              }}
              onKeyDown={(e) => {
                const t = e.target as HTMLElement | null;
                if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;

                if (!slotId) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  const planNow = planBySlot.get(slotId);
                  const attsNow = attachmentsBySlot.get(slotId) ?? [];
                  const hasNow = (!!planNow && !isHtmlEffectivelyEmpty(planNow.html)) || attsNow.length > 0;
                  if (hasNow) openPlanHasEverHadContentRef.current.set(slotId, true);
                  setOpenPlanSlot((cur) => (cur === slotId ? null : slotId));
                }
              }}
            >
              <div className="slotTitleRow">
                <span className="slotPeriodDot" style={{ borderColor: strip, color: strip }}>
                  {compactBlockLabel(blockLabel)}
                </span>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0, width: "100%" }}>
                  <div style={{ minWidth: 0 }}>
                    {overrideSubjectId === null ? (
                      <div className="muted">—</div>
                    ) : overrideSubject ? (
                      <div className="slotTitle" style={{ color: strip, fontWeight: 700 }}>
                        {overrideSubject.title}
                      </div>
                    ) : cell.kind === "blank" ? (
                      <div className="muted">—</div>
                    ) : cell.kind === "free" ? (
                      <div className="muted">Free</div>
                    ) : cell.kind === "manual" ? (
                      <div className="slotTitle" style={{ color: strip, fontWeight: 700 }}>
                        {cell.a.manualTitle}
                      </div>
                    ) : cell.kind === "template" ? (
                      <div className="slotTitle" style={{ color: strip, fontWeight: 700 }}>
                        {subject ? displayTitle(subject, detail) : cell.e.title}
                      </div>
                    ) : null}
                  </div>

                  <div className="row slotCompactBadges" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {codeText ? <span className="badge">{codeText}</span> : null}
                    {resolvedRoom ? <span className="badge">Room {resolvedRoom}</span> : null}
                    {timeText ? <span className="badge">{timeText}</span> : null}
                  </div>
                </div>
              </div>

              {/* Meta line: code + room + time (no badges) */}

              {showPlanEditor ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onFocusCapture={() => setActivePlanSlot(slotId)}
                  onBlurCapture={(e) => {
                    const rt = (e.relatedTarget as Node | null) ?? null;
                    if (!rt || !e.currentTarget.contains(rt)) setActivePlanSlot(null);
                  }}
                >
                  <RichTextPlanEditor
                    userId={userId}
                    dateKey={dateKey}
                    slotId={slotId}
                    initialHtml={plan?.html ?? ""}
                    attachments={atts}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
