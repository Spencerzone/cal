// src/pages/ImportPage.tsx
import { useMemo, useState } from "react";
import { importIcs } from "../ics/importIcs";

export default function ImportPage() {
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const accept = useMemo(() => ".ics,text/calendar", []);

  async function handleFile(file: File) {
    setBusy(true);
    setStatus("Reading…");
    try {
      const text = await file.text();
      setStatus("Importing…");
      const res = await importIcs(text, file.name);
      setStatus(`Imported ${res.count} events (import ${res.importId}).`);
    } catch (e: any) {
      setStatus(e?.message ?? "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <h1>Import iCal (.ics)</h1>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div>Upload a Sentral iCal export to refresh your timetable.</div>
            <div className="muted">User notes/metadata are preserved.</div>
          </div>
        </div>

        <div className="space" />
        <input
          className="input"
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.currentTarget.value = "";
          }}
        />

        <div className="space" />
        <div className="muted">{status}</div>
      </div>
    </div>
  );
}