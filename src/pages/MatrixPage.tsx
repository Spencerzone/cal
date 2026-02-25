import { useEffect, useMemo, useState } from "react";
import { dayLabelsForSet } from "../db/templateQueries";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";
import { useAuth } from "../auth/AuthProvider";
import { getAllCycleTemplateEvents } from "../db/templateQueries";
import type { CycleTemplateEvent, DayLabel, SlotAssignment, SlotId, Subject } from "../db/db";
import { getSubjectsByUser } from "../db/subjectQueries";
import { subjectIdForTemplateEvent } from "../db/subjectUtils";
import { getPlacementsForDayLabels, setPlacement } from "../db/placementQueries";

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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const h = hex.trim().replace("#", "");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

// Returns a readable text colour (dark on light backgrounds, white on dark)
function contrastTextColour(bgHex: string): "#111111" | "#ffffff" {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return "#ffffff";
  // perceived luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

function rgbaFromHex(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255,255,255,${alpha})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}


export default function MatrixPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [set, setSet] = useState<"A" | "B">("A");
  const labels = useMemo(() => dayLabelsForSet(set), [set]);
  const rows = useMemo(() => SLOT_DEFS, []);

  const [templateById, setTemplateById] = useState<Map<string, CycleTemplateEvent>>(new Map());
  const [assignments, setAssignments] = useState<SlotAssignment[]>([]);

  const [subjectsById, setSubjectsById] = useState<Map<string, Subject>>(new Map());
  const [placementsByKey, setPlacementsByKey] = useState<
    Map<string, { subjectId?: string | null; roomOverride?: string | null }>
  >(new Map());

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const template = await getAllCycleTemplateEvents(userId, activeYear);
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, [userId]);

  async function loadSubjects() {
    const subs = await getSubjectsByUser(userId, activeYear);
    setSubjectsById(new Map(subs.map((s) => [s.id, s])));
  }

  async function loadPlacements() {
    const ps = await getPlacementsForDayLabels(userId, activeYear, labels);
    const m = new Map<string, { subjectId?: string | null; roomOverride?: string | null }>();
    for (const p of ps) {
      const key = `${p.dayLabel}::${p.slotId}`;
      const o: { subjectId?: string | null; roomOverride?: string | null } = {};
      if (Object.prototype.hasOwnProperty.call(p, "subjectId")) o.subjectId = p.subjectId;
      if (Object.prototype.hasOwnProperty.call(p, "roomOverride")) o.roomOverride = p.roomOverride;
      m.set(key, o);
    }
    setPlacementsByKey(m);
  }

  useEffect(() => {
    if (!userId) return;
    loadSubjects();
    const onSubjects = () => loadSubjects();
    window.addEventListener("subjects-changed", onSubjects as any);
    return () => window.removeEventListener("subjects-changed", onSubjects as any);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const a = await getAssignmentsForDayLabels(userId, activeYear, labels);
      setAssignments(a);
    })();
  }, [userId, labels.join(",")]);

  useEffect(() => {
    if (!userId) return;
    loadPlacements();
    const onPlacements = () => loadPlacements();
    window.addEventListener("placements-changed", onPlacements as any);
    return () => window.removeEventListener("placements-changed", onPlacements as any);
  }, [userId, labels.join(",")]);

  

  // Default cell content from slotAssignments/template (one per slot). Now includes manual assignments too.
  const baseCell = useMemo(() => {
    const m = new Map<
      string,
      | { kind: "free" }
      | { kind: "manual"; a: SlotAssignment }
      | { kind: SlotAssignment["kind"]; e: CycleTemplateEvent }
      | { kind: "blank" }
    >();

    for (const a of assignments) {
      const k = `${a.dayLabel}::${a.slotId}`;

      if (a.kind === "free") {
        m.set(k, { kind: "free" });
        continue;
      }

      // Prefer template linkage if present (even if manualTitle is also set)
if (a.sourceTemplateEventId) {
  const te = templateById.get(a.sourceTemplateEventId);
  if (te) {
    m.set(k, { kind: a.kind, e: te });
    continue;
  }
}

// Otherwise, treat as manual
if (a.manualTitle) {
  m.set(k, { kind: "manual", a });
  continue;
}

      m.set(k, { kind: "blank" });
    }

    return m;
  }, [assignments, templateById]);

  const hasTemplate = templateById.size > 0;

  useEffect(() => {
  if (!userId) return;

  const subjectKeys = Array.from(subjectsById.keys());
  console.log("[DBG] subjectsById keys sample:", subjectKeys.slice(0, 30));

  // sample template events actually being used by cells (via baseCell)
  const sampleBase = Array.from(baseCell.entries())
    .filter(([, v]) => v && typeof v === "object" && "e" in (v as any) && (v as any).e)
    .slice(0, 25);

  const rows = sampleBase.map(([key, v]) => {
    const e = (v as any).e as CycleTemplateEvent;
    const sid = subjectIdForTemplateEvent(e);
    return {
      cell: key,
      title: e.title,
      code: (e as any).code,
      room: (e as any).room ?? (e as any).location ?? "",
      subjectIdForTemplateEvent: sid,
      subjectExists: subjectsById.has(sid),
      subjectDocColor: subjectsById.get(sid)?.color ?? null,
    };
  });

  console.table(rows);
}, [userId, subjectsById, baseCell]);

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
    const k = `${dl}::${slotId}`;
    const existing = placementsByKey.get(k);
    const roomOverride =
      existing && Object.prototype.hasOwnProperty.call(existing, "roomOverride") ? existing.roomOverride : undefined;

    if (value === "") {
      await setPlacement(userId, activeYear, activeYear, dl, slotId, roomOverride !== undefined ? { roomOverride } : {});
      return;
    }
    if (value === "__blank__") {
      await setPlacement(
        userId,
        dl,
        slotId,
        roomOverride !== undefined ? { subjectId: null, roomOverride } : { subjectId: null }
      );
      return;
    }
    await setPlacement(userId, activeYear, activeYear, dl, slotId, roomOverride !== undefined ? { subjectId: value, roomOverride } : { subjectId: value });
  }

  async function onRoomBlur(dl: DayLabel, slotId: SlotId, nextRoomText: string) {
    const k = `${dl}::${slotId}`;
    const existing = placementsByKey.get(k);
    const subjectId =
      existing && Object.prototype.hasOwnProperty.call(existing, "subjectId") ? existing.subjectId : undefined;

    const trimmed = nextRoomText.trim();
    const roomOverride = trimmed ? trimmed : undefined;

    await setPlacement(userId, activeYear, activeYear, dl, slotId, {
      ...(subjectId !== undefined ? { subjectId } : {}),
      ...(roomOverride !== undefined ? { roomOverride } : {}),
    });
  }

  async function setBlankRoom(dl: DayLabel, slotId: SlotId) {
    const k = `${dl}::${slotId}`;
    const existing = placementsByKey.get(k);
    const subjectId =
      existing && Object.prototype.hasOwnProperty.call(existing, "subjectId") ? existing.subjectId : undefined;

    await setPlacement(userId, activeYear, activeYear, dl, slotId, {
      ...(subjectId !== undefined ? { subjectId } : {}),
      roomOverride: null,
    });
  }

  async function clearRoomOverride(dl: DayLabel, slotId: SlotId) {
    const k = `${dl}::${slotId}`;
    const existing = placementsByKey.get(k);
    const subjectId =
      existing && Object.prototype.hasOwnProperty.call(existing, "subjectId") ? existing.subjectId : undefined;

    await setPlacement(userId, activeYear, activeYear, dl, slotId, subjectId !== undefined ? { subjectId } : {});
  }

  useEffect(() => {
  if (!userId) return;

  console.log("[DBG] templateById size:", templateById.size);
  console.log("[DBG] subjectsById size:", subjectsById.size);

  const sample = Array.from(templateById.values()).slice(0, 25);

  const rows = sample.map((e: any) => {
    const sid = subjectIdForTemplateEvent(e);
    return {
      title: e.title,
      code: e.code,
      room: e.room ?? e.location ?? "",
      subjectIdForTemplateEvent: sid,
      subjectExists: subjectsById.has(sid),
      subjectColor: subjectsById.get(sid)?.color ?? null,
    };
  });

  console.table(rows);
}, [userId, templateById, subjectsById]);

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
        <div className="muted">Choose a subject/duty/break for each slot. “Use template” removes the override.</div>
      </div>

      {!hasTemplate ? (
        <div className="card">
          <div>
            <strong>No template loaded.</strong>
          </div>
          <div className="muted">
            You can still build your fortnight using overrides below. Importing an ICS just pre-fills defaults.
          </div>
        </div>
      ) : null}

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
                  const override = placementsByKey.get(k);
                  const base = baseCell.get(k);

                  const baseSubjectId = base && "e" in base && base.e ? subjectIdForTemplateEvent(base.e) : null;
                  const baseSubject = baseSubjectId ? subjectsById.get(baseSubjectId) : undefined;

                  const overrideSubjectId =
                    override && Object.prototype.hasOwnProperty.call(override, "subjectId") ? override.subjectId : undefined;
                  const overrideSubject =
                    typeof overrideSubjectId === "string" ? subjectsById.get(overrideSubjectId) : undefined;

                  const bg =
                    overrideSubjectId === null
                      ? "#0f0f0f"
                      : overrideSubject?.color ?? baseSubject?.color ?? "#0f0f0f";

                  const textColour = contrastTextColour(bg);
                  const mutedColour = rgbaFromHex(textColour, 0.75);

                  const selectValue =
                    overrideSubjectId === undefined
                      ? ""
                      : overrideSubjectId === null
                      ? "__blank__"
                      : overrideSubjectId;

                  const labelText =
                    overrideSubjectId === null
                      ? "Blank"
                      : overrideSubject
                      ? overrideSubject.title
                      : base?.kind === "free"
                      ? "Free"
                      : base?.kind === "manual"
                      ? base.a.manualTitle
                      : base && "e" in base && base.e
                      ? base.e.title
                      : "—";

                  const subText =
                    overrideSubjectId === undefined
                      ? "Using template"
                      : overrideSubjectId === null
                      ? "Override: blank"
                      : "Override";

                  const roomOverride =
                    override && Object.prototype.hasOwnProperty.call(override, "roomOverride") ? override.roomOverride : undefined;
                  const baseRoom = base && "e" in base && base.e ? base.e.room ?? "" : "";
                  const resolvedRoom = roomOverride === undefined ? baseRoom : roomOverride === null ? "" : roomOverride;

                  return (
                    <td key={k} style={{ verticalAlign: "top" }}>
                      <div className="card" style={{ background: bg, color: textColour, minHeight: 88 }}>
                        <div>
                          <strong>{labelText}</strong>
                        </div>
                        <div className="muted" style={{ marginTop: 4, color: mutedColour }}>
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
                                {s.title}
                                {s.code ? ` (${s.code})` : ""}
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

                        <div className="space" />
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <input
                            defaultValue={roomOverride === undefined ? "" : roomOverride ?? ""}
                            placeholder={baseRoom ? `Room (template: ${baseRoom})` : "Room"}
                            onBlur={(e) => onRoomBlur(dl, row.id, e.target.value)}
                            style={{ width: "100%" }}
                          />
                          <button onClick={() => clearRoomOverride(dl, row.id)} title="Use template room">
                            ↺
                          </button>
                          <button onClick={() => setBlankRoom(dl, row.id)} title="Blank room">
                            ☐
                          </button>
                        </div>

                        {resolvedRoom ? (
                          <div className="muted" style={{ marginTop: 4, color: mutedColour }}>
                            Room: {resolvedRoom}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}