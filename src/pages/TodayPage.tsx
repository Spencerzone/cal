import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { getDb } from "../db/db";
import type { Block, CycleTemplateEvent, DayLabel, SlotAssignment, SlotId, Subject } from "../db/db";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta, applyMetaToLabel } from "../rolling/templateMapping";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { SLOT_DEFS } from "../rolling/slots";

import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
import { getSubjectsByUser } from "../db/subjectQueries";
import { subjectIdForTemplateEvent, detailForTemplateEvent, displayTitle } from "../db/subjectUtils";

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

  const todayKey = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const todayLocal = useMemo(() => new Date(), []);

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

  // load subjects + keep in sync with edits
  useEffect(() => {
    loadSubjects();

    const onChanged = () => loadSubjects();
    const onFocus = () => loadSubjects();
    const onVis = () => {
      if (document.visibilityState === "visible") loadSubjects();
    };

    window.addEventListener("subjects-changed", onChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("subjects-changed", onChanged);
      window.removeEventListener("focus", onFocus);
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

  // compute today's DayLabel (canonical), then apply mapping to reach stored label
  useEffect(() => {
    (async () => {
      const settings = await getRollingSettings();
      const canonical = dayLabelForDate(todayKey, settings) as DayLabel | null;

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
  }, [todayKey]);

  const cells: Array<{ blockId: string; blockLabel: string; cell: Cell }> = useMemo(() => {
    return blocks.map((b) => {
      const slotId = SLOT_LABEL_TO_ID[b.name];
      const a = slotId ? assignmentBySlot.get(slotId) : undefined;

      if (!a) return { blockId: b.id, blockLabel: b.name, cell: { kind: "blank" } };
      if (a.kind === "free") return { blockId: b.id, blockLabel: b.name, cell: { kind: "free" } };
      if (a.manualTitle) return { blockId: b.id, blockLabel: b.name, cell: { kind: "manual", a } };

      if (a.sourceTemplateEventId) {
        const e = templateById.get(a.sourceTemplateEventId);
        if (e) return { blockId: b.id, blockLabel: b.name, cell: { kind: "template", a, e } };
      }

      return { blockId: b.id, blockLabel: b.name, cell: { kind: "blank" } };
    });
  }, [blocks, assignmentBySlot, templateById]);

  // current/next computed only from template events (ignore blank/free/manual)
  const currentNext = useMemo(() => {
    const realEvents = cells
      .filter((x) => x.cell.kind === "template")
      .map((x) => {
        const e = (x.cell as any).e as CycleTemplateEvent;
        const start = minutesToLocalDateTime(todayLocal, e.startMinutes).getTime();
        const end = minutesToLocalDateTime(todayLocal, e.endMinutes).getTime();

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
  }, [cells, now, todayLocal, subjectById]);

  return (
    <div className="grid">
      <h1>Today</h1>

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
            {cells.map(({ blockId, blockLabel, cell }) => {
              const subject =
                cell.kind === "template" ? subjectById.get(subjectIdForTemplateEvent(cell.e)) : undefined;
              const detail = cell.kind === "template" ? detailForTemplateEvent(cell.e) : null;
              const bg = subject?.color;

              return (
                <tr key={blockId}>
                  <td style={{ verticalAlign: "top" }}>
                    <div className="badge">{blockLabel}</div>
                  </td>

                  <td style={{ verticalAlign: "top" }}>
                    <div className="card" style={{ background: bg ?? "#0f0f0f" }}>
                      {cell.kind === "blank" ? (
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
                            {cell.a.manualRoom ? <span className="badge">Room {cell.a.manualRoom}</span> : null}{" "}
                            <span className="badge">{cell.a.kind}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <strong>{subject ? displayTitle(subject, detail) : cell.e.title}</strong>{" "}
                            {cell.e.code ? <span className="muted">({cell.e.code})</span> : null}
                            <span style={{ marginLeft: 10 }} className="muted">
                              {timeRangeFromTemplate(todayLocal, cell.e)}
                            </span>
                          </div>
                          <div className="muted">
                            {cell.e.room ? <span className="badge">Room {cell.e.room}</span> : null}{" "}
                            {cell.e.periodCode ? <span className="badge">{cell.e.periodCode}</span> : null}{" "}
                            <span className="badge">{cell.a.kind}</span>
                          </div>
                        </>
                      )}
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