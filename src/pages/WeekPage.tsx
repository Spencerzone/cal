// src/pages/WeekPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import { getDb } from "../db/db";
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
import { SLOT_DEFS } from "../rolling/slots";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";

import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
import { getSubjectsByUser } from "../db/subjectQueries";
import { subjectIdForTemplateEvent, detailForTemplateEvent, displayTitle } from "../db/subjectUtils";
import { getPlacementsForDayLabels } from "../db/placementQueries";
import { getAttachmentsForPlan, getLessonPlansForDate } from "../db/lessonPlanQueries";
import { termWeekForDate } from "../rolling/termWeek";
import RichTextPlanEditor from "../components/RichTextPlanEditor";

type Cell =
  | { kind: "blank" }
  | { kind: "free" }
  | { kind: "manual"; a: SlotAssignment }
  | { kind: "placed"; subjectId: string }
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const userId = "local";

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id])
) as Record<string, SlotId>;

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

function minutesToLocalDateTime(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, minutes, 0, 0);
  return d;
}

function timeRangeFromTemplate(day: Date, e: CycleTemplateEvent): string {
  const s = minutesToLocalDateTime(day, e.startMinutes);
  const t = minutesToLocalDateTime(day, e.endMinutes);
  return `${format(s, "H:mm")}–${format(t, "H:mm")}`;
}

