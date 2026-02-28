import { useEffect, useMemo, useState } from "react";
import { format, parseISO, isValid } from "date-fns";
import { useAuth } from "../auth/AuthProvider";
import type {
  DayLabel,
  SlotAssignment,
  SlotId,
  Subject,
  CycleTemplateEvent,
} from "../db/db";
import { getSubjectsByUser } from "../db/subjectQueries";
import { getRollingSettings } from "../rolling/settings";
import { dayLabelForDate } from "../rolling/cycle";
import { getTemplateMeta } from "../rolling/templateMapping";
import { applyMetaToLabel } from "../rolling/templateMapping";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";
import { getAllCycleTemplateEvents } from "../db/templateQueries";
import { getPlacementsForDayLabels } from "../db/placementQueries";
import { subjectIdForTemplateEvent } from "../db/subjectUtils";
import { getLessonPlansForDate } from "../db/lessonPlanQueries";
import RichTextPlanEditor from "../components/RichTextPlanEditor";

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

function isHtmlEffectivelyEmpty(html: string | undefined | null): boolean {
  const s = (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
  return s.length === 0;
}

function eachDateKeyInclusive(startKey: string, endKey: string): string[] {
  const start = parseISO(startKey);
  const end = parseISO(endKey);
  if (!isValid(start) || !isValid(end)) return [];
  const out: string[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const endMs = new Date(end);
  endMs.setHours(0, 0, 0, 0);
  while (d.getTime() <= endMs.getTime()) {
    out.push(format(d, "yyyy-MM-dd"));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export default function SubjectPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";

  const [rollingSettings, setRollingSettings] = useState<any>(null);
  const activeYear = useMemo(
    () => (rollingSettings?.activeYear ?? new Date().getFullYear()) as number,
    [rollingSettings],
  );

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectsById, setSubjectsById] = useState<Map<string, Subject>>(
    new Map(),
  );
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");

  const [termSel, setTermSel] = useState<"all" | 1 | 2 | 3 | 4>("all");
  const [showEmpty, setShowEmpty] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const subjectPalette = useMemo(() => {
    const colours = subjects
      .map((s) => (s as any)?.color)
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .map((c) => c.trim().toLowerCase());
    return Array.from(new Set(colours)).sort();
  }, [subjects]);

  // Load rolling settings
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      const s = await getRollingSettings(userId);
      if (!alive) return;
      setRollingSettings(s as any);
    })();
    const onChange = async () => {
      const s = await getRollingSettings(userId);
      if (!alive) return;
      setRollingSettings(s as any);
    };
    window.addEventListener("rolling-settings-changed", onChange as any);
    return () => {
      alive = false;
      window.removeEventListener("rolling-settings-changed", onChange as any);
    };
  }, [userId]);

  // Load subjects for active year
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      const subs = await getSubjectsByUser(userId, activeYear);
      if (!alive) return;
      subs.sort((a, b) => a.title.localeCompare(b.title));
      setSubjects(subs);
      setSubjectsById(new Map(subs.map((s) => [s.id, s])));
      // Default selection
      setSelectedSubjectId((prev) => {
        if (prev && subs.some((s) => s.id === prev)) return prev;
        return subs[0]?.id ?? "";
      });
    })();
    const onChanged = () => {
      (async () => {
        const subs = await getSubjectsByUser(userId, activeYear);
        if (!alive) return;
        subs.sort((a, b) => a.title.localeCompare(b.title));
        setSubjects(subs);
        setSubjectsById(new Map(subs.map((s) => [s.id, s])));
      })();
    };
    window.addEventListener("subjects-changed", onChanged as any);
    return () => {
      alive = false;
      window.removeEventListener("subjects-changed", onChanged as any);
    };
  }, [userId, activeYear]);

  const selectedSubject = selectedSubjectId
    ? subjectsById.get(selectedSubjectId)
    : undefined;

  const termRange = useMemo(() => {
    const s = rollingSettings as any;
    const yearConfig = (s?.termYears ?? []).find(
      (y: any) => y.year === activeYear,
    );
    const starts = (yearConfig?.starts ?? s?.termStarts ?? {}) as any;
    const ends = (yearConfig?.ends ?? s?.termEnds ?? {}) as any;

    const pick = (k: "t1" | "t2" | "t3" | "t4") => ({
      start: (starts?.[k] ?? "").trim(),
      end: (ends?.[k] ?? "").trim(),
    });

    if (termSel === "all") {
      const items = [pick("t1"), pick("t2"), pick("t3"), pick("t4")].filter(
        (x) => x.start,
      );
      if (!items.length) return null;
      const start = items.map((x) => x.start).sort()[0];
      // end might be blank; if so just run for 10 weeks from start (fallback)
      const endsList = items
        .map((x) => x.end)
        .filter(Boolean)
        .sort();
      const end = endsList.length ? endsList[endsList.length - 1] : start;
      return { start, end };
    }

    const k = ("t" + String(termSel)) as "t1" | "t2" | "t3" | "t4";
    const one = pick(k);
    if (!one.start) return null;
    return { start: one.start, end: one.end || one.start };
  }, [rollingSettings, activeYear, termSel]);

  type LessonRow = {
    dateKey: string;
    dayLabel: DayLabel;
    slotId: SlotId;
    slotLabel: string;
    title: string;
    color: string;
    html: string;
  };

  const [rows, setRows] = useState<LessonRow[]>([]);

  useEffect(() => {
    if (!userId) return;
    if (!selectedSubjectId) {
      setRows([]);
      return;
    }
    if (!termRange?.start) {
      setRows([]);
      return;
    }

    let alive = true;
    setLoading(true);

    (async () => {
      const settings = (await getRollingSettings(userId)) as any;
      const meta = await getTemplateMeta(userId, activeYear);
      const template = await getAllCycleTemplateEvents(userId, activeYear);
      const templateById = new Map<string, CycleTemplateEvent>(
        template.map((e) => [e.id, e]),
      );

      const dateKeys = eachDateKeyInclusive(termRange.start, termRange.end);
      const dateLabelPairs: Array<{ dateKey: string; label: DayLabel }> = [];
      for (const dk of dateKeys) {
        const canonical = dayLabelForDate(dk, settings) as DayLabel | null;
        if (!canonical) continue; // weekend/holiday
        const stored = meta ? applyMetaToLabel(canonical, meta) : canonical;
        dateLabelPairs.push({ dateKey: dk, label: stored });
      }

      const uniqueLabels = Array.from(
        new Set(dateLabelPairs.map((x) => x.label)),
      );
      const assignments = uniqueLabels.length
        ? await getAssignmentsForDayLabels(userId, activeYear, uniqueLabels)
        : [];

      const placements = uniqueLabels.length
        ? await getPlacementsForDayLabels(userId, activeYear, uniqueLabels)
        : [];

      const assignmentByKey = new Map<string, SlotAssignment>();
      for (const a of assignments)
        assignmentByKey.set(`${a.dayLabel}::${a.slotId}`, a);

      const placementByKey = new Map<
        string,
        { subjectId?: string | null; roomOverride?: string | null }
      >();
      for (const p of placements) {
        const k = `${p.dayLabel}::${p.slotId}`;
        const o: { subjectId?: string | null; roomOverride?: string | null } =
          {};
        if (Object.prototype.hasOwnProperty.call(p, "subjectId"))
          o.subjectId = (p as any).subjectId;
        if (Object.prototype.hasOwnProperty.call(p, "roomOverride"))
          o.roomOverride = (p as any).roomOverride;
        placementByKey.set(k, o);
      }

      const out: LessonRow[] = [];

      for (const { dateKey, label } of dateLabelPairs) {
        const plans = await getLessonPlansForDate(userId, activeYear, dateKey);
        const plansBySlot = new Map<SlotId, string>();
        for (const p of plans)
          plansBySlot.set(p.slotId as SlotId, p.html ?? "");

        for (const slot of SLOT_DEFS) {
          const key = `${label}::${slot.id}`;
          const a = assignmentByKey.get(key);
          if (!a) continue;

          // base subject from template event
          let baseSubjectId: string | null = null;
          let title = "—";
          if (a.manualTitle) {
            title = a.manualTitle;
          } else if (a.sourceTemplateEventId) {
            const te = templateById.get(a.sourceTemplateEventId);
            if (te) {
              title = te.title;
              baseSubjectId = subjectIdForTemplateEvent(te);
            }
          }

          const ov = placementByKey.get(key);
          const ovSubjectId =
            ov && Object.prototype.hasOwnProperty.call(ov, "subjectId")
              ? ov.subjectId
              : undefined;
          const resolvedSubjectId =
            ovSubjectId === undefined ? baseSubjectId : ovSubjectId;

          if (resolvedSubjectId !== selectedSubjectId) continue;

          const html = plansBySlot.get(slot.id) ?? "";
          if (!showEmpty && isHtmlEffectivelyEmpty(html)) continue;

          const colour = selectedSubject?.color ?? "#0f0f0f";
          out.push({
            dateKey,
            dayLabel: label,
            slotId: slot.id,
            slotLabel: slot.label,
            title,
            color: colour,
            html,
          });
        }
      }

      out.sort((a, b) =>
        a.dateKey === b.dateKey
          ? a.slotLabel.localeCompare(b.slotLabel)
          : a.dateKey.localeCompare(b.dateKey),
      );

      if (!alive) return;
      setRows(out);
      setLoading(false);
    })().catch(() => {
      if (!alive) return;
      setRows([]);
      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [
    userId,
    activeYear,
    selectedSubjectId,
    termRange?.start,
    termRange?.end,
    showEmpty,
  ]);

  return (
    <div className="grid">
      <h1>Lessons</h1>

      <div className="card">
        <div
          className="row"
          style={{ gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}
        >
          <div
            className="row"
            style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}
          >
            <div>
              <div className="muted">Subject</div>
              <select
                value={selectedSubjectId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setSelectedSubjectId(e.target.value)
                }
                style={{ minWidth: 280 }}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.code ? ` (${s.code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="muted">Time period</div>
              <select
                value={termSel}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const v = e.target.value;
                  setTermSel(
                    v === "all" ? "all" : (parseInt(v, 10) as 1 | 2 | 3 | 4),
                  );
                }}
              >
                <option value="all">All terms</option>
                <option value={1}>Term 1</option>
                <option value={2}>Term 2</option>
                <option value={3}>Term 3</option>
                <option value={4}>Term 4</option>
              </select>
            </div>

            <label
              className="row"
              style={{ gap: 8, alignItems: "center", marginTop: 18 }}
            >
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={(e) => setShowEmpty(e.target.checked)}
              />
              Show empty lessons
            </label>
          </div>

          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <div className="badge">Active year</div>
            <div>{activeYear}</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card">
          <div className="muted">Loading lessons…</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="muted">No lessons found.</div>
        </div>
      ) : (
        <div className="grid" style={{ gap: 12 }}>
          {rows.map((r) => (
            <div
              key={`${r.dateKey}::${r.slotId}`}
              className="card"
              style={{ padding: 0, overflow: "hidden" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "6px 1fr",
                }}
              >
                <div style={{ background: r.color }} />
                <div style={{ padding: 14 }}>
                  <div
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {format(parseISO(r.dateKey), "EEE d MMM yyyy")} ·{" "}
                        {r.slotLabel}
                      </div>
                      <div className="muted" style={{ marginTop: 4 }}>
                        {selectedSubject?.title ?? "(unknown subject)"}
                      </div>
                    </div>
                  </div>

                  <div className="space" />
                  <RichTextPlanEditor
                    userId={userId}
                    year={activeYear}
                    dateKey={r.dateKey}
                    slotId={r.slotId}
                    initialHtml={r.html}
                    attachments={[]}
                    palette={subjectPalette}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
