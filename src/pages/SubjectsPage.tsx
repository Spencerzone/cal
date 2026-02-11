// src/pages/SubjectsPage.tsx
import { useEffect, useMemo, useState } from "react";
import type { Subject, SubjectKind } from "../db/db";
import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
import { getSubjectsByUser, upsertSubject } from "../db/subjectQueries";

const userId = "local";

const KIND_LABEL: Record<SubjectKind, string> = {
  subject: "Subject",
  duty: "Duty",
  break: "Break",
};

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filter, setFilter] = useState<SubjectKind | "all">("all");
  const [q, setQ] = useState("");

  async function refresh() {
    await ensureSubjectsFromTemplates(userId);
    const all = await getSubjectsByUser(userId);
    setSubjects(all);
  }

  useEffect(() => {
    refresh();

    // Keep this page in sync with edits from elsewhere.
    const onChanged = () => refresh();
    window.addEventListener("subjects-changed", onChanged as any);
    return () => window.removeEventListener("subjects-changed", onChanged as any);
  }, []);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return subjects
      .filter((s) => (filter === "all" ? true : s.kind === filter))
      .filter((s) => (query ? (s.title || "").toLowerCase().includes(query) || (s.code || "").toLowerCase().includes(query) : true))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return (a.title || "").localeCompare(b.title || "");
      });
  }, [subjects, filter, q]);

  async function save(next: Subject) {
    await upsertSubject(next);
    setSubjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }

  return (
    <div className="grid">
      <h1>Subjects</h1>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="subject">Subjects</option>
            <option value="duty">Duties</option>
            <option value="break">Breaks</option>
          </select>

          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ minWidth: 220 }} />

          <button onClick={refresh}>Refresh</button>
        </div>

        <div className="muted" style={{ marginTop: 8 }}>
          Renaming/recolouring updates the subject everywhere it appears.
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", width: 110 }} className="muted">
                Colour
              </th>
              <th style={{ textAlign: "left" }} className="muted">
                Name
              </th>
              <th style={{ textAlign: "left", width: 160 }} className="muted">
                Code
              </th>
              <th style={{ textAlign: "left", width: 120 }} className="muted">
                Kind
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id}>
                <td style={{ verticalAlign: "top" }}>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: s.color || "#0f0f0f",
                        border: "1px solid rgba(255,255,255,0.15)",
                      }}
                      title={s.color}
                    />
                    <input
                      type="color"
                      value={normaliseToHex(s.color) ?? "#3b82f6"}
                      onChange={(e) => save({ ...s, color: e.target.value })}
                      aria-label="Pick colour"
                      style={{ width: 42, height: 32 }}
                    />
                  </div>
                </td>

                <td style={{ verticalAlign: "top" }}>
                  <input
                    defaultValue={s.title}
                    onBlur={(e) => {
                      const nextTitle = e.target.value.trim();
                      if (!nextTitle || nextTitle === s.title) return;
                      save({ ...s, title: nextTitle });
                    }}
                    style={{ minWidth: 260 }}
                  />
                </td>

                <td style={{ verticalAlign: "top" }} className="muted">
                  {s.code ?? "—"}
                </td>

                <td style={{ verticalAlign: "top" }} className="muted">
                  {KIND_LABEL[s.kind]}
                </td>
              </tr>
            ))}

            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No subjects found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function normaliseToHex(color: string | undefined): string | null {
  if (!color) return null;
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) return color;
  return null;
}