export default function WeekPage() {
  const [subjectById, setSubjectById] = useState<Map<string, Subject>>(new Map());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());

  const [plansByDate, setPlansByDate] = useState<Map<string, Map<SlotId, LessonPlan>>>(new Map());
  const [attachmentsByDate, setAttachmentsByDate] = useState<Map<string, Map<SlotId, LessonAttachment[]>>>(new Map());
  const [openPlanKey, setOpenPlanKey] = useState<string | null>(null);
  const [activePlanKey, setActivePlanKey] = useState<string | null>(null);
  const openPlanHasEverHadContentRef = useRef<Map<string, boolean>>(new Map());

  // Map keyed by dateKey ("yyyy-MM-dd") => assignments for that dayLabel
  const [assignmentsByDate, setAssignmentsByDate] = useState<Map<string, Map<SlotId, SlotAssignment>>>(new Map());

  // Map keyed by dateKey => resolved canonical dayLabel (after meta mapping)
  const [dayLabelByDate, setDayLabelByDate] = useState<Map<string, DayLabel>>(new Map());

  // Map keyed by dateKey => slotId -> placement override
  const [placementsByDate, setPlacementsByDate] = useState<
    Map<string, Map<SlotId, { subjectId?: string | null; roomOverride?: string | null }>>
  >(new Map());

  // Cursor is Monday of the week being viewed
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [rollingSettings, setRollingSettingsState] = useState<any>(null);

  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), [weekStart]);

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

  useEffect(() => {
    (async () => {
      const s = await getRollingSettings();
      setRollingSettingsState(s);
    })();
  }, []);

  // Load blocks
  useEffect(() => {
    (async () => {
      await ensureDefaultBlocks(userId);
      setBlocks(await getVisibleBlocks(userId));
    })();
  }, []);

  // Load rolling settings (used for optional term/week display)
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

  // Load subjects and keep them in sync with edits.
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

  // Load templates
  useEffect(() => {
    (async () => {
      const db = await getDb();
      const template = await db.getAll("cycleTemplateEvents");
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, []);

  // Load assignments for each Mon-Fri date in the viewed week
  useEffect(() => {
    (async () => {
      const settings = await getRollingSettings();
      const meta = await getTemplateMeta();

      const db = await getDb();
      const out = new Map<string, Map<SlotId, SlotAssignment>>();
      const dlOut = new Map<string, DayLabel>();

      for (const d of weekDays) {
        const dateKey = format(d, "yyyy-MM-dd");

        const canonical = dayLabelForDate(dateKey, settings) as DayLabel | null;
        if (!canonical) {
          out.set(dateKey, new Map()); // non-school day
          continue;
        }

        const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;
        dlOut.set(dateKey, stored);

        const idx = db.transaction("slotAssignments").store.index("byDayLabel");
        const rows = await idx.getAll(stored);

        const m = new Map<SlotId, SlotAssignment>();
        for (const a of rows) m.set(a.slotId, a);

        out.set(dateKey, m);
      }

      setAssignmentsByDate(out);
      setDayLabelByDate(dlOut);
    })();
  }, [weekDays]);

  // Load lesson plans + attachments for each day in the viewed week
  useEffect(() => {
    const load = async () => {
      const pOut = new Map<string, Map<SlotId, LessonPlan>>();
      const aOut = new Map<string, Map<SlotId, LessonAttachment[]>>();

      for (const d of weekDays) {
        const dateKey = format(d, "yyyy-MM-dd");
        const plans = await getLessonPlansForDate(userId, dateKey);

        const pMap = new Map<SlotId, LessonPlan>();
        const aMap = new Map<SlotId, LessonAttachment[]>();

        for (const p of plans) pMap.set(p.slotId, p);
        for (const [slotId, plan] of pMap) {
          const atts = await getAttachmentsForPlan(plan.key);
          aMap.set(slotId, atts);
        }

        pOut.set(dateKey, pMap);
        aOut.set(dateKey, aMap);
      }

      setPlansByDate(pOut);
      setAttachmentsByDate(aOut);
    };

    load();
    const onChanged = () => load();
    window.addEventListener("lessonplans-changed", onChanged as any);
    return () => window.removeEventListener("lessonplans-changed", onChanged as any);
  }, [weekDays]);

  // If an open plan is deleted/emptied, auto-collapse ONLY if it previously had content.
  useEffect(() => {
    if (!openPlanKey) return;
    // Don't auto-collapse while the editor is focused/active (e.g. user clearing to retype).
    if (activePlanKey === openPlanKey) return;
    const [dateKey, slotIdRaw] = openPlanKey.split("::");
    const slotId = slotIdRaw as SlotId;
    const plan = plansByDate.get(dateKey)?.get(slotId);
    const atts = attachmentsByDate.get(dateKey)?.get(slotId) ?? [];
    const hasPlan = (!!plan && !isHtmlEffectivelyEmpty(plan.html)) || atts.length > 0;

    if (hasPlan) {
      openPlanHasEverHadContentRef.current.set(openPlanKey, true);
      return;
    }

    const hadContentBefore = openPlanHasEverHadContentRef.current.get(openPlanKey) ?? false;
    if (hadContentBefore) {
      // After a plan is cleared and deleted, treat future opens as "new" again.
      // This prevents immediate auto-collapse when reopening the now-empty slot.
      openPlanHasEverHadContentRef.current.delete(openPlanKey);
      setOpenPlanKey(null);
    }
  }, [openPlanKey, activePlanKey, plansByDate, attachmentsByDate]);

  // Load placements for the dayLabels used this week
  useEffect(() => {
    (async () => {
      const unique = Array.from(new Set(Array.from(dayLabelByDate.values())));
      if (unique.length === 0) {
        setPlacementsByDate(new Map());
        return;
      }
      const ps = await getPlacementsForDayLabels(userId, unique);

      // Build mapping by dayLabel -> slotId -> placement override
      const byLabel = new Map<DayLabel, Map<SlotId, { subjectId?: string | null; roomOverride?: string | null }>>();
      for (const p of ps) {
        const m = byLabel.get(p.dayLabel) ?? new Map<SlotId, { subjectId?: string | null; roomOverride?: string | null }>();
        const o: { subjectId?: string | null; roomOverride?: string | null } = {};
        if (Object.prototype.hasOwnProperty.call(p, "subjectId")) o.subjectId = p.subjectId;
        if (Object.prototype.hasOwnProperty.call(p, "roomOverride")) o.roomOverride = p.roomOverride;
        m.set(p.slotId, o);
        byLabel.set(p.dayLabel, m);
      }

      // Map into dateKeys for this week
      const byDate = new Map<string, Map<SlotId, { subjectId?: string | null; roomOverride?: string | null }>>();
      for (const [dateKey, dl] of dayLabelByDate) {
        byDate.set(dateKey, byLabel.get(dl) ?? new Map());
      }
      setPlacementsByDate(byDate);
    })();
  }, [dayLabelByDate]);

  // Refresh placements when changed elsewhere
  useEffect(() => {
    const onChanged = () => {
      // re-run effect by cloning dayLabelByDate
      setDayLabelByDate(new Map(dayLabelByDate));
    };
    window.addEventListener("placements-changed", onChanged as any);
    return () => window.removeEventListener("placements-changed", onChanged as any);
  }, [dayLabelByDate]);

  // Build grid: rows=blocks, cols=weekDays
  const grid = useMemo(() => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name]; // undefined for custom blocks => blanks
      const rowCells = weekDays.map((d) => {
        const dateKey = format(d, "yyyy-MM-dd");
        if (!slotId) return { kind: "blank" } as Cell;

        const overrideMap = placementsByDate.get(dateKey);
        const entry = overrideMap?.get(slotId);
        if (entry && Object.prototype.hasOwnProperty.call(entry, "subjectId")) {
          const ov = entry.subjectId;
          if (ov === null) return { kind: "blank" } as Cell;
          if (typeof ov === "string") return { kind: "placed", subjectId: ov } as Cell;
        }

        const a = assignmentsByDate.get(dateKey)?.get(slotId);

        if (!a) return { kind: "blank" } as Cell;
        if (a.kind === "free") return { kind: "free" } as Cell;
        if (a.manualTitle) return { kind: "manual", a } as Cell;

        if (a.sourceTemplateEventId) {
          const e = templateById.get(a.sourceTemplateEventId);
          if (e) return { kind: "template", a, e } as Cell;
        }

        return { kind: "blank" } as Cell;
      });

      return { block: b, cells: rowCells };
    });
  }, [blocks, weekDays, assignmentsByDate, templateById, placementsByDate]);

  function onGoThisWeek() {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  }

  function DatePickerPopover() {
    const rangeLabel = `${format(weekStart, "d MMM")} – ${format(addDays(weekStart, 4), "d MMM")}`;
    const value = format(weekStart, "yyyy-MM-dd");

    return (
      <div style={{ position: "relative" }}>
        <button className="btn" type="button" onClick={() => setShowDatePicker((v) => !v)} aria-label="Choose week">
          {rangeLabel}
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
              <div className="muted">Jump to week</div>
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
                  setWeekStart(startOfWeek(new Date(`${next}T00:00:00`), { weekStartsOn: 1 }));
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
                  onGoThisWeek();
                  setShowDatePicker(false);
                }}
              >
                This week
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
      <h1>Week</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="btn" type="button" onClick={() => setWeekStart((d) => addWeeks(d, -1))}>
              ← Prev
            </button>
            <DatePickerPopover />
            <button className="btn" type="button" onClick={() => setWeekStart((d) => addWeeks(d, 1))}>
              Next →
            </button>
          </div>
          <div>
            {(() => {
              const tw = rollingSettings ? termWeekForDate(weekStart, rollingSettings.termStarts, rollingSettings.termEnds) : null;
              return tw ? (
                <span className="muted">Term {tw.term} · Week {tw.week}</span>
              ) : (
                <span className="muted">&nbsp;</span>
              );
            })()}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
          <thead>
            <tr>
              {weekDays.map((d) => (
                <th key={format(d, "yyyy-MM-dd")} style={{ textAlign: "left" }} className="muted">
                  {format(d, "EEE")} <span className="muted">{format(d, "d/M")}</span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {grid.map(({ block, cells }) => (
              <tr key={block.id}>

                {cells.map((cell, i) => {
                  const dateKey = format(weekDays[i], "yyyy-MM-dd");
                  const slotId = SLOT_LABEL_TO_ID[block.name];
                  const override = slotId ? placementsByDate.get(dateKey)?.get(slotId) : undefined;

                  const overrideSubjectId =
                    override && Object.prototype.hasOwnProperty.call(override, "subjectId")
                      ? override.subjectId
                      : undefined;

                  const overrideSubject = typeof overrideSubjectId === "string" ? subjectById.get(overrideSubjectId) : undefined;

                  const roomOverride =
                    override && Object.prototype.hasOwnProperty.call(override, "roomOverride")
                      ? override.roomOverride
                      : undefined;

                  const subject =
                    cell.kind === "template" ? subjectById.get(subjectIdForTemplateEvent(cell.e)) : undefined;
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

                  const timeText = cell.kind === "template" ? timeRangeFromTemplate(weekDays[i], cell.e) : null;

                  const plan = slotId ? plansByDate.get(dateKey)?.get(slotId) : undefined;
                  const atts = slotId ? attachmentsByDate.get(dateKey)?.get(slotId) ?? [] : [];
                  const planKey = slotId ? `${dateKey}::${slotId}` : null;
                  const hasPlan = (!!plan && !isHtmlEffectivelyEmpty(plan.html)) || atts.length > 0;
                  const showPlanEditor = !!slotId && (hasPlan || (planKey && openPlanKey === planKey));


                  return (
                    <td key={`${block.id}:${dateKey}`} style={{ verticalAlign: "top" }}>
                      <div
                        className="slotCard slotClickable"
                        style={{ ...( { ["--slotStrip" as any]: strip } as any) }}
                        role={slotId ? "button" : undefined}
                        tabIndex={slotId ? 0 : undefined}
                        onClick={() => {
                          if (!slotId || !planKey) return;
                          const planNow = plansByDate.get(dateKey)?.get(slotId);
                          const attsNow = attachmentsByDate.get(dateKey)?.get(slotId) ?? [];
                          const hasNow = (!!planNow && !isHtmlEffectivelyEmpty(planNow.html)) || attsNow.length > 0;
                          if (hasNow) openPlanHasEverHadContentRef.current.set(planKey, true);
                          setOpenPlanKey((cur) => (cur === planKey ? null : planKey));
                        }}
                        onKeyDown={(e) => {
                          if (!slotId || !planKey) return;
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const planNow = plansByDate.get(dateKey)?.get(slotId);
                            const attsNow = attachmentsByDate.get(dateKey)?.get(slotId) ?? [];
                            const hasNow = (!!planNow && !isHtmlEffectivelyEmpty(planNow.html)) || attsNow.length > 0;
                            if (hasNow) openPlanHasEverHadContentRef.current.set(planKey, true);
                            setOpenPlanKey((cur) => (cur === planKey ? null : planKey));
                          }
                        }}
                      >
                        <div className="slotTitleRow" style={{ marginTop: 0 }}>
                          <span className="slotPeriodDot" style={{ borderColor: strip, color: strip }}>
                            {compactBlockLabel(block.name)}
                          </span>
                          <div style={{ minWidth: 0, width: "100%" }}>
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
                              ) : (
                                <div className="muted">—</div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="row slotCompactBadges" style={{ gap: 6, flexWrap: "wrap", marginLeft: 32, marginTop: 6 }}>
                          {codeText ? <span className="badge">{codeText}</span> : null}
                          {resolvedRoom ? <span className="badge">Room {resolvedRoom}</span> : null}
                          {timeText ? <span className="badge">{timeText}</span> : null}
                        </div>

                        {showPlanEditor && slotId ? (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            onFocusCapture={() => setActivePlanKey(`${dateKey}::${slotId}`)}
                            onBlurCapture={(e) => {
                              const rt = (e.relatedTarget as Node | null) ?? null;
                              if (!rt || !e.currentTarget.contains(rt)) setActivePlanKey(null);
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
                    </td>
                  );
                })}
              </tr>
            ))}

            {grid.length === 0 ? (
              <tr>
                <td colSpan={weekDays.length} className="muted">
                  No data.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
