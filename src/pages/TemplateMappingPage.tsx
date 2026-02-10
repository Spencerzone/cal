import { useEffect, useMemo, useState } from "react";
import { applyTemplateMapping, getTemplateMeta, mappingPreview } from "../rolling/templateMapping";

export default function TemplateMappingPage() {
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [shift, setShift] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [anchorMonday, setAnchorMonday] = useState<string>("");
  const [cycleDates, setCycleDates] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    (async () => {
      const meta = await getTemplateMeta();
      if (!meta) {
        setStatus("No template metadata found. Import ICS and rebuild the template first.");
        setMetaLoaded(true);
        return;
      }
      setShift(meta.shift);
      setFlipped(meta.flipped);
      setAnchorMonday(meta.anchorMonday);
      setCycleDates(meta.cycleDates);
      setMetaLoaded(true);
    })();
  }, []);

  const preview = useMemo(() => {
    if (!metaLoaded || cycleDates.length !== 10) return [];
    return mappingPreview({
      anchorMonday,
      cycleDates,
      shift,
      flipped,
      builtAt: Date.now(),
    });
  }, [metaLoaded, anchorMonday, cycleDates, shift, flipped]);

  async function apply() {
    setStatus("Applying…");
    try {
      await applyTemplateMapping(shift, flipped);
      setStatus("Applied. Matrix/Today/Week will now use this mapping.");
    } catch (e: any) {
      setStatus(e?.message ?? "Apply failed.");
    }
  }

  const canShow = metaLoaded && cycleDates.length === 10;

  return (
    <div className="grid">
      <h1>Cycle mapping review</h1>

      <div className="card">
        <div className="muted">
          Adjust the inferred MonA…FriB mapping used to build the template.
          Use <strong>Shift</strong> if days are offset; use <strong>Flip A/B</strong> if the school declares this term starts on B week.
        </div>
        <div className="space" />
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setShift((s) => (s + 9) % 10)} disabled={!canShow}>
            Shift -1
          </button>
          <div className="badge">Shift: {shift}</div>
          <button className="btn" onClick={() => setShift((s) => (s + 1) % 10)} disabled={!canShow}>
            Shift +1
          </button>

          <div style={{ width: 18 }} />

          <label className="row muted" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={flipped}
              onChange={(e) => setFlipped(e.target.checked)}
              disabled={!canShow}
            />
            Flip A/B
          </label>

          <div style={{ flex: 1 }} />

          <button className="btn" onClick={() => void apply()} disabled={!canShow}>
            Apply mapping
          </button>
        </div>

        <div className="space" />
        <div className="muted">{status}</div>
      </div>

      {!canShow ? (
        <div className="card">
          <div><strong>Template not ready.</strong></div>
          <div className="muted">Re-import the ICS and rebuild the template to generate a 10-day cycle.</div>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }} className="muted">Index</th>
                <th style={{ textAlign: "left" }} className="muted">Date</th>
                <th style={{ textAlign: "left" }} className="muted">Assigned label</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={row.date}>
                  <td className="muted">{i}</td>
                  <td><span className="badge">{row.date}</span></td>
                  <td><strong>{row.label}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space" />
          <div className="muted">
            Anchor Monday detected: <span className="badge">{anchorMonday}</span>
          </div>
        </div>
      )}
    </div>
  );
}