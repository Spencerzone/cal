// src/pages/ImportPage.tsx
import { useMemo, useState } from "react";
import { importIcs } from "../ics/importIcs";
import { getRollingSettings } from "../rolling/settings";
import { useAuth } from "../auth/AuthProvider";

export default function ImportPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [activeYear, setActiveYear] = useState<number>(new Date().getFullYear());

  const [status, setStatus] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("timetable.ics");

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const s = await getRollingSettings(userId);
      setActiveYear(s.activeYear ?? new Date().getFullYear());
    })();
    const on = () => { (async () => { const s = await getRollingSettings(userId); setActiveYear(s.activeYear ?? new Date().getFullYear()); })(); };
    window.addEventListener("rolling-settings-changed", on as any);
    return () => window.removeEventListener("rolling-settings-changed", on as any);
  }, [userId]);

  const canImport = useMemo(() => !!userId && text.trim().length > 0, [userId, text]);

  async function onPickFile(file: File) {
    setFileName(file.name);
    const t = await file.text();
    setText(t);
  }

  async function onImport() {
    if (!canImport) return;
    setStatus("Importing…");
    try {
      const res = await importIcs(userId, activeYear, text, fileName);
      setStatus(`Imported ${res.count} events (importId ${res.importId}).`);
    } catch (e: any) {
      setStatus(e?.message || String(e));
    }
  }

  return (
    <div className="grid">
      <h1>Import ICS</h1>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            type="file"
            accept=".ics,text/calendar"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickFile(f);
            }}
          />
          <button className="btn" disabled={!canImport} onClick={() => void onImport()}>
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
