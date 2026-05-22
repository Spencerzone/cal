import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  getRollingSettings,
  setRollingSettings,
  type RollingSettings,
} from "../rolling/settings";
import { NavLink } from "react-router-dom";
import { getAllCycleTemplateEvents } from "../db/templateQueries";
import { slotForEvent } from "../rolling/buildSlotAssignments";
import { SLOT_DEFS, type SlotId } from "../rolling/slots";
import type { CycleTemplateEvent } from "../db/db";

/** Extract term starts/ends for a specific year from termYears array, falling back to flat fields. */
function termDatesForYear(s: RollingSettings, year: number) {
  const yc = (s.termYears ?? []).find((t) => t.year === year);
  const starts =
    yc?.starts ?? (year === (s.activeYear ?? year) ? (s.termStarts ?? {}) : {});
  const ends =
    yc?.ends ?? (year === (s.activeYear ?? year) ? (s.termEnds ?? {}) : {});
  const w1 =
    yc?.week1Sets ??
    (year === (s.activeYear ?? year) ? (s.termWeek1Sets ?? {}) : {});
  return {
    t1s: (starts.t1 ?? "").trim(),
    t2s: (starts.t2 ?? "").trim(),
    t3s: (starts.t3 ?? "").trim(),
    t4s: (starts.t4 ?? "").trim(),
    t1e: (ends.t1 ?? "").trim(),
    t2e: (ends.t2 ?? "").trim(),
    t3e: (ends.t3 ?? "").trim(),
    t4e: (ends.t4 ?? "").trim(),
    t1w: (w1.t1 ?? "A") as "A" | "B",
    t2w: (w1.t2 ?? "A") as "A" | "B",
    t3w: (w1.t3 ?? "A") as "A" | "B",
    t4w: (w1.t4 ?? "A") as "A" | "B",
  };
}

