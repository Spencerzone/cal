// src/pages/SubjectsPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { Subject, SubjectKind } from "../db/db";
import { ensureSubjectsFromTemplates } from "../db/seedSubjects";
import { deleteSubject, getSubjectsByUser, upsertSubject } from "../db/subjectQueries";
import { subjectIdForManual, autoHexColorForKey } from "../db/subjectUtils";


const KIND_LABEL: Record<SubjectKind, string> = {
  subject: "Subject",
  duty: "Duty",
  break: "Break",
  other: "Other",
};

export default function SubjectsPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [filter, setFilter] = useState<SubjectKind | "all">("all");
  const [q, setQ] = useState("");

  const [newKind, setNewKind] = useState<SubjectKind>("subject");
  const [newCode, setNewCode] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState("#3b82f6");

  async function refresh() {
    await ensureSubjectsFromTemplates(userId);
    const all = await getSubjectsByUser(userId);
    setSubjects(all);
  }

  useEffect(() => {
    refresh();
    const onChanged = () => refresh();
    window.addEventListener("subjects-changed", onChanged as any);
    return () => window.removeEventListener("subjects-changed", onChanged as any);
  }, []);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return subjects
      .filter((s) => (filter === "all" ? true : s.kind === filter))
      .filter((s) =>
        query
          ? (s.title || "").toLowerCase().includes(query) || (s.code || "").toLowerCase().includes(query)
          : true
      )
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return (a.title || "").localeCompare(b.title || "");
      });
  }, [subjects, filter, q]);

  async function save(next: Subject) {
    await upsertSubject(next);
    setSubjects((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }

  async function addNew() {
    const title = newTitle.trim();
    const code = newKind === "subject" ? newCode.trim() : "";
    if (!title) return;

    const id = subjectIdForManual(newKind, code ? code : null, title);
    const next: Subject = {
      id,
      userId,
      kind: newKind,
      code: newKind === "subject" && code ? code.toUpperCase() : null,
      title,
      color: normaliseToHex(newColor) ?? autoHexColorForKey(id),
    };

    await upsertSubject(next);
    await refresh();
    setNewTitle("");
    setNewCode("");
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

        <div className="space" />

        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong className="muted">Add</strong>

          <select value={newKind} onChange={(e) => setNewKind(e.target.value as any)}>
            <option value="subject">Subject</option>
            <option value="duty">Duty</option>
            <option value="break">Break</option>
          </select>

          {newKind === "subject" ? (
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="Code (e.g. 11INV01)"
              style={{ minWidth: 180 }}
            />
          ) : null}

          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={newKind === "duty" ? "Duty name (e.g. Oval North)" : "Name"}
            style={{ minWidth: 260 }}
          />

          <input type="color" value={normaliseToHex(newColor) ?? "#3b82f6"} onChange={(e) => setNewColor(e.target.value)} />
          <button onClick={addNew}>Add</button>
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
              <th style={{ textAlign: "left", width: 120 }} className="muted">Kind</th>
              <th style={{ textAlign: "left", width: 120 }} className="muted">Actions</th>
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

                <td style={{ verticalAlign: "top" }} className="muted">{KIND_LABEL[s.kind]}</td>

                <td style={{ verticalAlign: "top" }}>
                  <button
                    onClick={async () => {
                      const ok = window.confirm(`Delete “${s.title}”? This removes it from Subjects and clears any matrix overrides that use it.`);
                      if (!ok) return;
                      await deleteSubject(userId, s.id);
                      await refresh();
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}

            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
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
