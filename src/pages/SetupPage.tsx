import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  getRollingSettings,
  setRollingSettings,
  type RollingSettings,
} from "../rolling/settings";
import { NavLink } from "react-router-dom";

export default function SetupPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [settings, setSettings] = useState<RollingSettings | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
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

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const s = await getRollingSettings(userId);
      setSettings(s);

      const years =
        (s.termYears && s.termYears.length ? s.termYears.map((y) => y.year) : [])
          .slice()
          .sort((a, b) => a - b);

      // Pick current year if available, else first configured year, else infer from legacy termStarts, else current year.
      const inferredYear = (() => {
        const any = s.termStarts?.t1 || s.termStarts?.t2 || s.termStarts?.t3 || s.termStarts?.t4;
        const y = any ? parseInt(String(any).slice(0, 4), 10) : NaN;
        return Number.isFinite(y) ? y : new Date().getFullYear();
      })();

      const initialYear =
        years.includes(new Date().getFullYear())
          ? new Date().getFullYear()
          : years.length
          ? years[0]!
          : inferredYear;

      setYear(initialYear);

      const ty =
        (s.termYears && s.termYears.find((y) => y.year === initialYear)) ?? null;

      const starts: any = ty?.starts ?? s.termStarts ?? {};
      const ends: any = ty?.ends ?? s.termEnds ?? {};
      const w1: any = ty?.week1Sets ?? s.termWeek1Sets ?? {};

      setT1s((starts.t1 ?? "").trim());
      setT2s((starts.t2 ?? "").trim());
      setT3s((starts.t3 ?? "").trim());
      setT4s((starts.t4 ?? "").trim());
      setT1e((ends.t1 ?? "").trim());
      setT2e((ends.t2 ?? "").trim());
      setT3e((ends.t3 ?? "").trim());
      setT4e((ends.t4 ?? "").trim());
      setT1w((w1.t1 ?? "A") as any);
      setT2w((w1.t2 ?? "A") as any);
      setT3w((w1.t3 ?? "A") as any);
      setT4w((w1.t4 ?? "A") as any);
    })();
  }, [userId]);

  useEffect(() => {
    if (!settings) return;
    const ty = settings.termYears?.find((y) => y.year === year) ?? null;
    const starts: any = ty?.starts ?? {};
    const ends: any = ty?.ends ?? {};
    const w1: any = ty?.week1Sets ?? {};

    setT1s((starts.t1 ?? "").trim());
    setT2s((starts.t2 ?? "").trim());
    setT3s((starts.t3 ?? "").trim());
    setT4s((starts.t4 ?? "").trim());
    setT1e((ends.t1 ?? "").trim());
    setT2e((ends.t2 ?? "").trim());
    setT3e((ends.t3 ?? "").trim());
    setT4e((ends.t4 ?? "").trim());
    setT1w((w1.t1 ?? "A") as any);
    setT2w((w1.t2 ?? "A") as any);
    setT3w((w1.t3 ?? "A") as any);
    setT4w((w1.t4 ?? "A") as any);
  }, [settings, year]);


  async function save() {
    if (!userId) return;
    const current = await getRollingSettings(userId);

    const nextTermYear = {
      year,
      starts: { t1: t1s.trim(), t2: t2s.trim(), t3: t3s.trim(), t4: t4s.trim() },
      ends: { t1: t1e.trim(), t2: t2e.trim(), t3: t3e.trim(), t4: t4e.trim() },
      week1Sets: { t1: t1w, t2: t2w, t3: t3w, t4: t4w },
    };

    const others = (current.termYears ?? []).filter((y) => y.year !== year);
    const termYears = [...others, nextTermYear].sort((a, b) => a.year - b.year);

    const next: RollingSettings = {
      ...current,
      termYears,
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
        <h2>NSW term dates</h2>
        <div className="muted" style={{ marginBottom: 10 }}>
          Used to display Term/Week and determine A/B weeks. Dates outside terms are treated as holidays.
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <div className="muted">Year</div>
          <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))}>
            {((settings?.termYears ?? [])
              .map((y) => y.year)
              .slice()
              .sort((a, b) => a - b)
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              )))}
            {((settings?.termYears ?? []).length === 0) ? (
              <option value={year}>{year}</option>
            ) : null}
          </select>
          <button
            className="btn"
            onClick={() => {
              const years = (settings?.termYears ?? []).map((y) => y.year);
              const nextYear = years.length ? Math.max(...years) + 1 : year + 1;
              setYear(nextYear);
              // ensure UI clears for new year
              setT1s(""); setT2s(""); setT3s(""); setT4s("");
              setT1e(""); setT2e(""); setT3e(""); setT4e("");
              setT1w("A"); setT2w("A"); setT3w("A"); setT4w("A");
            }}
            type="button"
          >
            + Add year
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(140px, 1fr))",
            gap: 10,
          }}
        >
          <div className="muted">Term</div>
          <div className="muted">Start</div>
          <div className="muted">Finish</div>
          <div className="muted">Week 1 set</div>
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
          <select value={t1w} onChange={(e) => setT1w(e.target.value as any)}>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
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
          <select value={t2w} onChange={(e) => setT2w(e.target.value as any)}>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
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
          <select value={t3w} onChange={(e) => setT3w(e.target.value as any)}>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
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
          <select value={t4w} onChange={(e) => setT4w(e.target.value as any)}>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
          <div />
        </div>

        <div
          className="row"
          style={{ marginTop: 12, justifyContent: "flex-end" }}
        >
          <button className="btn" type="button" onClick={save}>
            Save
          </button>
        </div>
      </div>

      {settings ? (
        <div className="card">
          <div className="badge">Current</div>
          <pre
            style={{ whiteSpace: "pre-wrap", marginTop: 8 }}
            className="muted"
          >
            {JSON.stringify(
              { termStarts: settings.termStarts, termEnds: settings.termEnds },
              null,
              2,
            )}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