export default function SetupPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [activeYear, setActiveYear] = useState<number>(
    new Date().getFullYear(),
  );
  const [settings, setSettings] = useState<RollingSettings | null>(null);
  const [t1s, setT1s] = useState("");
  const [t1e, setT1e] = useState("");
  const [t2s, setT2s] = useState("");
  const [t2e, setT2e] = useState("");
  const [t3s, setT3s] = useState("");
  const [t3e, setT3e] = useState("");
  const [t4s, setT4s] = useState("");
  const [t4e, setT4e] = useState("");
  const [t1w, setT1w] = useState<"A" | "B">("A");
  const [t2w, setT2w] = useState<"A" | "B">("A");
  const [t3w, setT3w] = useState<"A" | "B">("A");
  const [t4w, setT4w] = useState<"A" | "B">("A");

  const [templateEvents, setTemplateEvents] = useState<CycleTemplateEvent[]>([]);
  // weekday → slotId → { start: "HH:MM", end: "HH:MM" }
  const [slotTimingInputs, setSlotTimingInputs] = useState<
    Partial<Record<string, Partial<Record<SlotId, { start: string; end: string }>>>>
  >({});
  const [slotTimingsSaved, setSlotTimingsSaved] = useState(false);

  function minutesToHHMM(m: number): string {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  function applySlotTimings(s: RollingSettings) {
    const st = s.slotTimings ?? {};
    const inputs: Partial<Record<string, Partial<Record<SlotId, { start: string; end: string }>>>> = {};
    for (const [weekday, slots] of Object.entries(st)) {
      if (!slots) continue;
      inputs[weekday] = {};
      for (const { id } of SLOT_DEFS) {
        const t = (slots as any)[id];
        if (t) inputs[weekday]![id] = { start: minutesToHHMM(t.startMinutes), end: minutesToHHMM(t.endMinutes) };
      }
    }
    setSlotTimingInputs(inputs);
  }

  function applyTermDates(s: RollingSettings, year: number) {
    const d = termDatesForYear(s, year);
    setT1s(d.t1s);
    setT2s(d.t2s);
    setT3s(d.t3s);
    setT4s(d.t4s);
    setT1e(d.t1e);
    setT2e(d.t2e);
    setT3e(d.t3e);
    setT4e(d.t4e);
    setT1w(d.t1w);
    setT2w(d.t2w);
    setT3w(d.t3w);
    setT4w(d.t4w);
  }

  // Load settings once; also re-load when changed externally
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const s = await getRollingSettings(userId);
      if (!alive) return;
      const year = s.activeYear ?? new Date().getFullYear();
      setSettings(s);
      setActiveYear(year);
      applyTermDates(s, year);
      applySlotTimings(s);
      getAllCycleTemplateEvents(userId, year).then((evts) => {
        if (alive) setTemplateEvents(evts);
      });
    };
    load();
    const onChange = () => load();
    window.addEventListener("rolling-settings-changed", onChange as any);
    return () => {
      alive = false;
      window.removeEventListener("rolling-settings-changed", onChange as any);
    };
  }, [userId]);

  // Reload template events when activeYear changes
  useEffect(() => {
    if (!userId) return;
    getAllCycleTemplateEvents(userId, activeYear).then(setTemplateEvents);
  }, [userId, activeYear]);

  // When the user picks a different year in the dropdown, reload term dates for that year
  // (without saving yet — blanks if no data exists for that year)
  function onYearChange(y: number) {
    setActiveYear(y);
    if (settings) applyTermDates(settings, y);
  }

  async function saveSlotTimings() {
    if (!userId) return;
    const current = await getRollingSettings(userId);
    const timings: Record<string, Partial<Record<SlotId, { startMinutes: number; endMinutes: number }>>> = {};
    for (const [weekday, slots] of Object.entries(slotTimingInputs)) {
      if (!slots) continue;
      timings[weekday] = {};
      for (const { id } of SLOT_DEFS) {
        const t = slots[id];
        if (t?.start && t?.end) {
          const [sh, sm] = t.start.split(":").map(Number);
          const [eh, em] = t.end.split(":").map(Number);
          if (Number.isFinite(sh) && Number.isFinite(sm) && Number.isFinite(eh) && Number.isFinite(em))
            timings[weekday][id] = { startMinutes: sh * 60 + sm, endMinutes: eh * 60 + em };
        }
      }
    }
    await setRollingSettings(userId, { ...current, slotTimings: timings });
    setSlotTimingsSaved(true);
    setTimeout(() => setSlotTimingsSaved(false), 2000);
  }

  async function save() {
    if (!userId) return;
    const current = (await getRollingSettings(userId)) as any;

    // Upsert this year into termYears array
    const existing: any[] = current.termYears ?? [];
    const idx = existing.findIndex((t: any) => t.year === activeYear);
    const yearEntry = {
      year: activeYear,
      starts: {
        t1: t1s.trim(),
        t2: t2s.trim(),
        t3: t3s.trim(),
        t4: t4s.trim(),
      },
      ends: { t1: t1e.trim(), t2: t2e.trim(), t3: t3e.trim(), t4: t4e.trim() },
      week1Sets: { t1: t1w, t2: t2w, t3: t3w, t4: t4w },
    };
    const nextTermYears =
      idx >= 0
        ? existing.map((t: any, i: number) => (i === idx ? yearEntry : t))
        : [...existing, yearEntry];

    const next: RollingSettings = {
      ...current,
      activeYear,
      termYears: nextTermYears,
      // Also keep flat fields in sync for the active year (backwards compat)
      termStarts: yearEntry.starts,
      termEnds: yearEntry.ends,
      termWeek1Sets: yearEntry.week1Sets,
    };
    await setRollingSettings(userId, next);
    setSettings(next);
  }

  return (
    <div className="grid">
      <h1>Setup</h1>

      <div className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", flexWrap: "wrap" }}
        >
          <div>
            <div className="badge">Optional</div>
            <div style={{ marginTop: 6 }} className="muted">
              Importing an ICS file can pre-fill the fortnight. You can also
              build everything manually using Subjects + Matrix.
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <NavLink to="/import" className="btn">
              Import ICS
            </NavLink>
            <NavLink to="/subjects" className="btn">
              Add subjects
            </NavLink>
            <NavLink to="/matrix" className="btn">
              Edit matrix
            </NavLink>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Active year</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Changing this switches your subjects, timetable template, matrix
          overrides, and lesson plans to a different year.
        </div>

        <div
          className="row"
          style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}
        >
          <select
            value={activeYear}
            onChange={async (e) => {
              const y = parseInt(e.target.value, 10);
              if (!Number.isFinite(y)) return;
              onYearChange(y);
              // Save the active year immediately so all other pages switch over
              await setRollingSettings(userId, {
                ...(settings ?? ({} as any)),
                activeYear: y,
              } as any);
            }}
          >
            {Array.from(
              { length: 7 },
              (_, i) => new Date().getFullYear() - 3 + i,
            ).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <div className="muted">Applies globally</div>
        </div>
      </div>

      <div className="card">
        <h2>NSW term dates — {activeYear}</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Used to display Term/Week in Today and Week. Leave blank to hide.
          Dates are saved per year.
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "auto minmax(140px,1fr) minmax(140px,1fr) 80px",
            gap: 10,
          }}
        >
          <div className="muted">Term</div>
          <div className="muted">Start</div>
          <div className="muted">Finish</div>
          <div className="muted">Week 1</div>

          <div>Term 1</div>
          <input
            type="date"
            value={t1s}
            onChange={(e) => setT1s(e.target.value)}
          />
          <input
            type="date"
            value={t1e}
            onChange={(e) => setT1e(e.target.value)}
          />
          <select
            value={t1w}
            onChange={(e) => setT1w(e.target.value as "A" | "B")}
          >
            <option value="A">Week A</option>
            <option value="B">Week B</option>
          </select>

          <div>Term 2</div>
          <input
            type="date"
            value={t2s}
            onChange={(e) => setT2s(e.target.value)}
          />
          <input
            type="date"
            value={t2e}
            onChange={(e) => setT2e(e.target.value)}
          />
          <select
            value={t2w}
            onChange={(e) => setT2w(e.target.value as "A" | "B")}
          >
            <option value="A">Week A</option>
            <option value="B">Week B</option>
          </select>

          <div>Term 3</div>
          <input
            type="date"
            value={t3s}
            onChange={(e) => setT3s(e.target.value)}
          />
          <input
            type="date"
            value={t3e}
            onChange={(e) => setT3e(e.target.value)}
          />
          <select
            value={t3w}
            onChange={(e) => setT3w(e.target.value as "A" | "B")}
          >
            <option value="A">Week A</option>
            <option value="B">Week B</option>
          </select>

          <div>Term 4</div>
          <input
            type="date"
            value={t4s}
            onChange={(e) => setT4s(e.target.value)}
          />
          <input
            type="date"
            value={t4e}
            onChange={(e) => setT4e(e.target.value)}
          />
          <select
            value={t4w}
            onChange={(e) => setT4w(e.target.value as "A" | "B")}
          >
            <option value="A">Week A</option>
            <option value="B">Week B</option>
          </select>
        </div>

        <div
          className="row"
          style={{ marginTop: 12, justifyContent: "flex-end" }}
        >
          <button className="btn" type="button" onClick={save}>
            Save term dates for {activeYear}
          </button>
        </div>
      </div>

      <SlotTimingsCard
        templateEvents={templateEvents}
        slotTimingInputs={slotTimingInputs}
        onSlotChange={(weekday, id, field, v) =>
          setSlotTimingInputs((prev) => ({
            ...prev,
            [weekday]: {
              ...(prev[weekday] ?? {}),
              [id]: { ...(prev[weekday]?.[id] ?? { start: "", end: "" }), [field]: v },
            },
          }))
        }
        onSave={saveSlotTimings}
        saved={slotTimingsSaved}
      />

      {settings ? (
        <div className="card">
          <div className="badge">Stored term years</div>
          <pre
            style={{ whiteSpace: "pre-wrap", marginTop: 8 }}
            className="muted"
          >
            {JSON.stringify(settings.termYears ?? [], null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

// ─── Sub-component ──────────────────────────────────────────────────────────

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

function SlotTimingsCard({
  templateEvents,
  slotTimingInputs,
  onSlotChange,
  onSave,
  saved,
}: {
  templateEvents: CycleTemplateEvent[];
  slotTimingInputs: Partial<Record<string, Partial<Record<SlotId, { start: string; end: string }>>>> ;
  onSlotChange: (weekday: string, id: SlotId, field: "start" | "end", v: string) => void;
  onSave: () => void;
  saved: boolean;
}) {
  const [selectedWeekday, setSelectedWeekday] = useState<string>("Mon");

  // ICS-detected timing for the selected weekday (MonA + MonB both contribute)
  const icsTimingBySlot = useMemo(() => {
    const m = new Map<SlotId, CycleTemplateEvent>();
    for (const e of templateEvents) {
      if (!e.dayLabel.startsWith(selectedWeekday)) continue;
      const sid = slotForEvent(e.periodCode, e.title);
      if (!sid) continue;
      const existing = m.get(sid);
      if (!existing) { m.set(sid, e); continue; }
      const rank = (ev: CycleTemplateEvent) => ev.type === "class" ? 0 : ev.type === "duty" ? 1 : 2;
      if (rank(e) < rank(existing) || (rank(e) === rank(existing) && e.startMinutes < existing.startMinutes))
        m.set(sid, e);
    }
    return m;
  }, [templateEvents, selectedWeekday]);

  // Events with no slot mapping (period code unrecognised) — shown once, not per-day
  const unmapped = useMemo(() => {
    const byCode = new Map<string, { titles: Set<string>; dayLabels: Set<string> }>();
    for (const e of templateEvents) {
      if (slotForEvent(e.periodCode, e.title) !== null) continue;
      const key = e.periodCode?.trim() || "(no period code)";
      if (!byCode.has(key)) byCode.set(key, { titles: new Set(), dayLabels: new Set() });
      byCode.get(key)!.titles.add(e.title);
      byCode.get(key)!.dayLabels.add(e.dayLabel);
    }
    return Array.from(byCode.entries()).map(([code, { titles, dayLabels }]) => ({
      code,
      example: [...titles][0] ?? "",
      dayLabelCount: dayLabels.size,
    }));
  }, [templateEvents]);

  function fmtMinutes(m: number): string {
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}:${String(min).padStart(2, "0")}`;
  }

  const currentInputs = slotTimingInputs[selectedWeekday] ?? {};

  return (
    <>
      <div className="card">
        <h2>Slot timings</h2>
        <div className="muted" style={{ marginBottom: 12 }}>
          Times detected from your ICS import are shown read-only. Enter manual
          times for slots not covered by the ICS (e.g. "Before school").
          Manual times are a fallback — ICS times take priority.
        </div>

        <div className="row" style={{ gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          {WEEKDAYS.map((wd) => (
            <button
              key={wd}
              type="button"
              className="btn"
              onClick={() => setSelectedWeekday(wd)}
              style={{
                opacity: selectedWeekday === wd ? 1 : 0.45,
                fontWeight: selectedWeekday === wd ? 600 : 400,
              }}
            >
              {wd}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(110px, auto) auto 1fr 1fr",
            gap: "6px 10px",
            alignItems: "center",
          }}
        >
          <div className="muted" style={{ fontSize: "0.8em" }}>Slot</div>
          <div className="muted" style={{ fontSize: "0.8em" }}>ICS detected</div>
          <div className="muted" style={{ fontSize: "0.8em" }}>Override start</div>
          <div className="muted" style={{ fontSize: "0.8em" }}>Override end</div>

          {SLOT_DEFS.map(({ id, label }) => {
            const ics = icsTimingBySlot.get(id);
            const inp = currentInputs[id];
            const hasOverride = !!(inp?.start || inp?.end);
            const missing = !ics && !hasOverride;
            return (
              <div key={id} style={{ display: "contents" }}>
                <div style={{ fontSize: "0.9em" }}>{label}</div>
                <div>
                  {ics ? (
                    <span
                      className="badge"
                      style={{ background: "rgba(34,197,94,0.15)", color: "var(--text)", fontFamily: "monospace", fontSize: "0.8em" }}
                    >
                      {fmtMinutes(ics.startMinutes)}–{fmtMinutes(ics.endMinutes)}
                    </span>
                  ) : (
                    <span
                      className="badge"
                      style={{ background: missing ? "rgba(234,179,8,0.18)" : "rgba(100,100,100,0.12)", color: "var(--muted)", fontSize: "0.75em" }}
                    >
                      {missing ? "⚠ Not in ICS" : "Not in ICS"}
                    </span>
                  )}
                </div>
                <input
                  type="time"
                  value={inp?.start ?? ""}
                  onChange={(e) => onSlotChange(selectedWeekday, id, "start", e.target.value)}
                  style={{ fontSize: "0.85em" }}
                />
                <input
                  type="time"
                  value={inp?.end ?? ""}
                  onChange={(e) => onSlotChange(selectedWeekday, id, "end", e.target.value)}
                  style={{ fontSize: "0.85em" }}
                />
              </div>
            );
          })}
        </div>

        <div className="row" style={{ marginTop: 14, justifyContent: "flex-end", gap: 10 }}>
          {saved && <span className="muted" style={{ fontSize: "0.85em" }}>Saved ✓</span>}
          <button className="btn" type="button" onClick={onSave}>
            Save slot timings
          </button>
        </div>
      </div>

      <div className="card">
        <details>
          <summary style={{ cursor: "pointer", userSelect: "none" }}>
            <strong>Unmapped ICS events</strong>
            {unmapped.length === 0 ? (
              <span className="muted" style={{ marginLeft: 10, fontSize: "0.85em" }}>
                — All ICS events mapped to slots ✓
              </span>
            ) : (
              <span
                className="badge"
                style={{ marginLeft: 10, background: "rgba(234,179,8,0.18)", color: "var(--text)", fontSize: "0.78em" }}
              >
                {unmapped.length} unrecognised period code{unmapped.length !== 1 ? "s" : ""}
              </span>
            )}
          </summary>
          {unmapped.length === 0 ? null : (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontSize: "0.82em", marginBottom: 8 }}>
                These ICS events could not be matched to a canonical slot because their
                period code is not recognised. They are excluded from the timetable.
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: "5px 12px",
                  alignItems: "baseline",
                }}
              >
                <div className="muted" style={{ fontSize: "0.78em" }}>Period code</div>
                <div className="muted" style={{ fontSize: "0.78em" }}>Example title</div>
                <div className="muted" style={{ fontSize: "0.78em" }}>Days affected</div>
                {unmapped.map(({ code, example, dayLabelCount }) => (
                  <div key={code} style={{ display: "contents" }}>
                    <code style={{ fontSize: "0.85em" }}>{code}</code>
                    <span style={{ fontSize: "0.85em", color: "var(--muted)" }}>{example}</span>
                    <span style={{ fontSize: "0.85em", color: "var(--muted)" }}>{dayLabelCount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </details>
      </div>
    </>
  );
}
