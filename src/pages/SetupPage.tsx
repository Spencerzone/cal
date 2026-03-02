import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  getRollingSettings,
  setRollingSettings,
  type RollingSettings,
} from "../rolling/settings";
import { NavLink } from "react-router-dom";

/** Extract term starts/ends for a specific year from termYears array, falling back to flat fields. */
function termDatesForYear(s: RollingSettings, year: number) {
  const yc = (s.termYears ?? []).find((t) => t.year === year);
  const starts =
    yc?.starts ?? (year === (s.activeYear ?? year) ? (s.termStarts ?? {}) : {});
  const ends =
    yc?.ends ?? (year === (s.activeYear ?? year) ? (s.termEnds ?? {}) : {});
  return {
    t1s: (starts.t1 ?? "").trim(),
    t2s: (starts.t2 ?? "").trim(),
    t3s: (starts.t3 ?? "").trim(),
    t4s: (starts.t4 ?? "").trim(),
    t1e: (ends.t1 ?? "").trim(),
    t2e: (ends.t2 ?? "").trim(),
    t3e: (ends.t3 ?? "").trim(),
    t4e: (ends.t4 ?? "").trim(),
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
    };
    load();
    const onChange = () => load();
    window.addEventListener("rolling-settings-changed", onChange as any);
    return () => {
      alive = false;
      window.removeEventListener("rolling-settings-changed", onChange as any);
    };
  }, [userId]);

  // When the user picks a different year in the dropdown, reload term dates for that year
  // (without saving yet — blanks if no data exists for that year)
  function onYearChange(y: number) {
    setActiveYear(y);
    if (settings) applyTermDates(settings, y);
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
            gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <div className="muted">Term</div>
          <div className="muted">Start</div>
          <div className="muted">Finish</div>
          <div />

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
          <div />

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
          <div />

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
          <div />

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
          <div />
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
