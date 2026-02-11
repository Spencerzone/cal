import { useEffect, useMemo, useState } from "react";
import { dayLabelsForSet } from "../db/templateQueries";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";
import { getDb } from "../db/db";
import type { CycleTemplateEvent, DayLabel, SlotAssignment, SlotId, Subject } from "../db/db";
import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
import { getSubjectsByUser } from "../db/subjectQueries";
import { subjectIdForTemplateEvent } from "../db/subjectUtils";
import { deletePlacement, getPlacementsForDayLabels, upsertPlacement } from "../db/placementQueries";

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

function weekdayFromLabel(label: DayLabel): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" {
  return label.slice(0, 3) as any;
}

const userId = "local";

export default function MatrixPage() {
  const [set, setSet] = useState<"A" | "B">("A");
  const labels = useMemo(() => dayLabelsForSet(set), [set]);
  const rows = useMemo(() => SLOT_DEFS, []);

  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());
  const [assignments, setAssignments] = useState<SlotAssignment[]>([]);

  const [subjectsById, setSubjectsById] = useState<Map<string, Subject>>(new Map());
  const [placementsByKey, setPlacementsByKey] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    (async () => {
      const db = await getDb();
      const template = await db.getAll("cycleTemplateEvents");
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, []);

  async function loadSubjects() {
    await ensureSubjectsFromTemplates(userId);
    const subs = await getSubjectsByUser(userId);
    setSubjectsById(new Map(subs.map((s) => [s.id, s])));
  }

  async function loadPlacements() {
    const ps = await getPlacementsForDayLabels(userId, labels);
    const m = new Map<string, string | null>();
    for (const p of ps) m.set(`${p.dayLabel}::${p.slotId}`, p.subjectId);
    setPlacementsByKey(m);
  }

  useEffect(() => {
    loadSubjects();
    const onSubjects = () => loadSubjects();
    window.addEventListener("subjects-changed", onSubjects as any);
    return () => window.removeEventListener("subjects-changed", onSubjects as any);
  }, []);

  useEffect(() => {
    (async () => {
      const a = await getAssignmentsForDayLabels(labels);
      setAssignments(a);
    })();
  }, [labels]);

  useEffect(() => {
    loadPlacements();
    const onPlacements = () => loadPlacements();
    window.addEventListener("placements-changed", onPlacements as any);
    return () => window.removeEventListener("placements-changed", onPlacements as any);
  }, [labels.join(",")]);

  // Default cell content from slotAssignments/template.
  const baseCell = useMemo(() => {
    const m = new Map<string, { kind: SlotAssignment["kind"]; e?: CycleTemplateEvent }>();

    for (const a of assignments) {
      const k = `${a.dayLabel}::${a.slotId}`;
      if (a.kind === "free") {
        m.set(k, { kind: "free" });
        continue;
      }
      if (a.sourceTemplateEventId) {
        const te = templateById.get(a.sourceTemplateEventId);
        if (te) m.set(k, { kind: a.kind, e: te });
      }
    }

    return m;
  }, [assignments, templateById]);

  const hasTemplate = templateById.size > 0;

  const subjectsByKind = useMemo(() => {
    const subs = Array.from(subjectsById.values());
    const by = {
      subject: subs.filter((s) => s.kind === "subject"),
      duty: subs.filter((s) => s.kind === "duty"),
      break: subs.filter((s) => s.kind === "break"),
    };
    for (const k of Object.keys(by) as (keyof typeof by)[]) {
      by[k].sort((a, b) => a.title.localeCompare(b.title));
    }
    return by;
  }, [subjectsById]);

  async function onSelect(dl: DayLabel, slotId: SlotId, value: string) {
    if (value === "") {
      await deletePlacement(dl, slotId);
      return;
    }
    if (value === "__blank__") {
      await upsertPlacement(userId, dl, slotId, null);
      return;
    }
    await upsertPlacement(userId, dl, slotId, value);
  }

  return (
    <div className="grid">
      <h1>Fortnight matrix</h1>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setSet("A")} aria-pressed={set === "A"}>
            Week A
          </button>
          <button className="btn" onClick={() => setSet("B")} aria-pressed={set === "B"}>
            Week B
          </button>
        </div>

        <div className="space" />
        <div className="muted">
          Choose a subject/duty/break for each slot. “Use template” removes the override.
        </div>
      </div>

      {!hasTemplate ? (
        <div className="card">
          <div>
            <strong>No template found.</strong>
          </div>
          <div className="muted">Import an ICS and build the MonA–FriB template first.</div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", width: 160 }} className="muted">
                  Slot
                </th>
                {labels.map((dl) => (
                  <th key={dl} style={{ textAlign: "left", minWidth: 260 }}>
                    {weekdayFromLabel(dl)} <span className="muted">{set}</span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ verticalAlign: "top" }}>
                    <div className="badge">{row.label}</div>
                  </td>

                  {labels.map((dl) => {
                    const k = `${dl}::${row.id}`;
                    const override = placementsByKey.has(k) ? placementsByKey.get(k) : undefined;
                    const base = baseCell.get(k);

                    const baseSubjectId = base?.e ? subjectIdForTemplateEvent(base.e) : null;
                    const baseSubject = baseSubjectId ? subjectsById.get(baseSubjectId) : undefined;

                    const overrideSubject = typeof override === "string" ? subjectsById.get(override) : undefined;

                    const bg = override === null ? "#0f0f0f" : (overrideSubject?.color ?? baseSubject?.color ?? "#0f0f0f");

                    const selectValue =
                      override === undefined
                        ? ""
                        : override === null
                        ? "__blank__"
                        : override;

                    const labelText =
                      override === null
                        ? "Blank"
                        : overrideSubject
                        ? overrideSubject.title
                        : base?.kind === "free"
                        ? "Free"
                        : base?.e
                        ? base.e.title
                        : "—";

                    const subText =
                      override === undefined
                        ? "Using template"
                        : override === null
                        ? "Override: blank"
                        : "Override";

                    return (
                      <td key={k} style={{ verticalAlign: "top" }}>
                        <div className="card" style={{ background: bg, minHeight: 88 }}>
                          <div>
                            <strong>{labelText}</strong>
                          </div>
                          <div className="muted" style={{ marginTop: 4 }}>
                            {subText}
                          </div>
                          <div className="space" />
                          <select
                            value={selectValue}
                            onChange={(e) => onSelect(dl, row.id, e.target.value)}
                            style={{ width: "100%" }}
                          >
                            <option value="">Use template</option>
                            <option value="__blank__">Blank</option>
                            <optgroup label="Subjects">
                              {subjectsByKind.subject.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.title}{s.code ? ` (${s.code})` : ""}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Duties">
                              {subjectsByKind.duty.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.title}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Breaks">
                              {subjectsByKind.break.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.title}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
