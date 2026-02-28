// src/pages/ImportPage.tsx
import { useEffect, useMemo, useState } from "react";
import { importIcs } from "../ics/importIcs";
import { getRollingSettings } from "../rolling/settings";
import { useAuth } from "../auth/AuthProvider";

export default function ImportPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [activeYear, setActiveYear] = useState<number>(
    new Date().getFullYear(),
  );

  const [status, setStatus] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("timetable.ics");
  const [mode, setMode] = useState<"replace" | "merge">("replace");
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmText, setConfirmText] = useState<string>("");

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const s = await getRollingSettings(userId);
      setActiveYear(s.activeYear ?? new Date().getFullYear());
    })();
    const on = () => {
      (async () => {
        const s = await getRollingSettings(userId);
        setActiveYear(s.activeYear ?? new Date().getFullYear());
      })();
    };
    window.addEventListener("rolling-settings-changed", on as any);
    return () =>
      window.removeEventListener("rolling-settings-changed", on as any);
  }, [userId]);

  const canImport = useMemo(
    () => !!userId && text.trim().length > 0,
    [userId, text],
  );

  async function onPickFile(file: File) {
    setFileName(file.name);
    const t = await file.text();
    setText(t);
  }

  async function onImport() {
    if (!canImport) return;
    if (mode === "replace" && !confirmOpen) {
      setConfirmOpen(true);
      setConfirmText("");
      return;
    }
    if (mode === "replace" && confirmText.trim() !== String(activeYear)) {
      setStatus(`Type ${activeYear} to confirm replacing the template.`);
      return;
    }
    setStatus("Importing…");
    try {
      const res = await importIcs(userId, activeYear, text, fileName, { mode });
      setStatus(`Imported ${res.count} events (importId ${res.importId}).`);
      setConfirmOpen(false);
      setConfirmText("");
    } catch (e: any) {
      setStatus(e?.message || String(e));
    }
  }

  return (
    <div className="grid">
      <h1>Import ICS</h1>

      <div className="card">
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <strong>Template year:</strong>{" "}
            <span className="badge">{activeYear}</span>
          </div>
          <div className="muted">This import affects only {activeYear}.</div>
        </div>
      </div>

      <div className="card">
        <div className="card" style={{ borderStyle: "dashed" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Import mode</div>

          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="radio"
              name="importMode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            <span>
              <strong>Replace template for {activeYear} (recommended)</strong>
            </span>
          </label>
          <div className="muted" style={{ marginLeft: 22 }}>
            Deletes existing template events for {activeYear} before importing.
            Prevents duplicates if the exporter changed UIDs.
          </div>

          <div className="space" />

          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input
              type="radio"
              name="importMode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
            />
            <span>
              <strong>Merge into existing template</strong>
            </span>
          </label>
          <div className="muted" style={{ marginLeft: 22 }}>
            Not recommended unless you know the ICS export is stable.
          </div>

          {mode === "replace" ? (
            <>
              <div className="space" />
              <div
                className="card"
                style={{ background: "rgba(255, 180, 0, 0.08)" }}
              >
                <div>
                  <strong>Replace warning</strong>
                </div>
                <div className="muted">
                  This will remove existing template events for{" "}
                  <strong>{activeYear}</strong> and rebuild the default matrix
                  for <strong>{activeYear}</strong>. Matrix overrides
                  (placements) are kept.
                </div>
              </div>
            </>
          ) : null}

          {confirmOpen && mode === "replace" ? (
            <>
              <div className="space" />
              <div
                className="card"
                style={{ background: "rgba(255, 80, 80, 0.06)" }}
              >
                <div style={{ fontWeight: 600 }}>Confirm replace</div>
                <div className="muted" style={{ marginTop: 6 }}>
                  Type <strong>{activeYear}</strong> to confirm replacing the
                  template for this year.
                </div>
                <div className="space" />
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={String(activeYear)}
                  style={{ width: 180 }}
                />
                <div className="space" />
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      setConfirmOpen(false);
                      setConfirmText("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn"
                    disabled={confirmText.trim() !== String(activeYear)}
                    onClick={() => void onImport()}
                  >
                    Replace and import ({activeYear})
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            type="file"
            accept=".ics,text/calendar"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />
          <button
            className="btn"
            disabled={!canImport}
            onClick={() => void onImport()}
          >
            Import
          </button>
        </div>

        <div className="space" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste ICS content here…"
          style={{ width: "100%", minHeight: 220 }}
        />
        <div className="space" />
        <div className="muted">{status}</div>
      </div>
    </div>
  );
}
