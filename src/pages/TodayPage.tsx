import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addDays,
  addMonths,
  subMonths,
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  getDay,
} from "date-fns";
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

import {
  getSubjectsByUser,
  getAllSubjectsByUser,
  safeDocId,
} from "../db/subjectQueries";
import {
  subjectIdForTemplateEvent,
  detailForTemplateEvent,
  displayTitle,
} from "../db/subjectUtils";
import { getPlacementsForDayLabels } from "../db/placementQueries";
import {
  getAttachmentsForPlan,
  getLessonPlansForDate,
} from "../db/lessonPlanQueries";
import RichTextPlanEditor from "../components/RichTextPlanEditor";
import { termInfoForDate } from "../rolling/termWeek";
import { getDayNote, setDayNote } from "../db/dayNoteQueries";

type Cell =
  | { kind: "blank" }
  | { kind: "free" }
  | { kind: "manual"; a: SlotAssignment }
  | { kind: "placed"; subjectId: string }
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id]),
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
  const navigate = useNavigate();
  const [subjectById, setSubjectById] = useState<Map<string, Subject>>(
    new Map(),
  );
  const [allSubjectColours, setAllSubjectColours] = useState<string[]>([]);

  // allSubjectColours is populated from ALL subjects (any year) so new users
  // see their subject colours in the editor palette immediately
  const subjectPalette = allSubjectColours;
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [now, setNow] = useState<Date>(new Date());

  const [label, setLabel] = useState<DayLabel | null>(null);
  const [templateById, setTemplateById] = useState<
    Map<string, CycleTemplateEvent>
  >(new Map());
  const [assignmentBySlot, setAssignmentBySlot] = useState<
    Map<SlotId, SlotAssignment>
  >(new Map());
  const [placementBySlot, setPlacementBySlot] = useState<
    Map<SlotId, { subjectId?: string | null; roomOverride?: string | null }>
  >(new Map());

  const [planBySlot, setPlanBySlot] = useState<Map<SlotId, LessonPlan>>(
    new Map(),
  );
  const [attachmentsBySlot, setAttachmentsBySlot] = useState<
    Map<SlotId, LessonAttachment[]>
  >(new Map());
  const [openPlanSlot, setOpenPlanSlot] = useState<SlotId | null>(null);
  const [activePlanSlot, setActivePlanSlot] = useState<SlotId | null>(null);
  const openPlanHasEverHadContentRef = useRef<Map<SlotId, boolean>>(new Map());

  const [dayNoteHtml, setDayNoteHtml] = useState<string>("");

  const [selectedDate, setSelectedDate] = useState<Date>(() =>
    adjustToWeekday(new Date(), 1),
  );
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() =>
    startOfMonth(new Date()),
  );

  const [rollingSettings, setRollingSettingsState] = useState<any>(null);
  const activeYear = useMemo(
    () => (rollingSettings?.activeYear ?? selectedDate.getFullYear()) as number,
    [rollingSettings, selectedDate],
  );

  const dateKey = useMemo(
    () => format(selectedDate, "yyyy-MM-dd"),
    [selectedDate],
  );
  const dateLocal = useMemo(() => new Date(selectedDate), [selectedDate]);
  const isViewingToday = useMemo(
    () => format(new Date(), "yyyy-MM-dd") === dateKey,
    [dateKey],
  );

  // Load day note whenever the selected date changes
  useEffect(() => {
    if (!userId) return;
    getDayNote(userId, dateKey).then(setDayNoteHtml);
  }, [userId, dateKey]);

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
    if (isWeekend(selectedDate))
      setSelectedDate(adjustToWeekday(selectedDate, 1));
  }, [selectedDate]);

  // clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // load rolling settings for cycle + optional term/week display
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
  }, [userId, activeYear]);

  async function loadSubjects() {
    // Year-scoped for timetable display
    const subs = await getSubjectsByUser(userId, activeYear);
    const m = new Map<string, Subject>();
    for (const s of subs) {
      m.set(s.id, s);
      m.set(safeDocId(s.id), s);
    }
    setSubjectById(m);
    // All subjects (any year) for the colour palette — new users may have
    // subjects that haven't been assigned to the active year yet
    const allSubs = await getAllSubjectsByUser(userId);
    setAllSubjectColours(
      Array.from(
        new Set(
          allSubs
            .map((s) => s?.color)
            .filter(
              (c): c is string => typeof c === "string" && c.trim().length > 0,
            )
            .map((c) => c.trim().toLowerCase()),
        ),
      ).sort(),
    );
  }

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
  }, [userId, activeYear]);

  // load templateById
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const template = await getAllCycleTemplateEvents(userId, activeYear);
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, [userId, activeYear]);

  // load blocks once
  useEffect(() => {
    (async () => {
      await ensureDefaultBlocks(userId);
      setBlocks(await getVisibleBlocks(userId));
    })();
  }, []);

  // compute day's DayLabel (canonical), then apply mapping to reach stored label
  useEffect(() => {
    if (!rollingSettings) return; // wait for settings to load before computing label
    (async () => {
      const canonical = dayLabelForDate(
        dateKey,
        rollingSettings,
      ) as DayLabel | null;

      if (!canonical) {
        setLabel(null);
        setAssignmentBySlot(new Map());
        return;
      }

      const meta = await getTemplateMeta(userId, activeYear);
      const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;
      setLabel(stored);

      const rows = await getAssignmentsForDayLabels(userId, activeYear, [
        stored,
      ]);
      const m = new Map<SlotId, SlotAssignment>();
      for (const a of rows) m.set(a.slotId, a);
      setAssignmentBySlot(m);
    })();
  }, [dateKey, userId, activeYear, rollingSettings]);

  // Load placements for the day’s stored label
  useEffect(() => {
    if (!label) {
      setPlacementBySlot(new Map());
      return;
    }

    const load = async () => {
      const ps = await getPlacementsForDayLabels(userId, activeYear, [label]);
      const m = new Map<
        SlotId,
        { subjectId?: string | null; roomOverride?: string | null }
      >();
      for (const p of ps) {
        const o: { subjectId?: string | null; roomOverride?: string | null } =
          {};
        if (Object.prototype.hasOwnProperty.call(p, "subjectId"))
          o.subjectId = p.subjectId;
        if (Object.prototype.hasOwnProperty.call(p, "roomOverride"))
          o.roomOverride = p.roomOverride;
        m.set(p.slotId, o);
      }
      setPlacementBySlot(m);
    };

    load();
    const onChanged = () => load();
    window.addEventListener("placements-changed", onChanged as any);
    return () =>
      window.removeEventListener("placements-changed", onChanged as any);
  }, [label]);

  // Load lesson plans + attachments for the selected date
  useEffect(() => {
    const load = async () => {
      const plans = await getLessonPlansForDate(userId, activeYear, dateKey);
      const pMap = new Map<SlotId, LessonPlan>();
      const aMap = new Map<SlotId, LessonAttachment[]>();

      for (const p of plans) pMap.set(p.slotId, p);
      for (const [slotId, plan] of pMap) {
        const atts = await getAttachmentsForPlan(userId, activeYear, plan.key);
        aMap.set(slotId, atts);
      }

      setPlanBySlot(pMap);
      setAttachmentsBySlot(aMap);
    };

    load();
    const onChanged = () => load();
    window.addEventListener("lessonplans-changed", onChanged as any);
    return () =>
      window.removeEventListener("lessonplans-changed", onChanged as any);
  }, [dateKey]);

  // If a plan is emptied/deleted, collapse the editor back to hidden state.
  useEffect(() => {
    if (!openPlanSlot) return;
    if (activePlanSlot === openPlanSlot) return;

    const plan = planBySlot.get(openPlanSlot);
    const atts = attachmentsBySlot.get(openPlanSlot) ?? [];
    const hasPlan =
      (!!plan && !isHtmlEffectivelyEmpty(plan.html)) || atts.length > 0;

    if (hasPlan) {
      openPlanHasEverHadContentRef.current.set(openPlanSlot, true);
      return;
    }

    const hadContentBefore =
      openPlanHasEverHadContentRef.current.get(openPlanSlot) ?? false;
    if (hadContentBefore) {
      openPlanHasEverHadContentRef.current.delete(openPlanSlot);
      setOpenPlanSlot(null);
    }
  }, [openPlanSlot, activePlanSlot, planBySlot, attachmentsBySlot]);

  // Build “cells” for each block: ALWAYS render a row, blank if no assignment / overridden blank
  const cells = useMemo((): Array<{
    block: Block;
    slotId?: SlotId;
    cell: Cell;
  }> => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name];
      if (!slotId)
        return { block: b, slotId: undefined, cell: { kind: "blank" } };

      // placement override (subjectId)
      const ov = placementBySlot.get(slotId);
      if (ov && Object.prototype.hasOwnProperty.call(ov, "subjectId")) {
        const sid = ov.subjectId;
        if (sid === null) return { block: b, slotId, cell: { kind: "blank" } };
        if (typeof sid === "string")
          return { block: b, slotId, cell: { kind: "placed", subjectId: sid } };
      }

      const a = assignmentBySlot.get(slotId);
      if (!a) return { block: b, slotId, cell: { kind: "blank" } };
      if (a.kind === "free")
        return { block: b, slotId, cell: { kind: "free" } };

      // Template linkage takes priority over manualTitle — buildSlotAssignments
      // always copies e.title into manualTitle, so checking manualTitle first
      // would prevent template cells from ever being resolved.
      if (a.sourceTemplateEventId) {
        const e = templateById.get(a.sourceTemplateEventId);
        if (e) return { block: b, slotId, cell: { kind: "template", a, e } };
      }

      // Only treat as manual if there is no template linkage
      if (a.manualTitle)
        return { block: b, slotId, cell: { kind: "manual", a } };

      return { block: b, slotId, cell: { kind: "blank" } };
    });
  }, [blocks, assignmentBySlot, placementBySlot, templateById]);

  // current/next computed only from template events (ignore blank/free/manual/placed)
  const currentNext = useMemo(() => {
    const realEvents = cells
      .filter((x) => x.cell.kind === "template")
      .map((x) => {
        const e = (x.cell as any).e as CycleTemplateEvent;
        const start = minutesToLocalDateTime(
          dateLocal,
          e.startMinutes,
        ).getTime();
        const end = minutesToLocalDateTime(dateLocal, e.endMinutes).getTime();

        const sid = subjectIdForTemplateEvent(e);
        const subject = subjectById.get(sid) ?? subjectById.get(safeDocId(sid));
        const detail = detailForTemplateEvent(e);
        const title = subject ? displayTitle(subject, detail) : e.title;
        const color = subject?.color ?? "#9ca3af";

        return { title, start, end, color };
      })
      .sort((a, b) => a.start - b.start);

    const nowMs = now.getTime();
    const current =
      realEvents.find((e) => nowMs >= e.start && nowMs < e.end) ?? null;
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
    const labelText = format(selectedDate, "EEE d MMM");
    const today = new Date();
    const accentColor = "#6366f1";

    const monthStart = startOfMonth(calendarMonth);
    const startPad = (getDay(monthStart) + 6) % 7;
    const cells: (Date | null)[] = Array(startPad).fill(null);
    for (const d of eachDayOfInterval({
      start: monthStart,
      end: endOfMonth(calendarMonth),
    }))
      cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const btnRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (!showDatePicker || !btnRef.current || !popRef.current) return;
      const btn = btnRef.current.getBoundingClientRect();
      const pop = popRef.current;
      const PAD = 10;
      const popW = pop.offsetWidth || 268;
      const popH = pop.offsetHeight || 320;

      // Prefer right-aligned to button, shift left if it clips
      let left = btn.right - popW;
      if (left < PAD) left = PAD;
      if (left + popW > window.innerWidth - PAD)
        left = window.innerWidth - PAD - popW;

      // Prefer below, flip above if it clips
      let top = btn.bottom + 8;
      if (top + popH > window.innerHeight - PAD) top = btn.top - popH - 8;
      if (top < PAD) top = PAD;

      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    }, [showDatePicker, calendarMonth]);

    return (
      <div style={{ position: "relative" }}>
        {showDatePicker && (
          <div
            onClick={() => setShowDatePicker(false)}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
        )}
        <button
          className="btn"
          type="button"
          ref={btnRef}
          aria-label="Choose date"
          onClick={() => {
            setCalendarMonth(startOfMonth(selectedDate));
            setShowDatePicker((v) => !v);
          }}
        >
          {labelText}
        </button>

        {showDatePicker ? (
          <div
            className="card"
            style={{
              position: "fixed",
              zIndex: 50,
              width: 268,
              background: "var(--popover-bg)",
              padding: 12,
            }}
          >
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <button
                className="btn"
                type="button"
                style={{ padding: "2px 8px" }}
                onClick={() => setCalendarMonth((m: Date) => subMonths(m, 1))}
              >
                ‹
              </button>
              <strong style={{ fontSize: 13 }}>
                {format(calendarMonth, "MMMM yyyy")}
              </strong>
              <button
                className="btn"
                type="button"
                style={{ padding: "2px 8px" }}
                onClick={() => setCalendarMonth((m: Date) => addMonths(m, 1))}
              >
                ›
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 2,
                marginBottom: 4,
              }}
            >
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                <div
                  key={d}
                  style={{
                    textAlign: "center",
                    fontSize: 10,
                    opacity: 0.45,
                    fontWeight: 600,
                  }}
                >
                  {d}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 2,
              }}
            >
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const isToday = isSameDay(d, today);
                const isSelected = isSameDay(d, selectedDate);
                const inMonth = isSameMonth(d, calendarMonth);
                const isWeekend = [0, 6].includes(getDay(d));
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedDate(d);
                      setShowDatePicker(false);
                    }}
                    style={{
                      border: "none",
                      borderRadius: "50%",
                      width: 32,
                      height: 32,
                      margin: "0 auto",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: isToday ? 700 : 400,
                      background: isSelected
                        ? accentColor
                        : isToday
                          ? `${accentColor}33`
                          : "transparent",
                      color: isSelected
                        ? "#fff"
                        : !inMonth
                          ? "rgba(128,128,128,0.4)"
                          : isWeekend
                            ? "var(--muted)"
                            : "var(--text)",
                      outline:
                        isToday && !isSelected
                          ? `2px solid ${accentColor}`
                          : "none",
                    }}
                  >
                    {format(d, "d")}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <button
                className="btn"
                type="button"
                style={{ fontSize: 12 }}
                onClick={() => {
                  onGoToday();
                  setCalendarMonth(startOfMonth(today));
                  setShowDatePicker(false);
                }}
              >
                Today
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}
        >
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            {/* Week-view quick switch — timetable grid icon */}
            <button
              className="btn"
              type="button"
              onClick={() => navigate("/week")}
              title="Week view"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="0"   y="0" width="2" height="4" rx="0.5" opacity="0.55"/>
                <rect x="3.5" y="0" width="2" height="4" rx="0.5" opacity="0.55"/>
                <rect x="7"   y="0" width="2" height="4" rx="0.5" opacity="0.55"/>
                <rect x="10.5" y="0" width="2" height="4" rx="0.5" opacity="0.55"/>
                <rect x="14"  y="0" width="2" height="4" rx="0.5" opacity="0.55"/>
                <rect x="0"   y="5" width="2" height="4" rx="0.5"/>
                <rect x="3.5" y="5" width="2" height="4" rx="0.5"/>
                <rect x="7"   y="5" width="2" height="4" rx="0.5"/>
                <rect x="10.5" y="5" width="2" height="4" rx="0.5"/>
                <rect x="14"  y="5" width="2" height="4" rx="0.5"/>
                <rect x="0"   y="10" width="2" height="4" rx="0.5"/>
                <rect x="3.5" y="10" width="2" height="4" rx="0.5"/>
                <rect x="7"   y="10" width="2" height="4" rx="0.5"/>
                <rect x="10.5" y="10" width="2" height="4" rx="0.5"/>
                <rect x="14"  y="10" width="2" height="4" rx="0.5"/>
              </svg>
              <span>Week</span>
            </button>
            <button className="btn" type="button" onClick={onPrevDay}>
              ← Prev
            </button>
            <DatePickerPopover />
            <button className="btn" type="button" onClick={onNextDay}>
              Next →
            </button>
          </div>

          <div
            className="row"
            style={{ gap: 14, alignItems: "center", flexWrap: "wrap" }}
          >
            <div>
              <span className="muted">Cycle:</span>{" "}
              {label ? (
                <strong>
                  {weekdayFromLabel(label)},{" "}
                  Week{" "}
                  {rollingSettings
                    ? (termInfoForDate(selectedDate, rollingSettings)?.week ?? "")
                    : ""}
                  {label.slice(3)}
                </strong>
              ) : (
                <span className="muted">No school day</span>
              )}
            </div>

            <div>
              <span className="muted">Now:</span>{" "}
              {isViewingToday && currentNext.current ? (
                <>
                  <strong style={{ color: currentNext.current.color }}>
                    {currentNext.current.title}
                  </strong>
                  <span className="muted">
                    {" "}
                    ({format(new Date(currentNext.current.end), "H:mm")})
                  </span>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </div>

            <div>
              <span className="muted">Next:</span>{" "}
              {isViewingToday && currentNext.next ? (
                <>
                  <strong style={{ color: currentNext.next.color }}>
                    {currentNext.next.title}
                  </strong>
                  <span className="muted">
                    {" "}
                    ({format(new Date(currentNext.next.start), "H:mm")})
                  </span>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </div>

            
          </div>
        </div>
      </div>

      {/* Day note */}
      <RichTextPlanEditor
        userId={userId}
        dateKey={dateKey}
        initialHtml={dayNoteHtml}
        attachments={[]}
        palette={subjectPalette}
        placeholder="Add a note for today…"
        label="Day Note"
        compact
        filledCardStyle={{
          borderColor: "#f59e0b",
          background: "rgba(245,158,11,0.08)",
        }}
        onSave={(html) => {
          setDayNoteHtml(html);
          setDayNote(userId, dateKey, html);
        }}
      />

      <div className="card" style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 4,
          }}
        >
          <tbody>
            {cells.map(({ block, slotId, cell }) => {
              const plan = slotId ? planBySlot.get(slotId) : undefined;
              const atts = slotId ? (attachmentsBySlot.get(slotId) ?? []) : [];
              const hasPlan =
                (!!plan && !isHtmlEffectivelyEmpty(plan.html)) ||
                atts.length > 0;

              const showPlanEditor =
                !!slotId && (hasPlan || openPlanSlot === slotId);
              const ov = slotId ? placementBySlot.get(slotId) : undefined;
              const overrideSubjectId =
                ov && Object.prototype.hasOwnProperty.call(ov, "subjectId")
                  ? ov.subjectId
                  : undefined;
              const overrideSubject =
                typeof overrideSubjectId === "string"
                  ? (subjectById.get(overrideSubjectId) ??
                    subjectById.get(safeDocId(overrideSubjectId)))
                  : undefined;
              const roomOverride =
                ov && Object.prototype.hasOwnProperty.call(ov, "roomOverride")
                  ? ov.roomOverride
                  : undefined;

              const subject =
                cell.kind === "template"
                  ? (subjectById.get(subjectIdForTemplateEvent(cell.e)) ??
                    subjectById.get(
                      safeDocId(subjectIdForTemplateEvent(cell.e)),
                    ))
                  : cell.kind === "placed"
                    ? (subjectById.get(cell.subjectId) ??
                      subjectById.get(safeDocId(cell.subjectId)))
                    : undefined;

              const detail =
                cell.kind === "template"
                  ? detailForTemplateEvent(cell.e)
                  : null;

              const strip =
                overrideSubjectId === null
                  ? "#9ca3af"
                  : (overrideSubject?.color ?? subject?.color ?? "#9ca3af");

              const isClass =
                cell.kind === "template"
                  ? cell.e.type === "class"
                  : cell.kind === "manual"
                    ? cell.a.kind === "class"
                    : cell.kind === "placed"
                      ? subject?.kind === "subject"
                      : false;

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
                (cell.kind === "manual" ? (cell.a.manualCode ?? null) : null);

              const titleText =
                cell.kind === "blank"
                  ? "—"
                  : cell.kind === "free"
                    ? "Free"
                    : cell.kind === "manual"
                      ? cell.a.manualTitle
                      : cell.kind === "placed"
                        ? (subject?.title ?? "—")
                        : subject
                          ? displayTitle(subject, detail)
                          : cell.e.title;

              const timeText =
                cell.kind === "template"
                  ? timeRangeFromTemplate(dateLocal, cell.e)
                  : null;

              return (
                <tr key={block.id}>
                  <td style={{ verticalAlign: "top" }}>
                    <div
                      className="slotCard slotClickable"
                      style={{ ...({ ["--slotStrip" as any]: isClass ? strip : "transparent" } as any) }}
                      role={slotId ? "button" : undefined}
                      tabIndex={slotId ? 0 : undefined}
                      onClick={() => {
                        if (!slotId) return;
                        if (hasPlan)
                          openPlanHasEverHadContentRef.current.set(
                            slotId,
                            true,
                          );
                        setOpenPlanSlot((cur) =>
                          cur === slotId ? null : slotId,
                        );
                      }}
                      onKeyDown={(e) => {
                        const t = e.target as HTMLElement | null;
                        if (
                          t &&
                          (t.isContentEditable ||
                            t.tagName === "INPUT" ||
                            t.tagName === "TEXTAREA")
                        )
                          return;
                        if (!slotId) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (hasPlan)
                            openPlanHasEverHadContentRef.current.set(
                              slotId,
                              true,
                            );
                          setOpenPlanSlot((cur) =>
                            cur === slotId ? null : slotId,
                          );
                        }
                      }}
                    >
                      <div
                        className="row"
                        style={{
                          justifyContent: "space-between",
                          gap: 10,
                          alignItems: "baseline",
                        }}
                      >
                        <div
                          className="row"
                          style={{ gap: 10, alignItems: "center", minWidth: 0 }}
                        >
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

                          {/* coloured subject title + code + room */}
                          <div style={{ minWidth: 0 }}>
                            <strong style={{ color: strip }}>
                              {titleText}
                            </strong>{" "}
                            {codeText ? (
                              <span className="muted">({codeText})</span>
                            ) : null}
                            {resolvedRoom ? (
                              <span className="muted"> · {resolvedRoom}</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="muted" style={{ whiteSpace: "nowrap" }}>
                          {timeText ?? ""}
                        </div>
                      </div>

                      {slotId && showPlanEditor ? (
                        <div
                          style={{ marginTop: 10 }}
                          onFocusCapture={() => setActivePlanSlot(slotId)}
                          onBlurCapture={() =>
                            setActivePlanSlot((cur) =>
                              cur === slotId ? null : cur,
                            )
                          }
                        >
                          <RichTextPlanEditor
                            userId={userId}
                            dateKey={dateKey}
                            slotId={slotId}
                            initialHtml={plan?.html ?? ""}
                            attachments={atts}
                            year={activeYear}
                            palette={subjectPalette}
                            compact
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

    </div>
  );
}
