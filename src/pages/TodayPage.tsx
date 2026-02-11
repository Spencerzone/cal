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
import { addAttachmentToPlan, deleteAttachment, getAttachmentsForPlan, getLessonPlansForDate, upsertLessonPlan } from "../db/lessonPlanQueries";

type Cell =
  | { kind: "blank" }
  | { kind: "free" }
  | { kind: "manual"; a: SlotAssignment }
  | { kind: "template"; a: SlotAssignment; e: CycleTemplateEvent };

const SLOT_LABEL_TO_ID: Record<string, SlotId> = Object.fromEntries(
  SLOT_DEFS.map((s) => [s.label, s.id])
) as Record<string, SlotId>;

const userId = "local";

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

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());

  const dateKey = useMemo(() => format(selectedDate, "yyyy-MM-dd"), [selectedDate]);
  const dateLocal = useMemo(() => new Date(selectedDate), [selectedDate]);
  const isViewingToday = useMemo(() => format(new Date(), "yyyy-MM-dd") === dateKey, [dateKey]);

  // clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
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
          return { title, start, end };
        }

        const subject = subjectById.get(subjectIdForTemplateEvent(e));
        const detail = detailForTemplateEvent(e);
        const title = subject ? displayTitle(subject, detail) : e.title;
        return { title, start, end };
      })
      .filter((x): x is { title: string; start: number; end: number } => !!x)
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
    setSelectedDate((d) => addDays(d, -1));
  }
  function onNextDay() {
    setSelectedDate((d) => addDays(d, 1));
  }

  function planKeyForSlot(slotId: SlotId) {
    return `${dateKey}::${slotId}`;
  }

  function formatDisplayDate(d: Date) {
    return format(d, "EEE d MMM yyyy");
  }

  function RichTextPlanEditor(props: {
    slotId: SlotId;
    initialHtml: string;
    attachments: LessonAttachment[];
  }) {
    const { slotId, initialHtml, attachments } = props;
    const ref = useRef<HTMLDivElement | null>(null);
    const [html, setHtml] = useState<string>(initialHtml);
    const saveTimer = useRef<number | null>(null);

    useEffect(() => {
      setHtml(initialHtml);
      if (ref.current && ref.current.innerHTML !== initialHtml) {
        ref.current.innerHTML = initialHtml;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialHtml]);

    function scheduleSave(nextHtml: string) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        upsertLessonPlan(userId, dateKey, slotId, nextHtml);
      }, 600);
    }

    function exec(cmd: string, value?: string) {
      // Ensure the editor is focused so execCommand applies
      ref.current?.focus();
      // eslint-disable-next-line deprecation/deprecation
      document.execCommand(cmd, false, value);
      const next = ref.current?.innerHTML ?? "";
      setHtml(next);
      scheduleSave(next);
    }

    function onInput() {
      const next = ref.current?.innerHTML ?? "";
      setHtml(next);
      scheduleSave(next);
    }

    async function onAddFiles(files: FileList | null) {
      if (!files || files.length === 0) return;
      const planKey = planKeyForSlot(slotId);
      // Ensure plan exists (if empty, store a stub so attachments have a parent)
      if (!html.trim()) {
        await upsertLessonPlan(userId, dateKey, slotId, "<p></p>");
      }
      for (const f of Array.from(files)) {
        await addAttachmentToPlan(userId, planKey, f);
      }
    }

    return (
      <div className="card" style={{ marginTop: 8, background: "#0b0b0b" }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="badge">Lesson plan</span>

          <button className="btn" type="button" onClick={() => exec("bold")}>B</button>
          <button className="btn" type="button" onClick={() => exec("italic")}>I</button>
          <button className="btn" type="button" onClick={() => exec("underline")}>U</button>
          <button className="btn" type="button" onClick={() => exec("insertUnorderedList")}>• List</button>
          <button className="btn" type="button" onClick={() => exec("insertOrderedList")}>1. List</button>

          <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Text
            <input
              type="color"
              onChange={(e) => exec("foreColor", e.target.value)}
              style={{ width: 28, height: 18, padding: 0, border: 0, background: "transparent" }}
            />
          </label>

          <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Highlight
            <input
              type="color"
              onChange={(e) => exec("hiliteColor", e.target.value)}
              style={{ width: 28, height: 18, padding: 0, border: 0, background: "transparent" }}
            />
          </label>

          <button
            className="btn"
            type="button"
            onClick={() => {
              const url = window.prompt("URL (https://...)");
              if (url) exec("createLink", url);
            }}
          >
            Link
          </button>

          <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Attach
            <input
              type="file"
              multiple
              onChange={(e) => {
                onAddFiles(e.target.files);
                e.currentTarget.value = "";
              }}
              style={{ display: "none" }}
            />
          </label>

          <button className="btn" type="button" onClick={() => exec("removeFormat")}>Clear</button>

          <span className="muted" style={{ marginLeft: "auto" }}>
            Auto-saves
          </span>
        </div>

        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={onInput}
          style={{
            marginTop: 8,
            minHeight: 120,
            padding: 10,
            borderRadius: 12,
            background: "#0f0f0f",
            border: "1px solid rgba(255,255,255,0.08)",
            outline: "none",
          }}
        />

        {attachments.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              Attachments
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {attachments.map((a) => (
                <div key={a.id} className="row" style={{ justifyContent: "space-between" }}>
                  <a
                    href={URL.createObjectURL(a.blob)}
                    download={a.name}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      // Revoke shortly after click to avoid leaks
                      const url = (e.currentTarget as HTMLAnchorElement).href;
                      setTimeout(() => URL.revokeObjectURL(url), 5_000);
                    }}
                  >
                    {a.name}
                  </a>
                  <button className="btn" type="button" onClick={() => deleteAttachment(a.id)}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <h1>Today</h1>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" type="button" onClick={onPrevDay}>
            ← Prev
          </button>
          <div className="badge">{formatDisplayDate(selectedDate)}</div>
          <button className="btn" type="button" onClick={onNextDay}>
            Next →
          </button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <div className="badge">Cycle day</div>{" "}
            {label ? (
              <strong>
                {weekdayFromLabel(label)} {label.slice(3)}
              </strong>
            ) : (
              <span className="muted">No school day</span>
            )}
          </div>

          <div>
            <div className="badge">Now</div>{" "}
            {currentNext.current ? <strong>{currentNext.current.title}</strong> : <span className="muted">—</span>}
          </div>

          <div>
            <div className="badge">Next</div>{" "}
            {currentNext.next ? <strong>{currentNext.next.title}</strong> : <span className="muted">—</span>}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: 160 }} className="muted">
                Slot
              </th>
              <th style={{ textAlign: "left" }} className="muted">
                Details
              </th>
            </tr>
          </thead>

          <tbody>
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
              const bg = overrideSubjectId === null ? "#0f0f0f" : (overrideSubject?.color ?? subject?.color);

              return (
                <tr key={blockId}>
                  <td style={{ verticalAlign: "top" }}>
                    <div className="badge">{blockLabel}</div>
                  </td>

                  <td style={{ verticalAlign: "top" }}>
                    <div className="card" style={{ background: bg ?? "#0f0f0f" }}>
                      {overrideSubjectId === null ? (
                        <div className="muted">—</div>
                      ) : overrideSubject ? (
                        <>
                          <div>
                            <strong>{overrideSubject.title}</strong>{" "}
                            {overrideSubject.code ? <span className="muted">({overrideSubject.code})</span> : null}
                          </div>
                          <div className="muted">
                            {roomOverride && typeof roomOverride === "string" ? <span className="badge">Room {roomOverride}</span> : null} {" "}
                            <span className="badge">{overrideSubject.kind}</span>
                          </div>
                        </>
                      ) : cell.kind === "blank" ? (
                        <div className="muted">—</div>
                      ) : cell.kind === "free" ? (
                        <div className="muted">Free</div>
                      ) : cell.kind === "manual" ? (
                        <>
                          <div>
                            <strong>{cell.a.manualTitle}</strong>{" "}
                            {cell.a.manualCode ? <span className="muted">({cell.a.manualCode})</span> : null}
                          </div>
                          <div className="muted">
                            {(roomOverride === undefined ? cell.a.manualRoom : roomOverride || null) ? (
                              <span className="badge">Room {roomOverride === undefined ? cell.a.manualRoom : roomOverride}</span>
                            ) : null}{" "}
                            <span className="badge">{cell.a.kind}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>{subject ? displayTitle(subject, detail) : cell.e.title}</strong>{" "}
                            {cell.e.code ? <span className="muted">({cell.e.code})</span> : null}
                            <span style={{ marginLeft: 10 }} className="muted">
                              {timeRangeFromTemplate(dateLocal, cell.e)}
                            </span>
                          </div>
                          <div className="muted">
                            {(() => {
                              const resolved = roomOverride === undefined ? cell.e.room : roomOverride;
                              return resolved ? <span className="badge">Room {resolved}</span> : null;
                            })()} {" "}
                            {cell.e.periodCode ? <span className="badge">{cell.e.periodCode}</span> : null}{" "}
                            <span className="badge">{cell.a.kind}</span>
                          </div>
                        </>
                      )}

                      {slotId ? (
                        <RichTextPlanEditor
                          slotId={slotId}
                          initialHtml={planBySlot.get(slotId)?.html ?? ""}
                          attachments={attachmentsBySlot.get(slotId) ?? []}
                        />
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