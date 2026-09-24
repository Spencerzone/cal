import { useEffect, useMemo, useState } from "react";
import { getRollingSettings, type RollingSettings } from "../rolling/settings";
import { nextTermStartAfter } from "../rolling/termWeek";
import { dayLabelsForSet } from "../db/templateQueries";
import { getAssignmentsForDayLabels } from "../db/assignmentQueries";
import { useAuth } from "../auth/AuthProvider";
import { getAllCycleTemplateEvents } from "../db/templateQueries";
import type {
  CycleTemplateEvent,
  DayLabel,
  SlotAssignment,
  SlotId,
  Subject,
} from "../db/db";
import { getSubjectsByUser } from "../db/subjectQueries";
import { subjectIdForTemplateEvent } from "../db/subjectUtils";

/** Returns "#000" or "#fff" depending on which contrasts better against `hex`. */
function contrastColor(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#fff";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Relative luminance (WCAG formula)
  const toLinear = (x: number) => {
    const s = x / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? "#000" : "#fff";
}

import {
  getResolvedPlacementsForDayLabels,
  addPlacementVersion,
} from "../db/placementQueries";

type SlotDef = { id: SlotId; label: string };

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function weekdayFromLabel(
  label: DayLabel,
): "Mon" | "Tue" | "Wed" | "Thu" | "Fri" {
  return label.slice(0, 3) as any;
}

export default function MatrixPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [activeYear, setActiveYear] = useState<number>(
    new Date().getFullYear(),
  );
  const [set, setSet] = useState<"A" | "B">("A");
  const labels = useMemo(() => dayLabelsForSet(set), [set]);
  const rows = useMemo(() => SLOT_DEFS, []);

  const [rollingSettings, setRollingSettingsState] =
    useState<RollingSettings | null>(null);

  // The date any edit made below takes effect from. Also doubles as "which
  // date's state is this grid showing" — defaults to today, so the grid and
  // its edits behave exactly as before unless changed.
  const [effectiveFrom, setEffectiveFrom] = useState<string>(todayKey());

  const nextTermQuickPick = useMemo(() => {
    if (!rollingSettings) return null;
    return nextTermStartAfter(todayKey(), rollingSettings);
  }, [rollingSettings]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      const s = await getRollingSettings(userId);
      if (cancelled) return;
      setRollingSettingsState(s);
      const y = (s as any)?.activeYear;
      if (typeof y === "number" && Number.isFinite(y)) setActiveYear(y);
    };
    load();
    const on = () => load();
    window.addEventListener("rolling-settings-changed", on as any);
    return () => {
      cancelled = true;
      window.removeEventListener("rolling-settings-changed", on as any);
    };
  }, [userId, activeYear]);

  const [templateById, setTemplateById] = useState<
    Map<string, CycleTemplateEvent>
  >(new Map());
  const [assignments, setAssignments] = useState<SlotAssignment[]>([]);

  const [subjectsById, setSubjectsById] = useState<Map<string, Subject>>(
    new Map(),
  );
  const [placementsByKey, setPlacementsByKey] = useState<
    Map<string, { subjectId?: string | null; roomOverride?: string | null }>
  >(new Map());

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const template = await getAllCycleTemplateEvents(userId, activeYear);
      setTemplateById(new Map(template.map((e) => [e.id, e])));
    })();
  }, [userId, activeYear]);

  async function loadSubjects() {
    const subs = await getSubjectsByUser(userId, activeYear);
    setSubjectsById(new Map(subs.map((s) => [s.id, s])));
  }

  async function loadPlacements() {
    const ps = await getResolvedPlacementsForDayLabels(
      userId,
      activeYear,
      labels,
      effectiveFrom,
    );
    const m = new Map<
      string,
      { subjectId?: string | null; roomOverride?: string | null }
    >();
    for (const p of ps) {
      const key = `${p.dayLabel}::${p.slotId}`;
      const o: { subjectId?: string | null; roomOverride?: string | null } = {};
      if (Object.prototype.hasOwnProperty.call(p, "subjectId"))
        o.subjectId = p.subjectId;
      if (Object.prototype.hasOwnProperty.call(p, "roomOverride"))
        o.roomOverride = p.roomOverride;
      m.set(key, o);
    }
    setPlacementsByKey(m);
  }

  useEffect(() => {
    if (!userId) return;
    loadSubjects();
    const onSubjects = () => loadSubjects();
    window.addEventListener("subjects-changed", onSubjects as any);
    return () =>
      window.removeEventListener("subjects-changed", onSubjects as any);
  }, [userId, activeYear]);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const a = await getAssignmentsForDayLabels(userId, activeYear, labels);
      setAssignments(a);
    })();
  }, [userId, activeYear, labels.join(",")]);

  useEffect(() => {
    if (!userId) return;
    loadPlacements();
    const onPlacements = () => loadPlacements();
    window.addEventListener("placements-changed", onPlacements as any);
    return () =>
      window.removeEventListener("placements-changed", onPlacements as any);
  }, [userId, activeYear, labels.join(","), effectiveFrom]);

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
      .filter(
        ([, v]) =>
          v && typeof v === "object" && "e" in (v as any) && (v as any).e,
      )
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
    if (value === "") {
      // "Use template" — remove subject override only; room override carries forward unchanged
      await addPlacementVersion(userId, activeYear, dl, slotId, {
        effectiveFrom,
        subjectId: undefined,
      });
      return;
    }
    if (value === "__blank__") {
      await addPlacementVersion(userId, activeYear, dl, slotId, {
        effectiveFrom,
        subjectId: null,
      });
      return;
    }
    await addPlacementVersion(userId, activeYear, dl, slotId, {
      effectiveFrom,
      subjectId: value,
    });
  }

  async function onRoomBlur(
    dl: DayLabel,
    slotId: SlotId,
    nextRoomText: string,
  ) {
    const trimmed = nextRoomText.trim();
    if (trimmed) {
      await addPlacementVersion(userId, activeYear, dl, slotId, {
        effectiveFrom,
        roomOverride: trimmed,
      });
    } else {
      await addPlacementVersion(userId, activeYear, dl, slotId, {
        effectiveFrom,
        roomOverride: undefined,
      });
    }
  }

  async function setBlankRoom(dl: DayLabel, slotId: SlotId) {
    await addPlacementVersion(userId, activeYear, dl, slotId, {
      effectiveFrom,
      roomOverride: null,
    });
  }

  async function clearRoomOverride(dl: DayLabel, slotId: SlotId) {
    // Remove roomOverride field entirely so the template room shows through.
    await addPlacementVersion(userId, activeYear, dl, slotId, {
      effectiveFrom,
      roomOverride: undefined,
    });
  }

  const [carryOpenKey, setCarryOpenKey] = useState<string | null>(null);
  const [carryFrom, setCarryFrom] = useState<string>("");
  const [carryTo, setCarryTo] = useState<string>("");

  function openCarryPanel(key: string) {
    const nextYear = activeYear + 1;
    const yc = (rollingSettings?.termYears ?? []).find(
      (t) => t.year === nextYear,
    );
    const t1Start = (yc?.starts?.t1 ?? "").trim();
    setCarryFrom(t1Start || `${nextYear}-01-01`);
    setCarryTo("");
    setCarryOpenKey(key);
  }

  async function carryToNextYear(
    dl: DayLabel,
    slotId: SlotId,
    subjectIdToCopy: string | null,
  ) {
    if (!carryFrom) return;
    await addPlacementVersion(userId, activeYear + 1, dl, slotId, {
      effectiveFrom: carryFrom,
      effectiveTo: carryTo.trim() ? carryTo.trim() : undefined,
      subjectId: subjectIdToCopy,
    });
    setCarryOpenKey(null);
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
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => setSet("A")}
            aria-pressed={set === "A"}
            style={set === "A" ? { backgroundColor: "var(--accent)", color: "var(--bg)" } : undefined}
          >
            Week A
          </button>
          <button
            className="btn"
            onClick={() => setSet("B")}
            aria-pressed={set === "B"}
            style={set === "B" ? { backgroundColor: "var(--accent)", color: "var(--bg)" } : undefined}
          >
            Week B
          </button>
        </div>

        <div className="space" />
        <div className="muted">
          Choose a subject/duty/break for each slot. “Use template” removes the
          override.
        </div>

        <div className="space" />
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="matrix-effective-from" className="muted">
            Effective from
          </label>
          <input
            id="matrix-effective-from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value || todayKey())}
          />
          <button className="btn" onClick={() => setEffectiveFrom(todayKey())}>
            Today
          </button>
          {nextTermQuickPick ? (
            <button
              className="btn"
              onClick={() => setEffectiveFrom(nextTermQuickPick)}
            >
              Start of next term ({nextTermQuickPick})
            </button>
          ) : null}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          Edits below take effect from this date onward — everything before it
          is kept as history.
        </div>
      </div>

      {!hasTemplate ? (
        <div className="card">
          <div>
            <strong>No template loaded.</strong>
          </div>
          <div className="muted">
            You can still build your fortnight using overrides below. Importing
            an ICS just pre-fills defaults.
          </div>
        </div>
      ) : null}

      <div className="card" style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: 8,
          }}
        >
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

                  const baseSubjectId =
                    base && "e" in base && base.e
                      ? subjectIdForTemplateEvent(base.e)
                      : null;
                  const baseSubject = baseSubjectId
                    ? subjectsById.get(baseSubjectId)
                    : undefined;

                  const overrideSubjectId =
                    override &&
                    Object.prototype.hasOwnProperty.call(override, "subjectId")
                      ? override.subjectId
                      : undefined;
                  const overrideSubject =
                    typeof overrideSubjectId === "string"
                      ? subjectsById.get(overrideSubjectId)
                      : undefined;

                  const bg =
                    overrideSubjectId === null
                      ? "#0f0f0f"
                      : (overrideSubject?.color ??
                        baseSubject?.color ??
                        "#0f0f0f");
                  const textColor = contrastColor(bg);
                  const mutedColor =
                    textColor === "#000"
                      ? "rgba(0,0,0,0.55)"
                      : "rgba(255,255,255,0.6)";

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
                    override &&
                    Object.prototype.hasOwnProperty.call(
                      override,
                      "roomOverride",
                    )
                      ? override.roomOverride
                      : undefined;
                  const baseRoom =
                    base && "e" in base && base.e ? (base.e.room ?? "") : "";
                  const resolvedRoom =
                    roomOverride === undefined
                      ? baseRoom
                      : roomOverride === null
                        ? ""
                        : roomOverride;

                  const effectiveSubjectId =
                    overrideSubjectId !== undefined
                      ? overrideSubjectId
                      : baseSubjectId;

                  return (
                    <td key={k} style={{ verticalAlign: "top" }}>
                      <div
                        className="card"
                        style={{
                          background: bg,
                          minHeight: 88,
                          color: textColor,
                        }}
                      >
                        <div>
                          <strong>{labelText}</strong>
                        </div>
                        <div style={{ marginTop: 4, color: mutedColor }}>
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
                        <div
                          className="row"
                          style={{ gap: 8, alignItems: "center" }}
                        >
                          <input
                            defaultValue={
                              roomOverride === undefined
                                ? ""
                                : (roomOverride ?? "")
                            }
                            placeholder={
                              baseRoom ? `Room (template: ${baseRoom})` : "Room"
                            }
                            onBlur={(e) =>
                              onRoomBlur(dl, row.id, e.target.value)
                            }
                            style={{ width: "100%" }}
                          />
                          <button
                            onClick={() => clearRoomOverride(dl, row.id)}
                            title="Use template room"
                          >
                            ↺
                          </button>
                          <button
                            onClick={() => setBlankRoom(dl, row.id)}
                            title="Blank room"
                          >
                            ☐
                          </button>
                        </div>

                        {resolvedRoom ? (
                          <div style={{ marginTop: 4, color: mutedColor }}>
                            Room: {resolvedRoom}
                          </div>
                        ) : null}

                        <div className="space" />
                        <button
                          onClick={() => openCarryPanel(k)}
                          title={`Copy this subject into the ${activeYear + 1} matrix`}
                        >
                          → {activeYear + 1}
                        </button>

                        {carryOpenKey === k ? (
                          <div
                            className="card"
                            style={{
                              marginTop: 6,
                              background: "var(--panel2, #1a1a1a)",
                              color: "var(--text, #fff)",
                            }}
                          >
                            <div className="muted">
                              Copy “{effectiveSubjectId
                                ? (subjectsById.get(effectiveSubjectId)?.title ?? "—")
                                : "Blank"}
                              ” into {activeYear + 1}
                            </div>
                            <div className="space" />
                            <div className="row" style={{ gap: 6, alignItems: "center" }}>
                              <label className="muted">From</label>
                              <input
                                type="date"
                                value={carryFrom}
                                onChange={(e) => setCarryFrom(e.target.value)}
                              />
                            </div>
                            <div
                              className="row"
                              style={{ gap: 6, alignItems: "center", marginTop: 4 }}
                            >
                              <label className="muted">To (optional)</label>
                              <input
                                type="date"
                                value={carryTo}
                                onChange={(e) => setCarryTo(e.target.value)}
                              />
                            </div>
                            <div className="space" />
                            <div className="row" style={{ gap: 6 }}>
                              <button
                                className="btn"
                                onClick={() =>
                                  carryToNextYear(dl, row.id, effectiveSubjectId)
                                }
                              >
                                Copy
                              </button>
                              <button onClick={() => setCarryOpenKey(null)}>
                                Cancel
                              </button>
                            </div>
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
