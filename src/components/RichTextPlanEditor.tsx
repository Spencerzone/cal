import { useEffect, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import type { LessonAttachment, SlotId } from "../db/db";
import { addAttachmentToPlan, deleteAttachment, upsertLessonPlan } from "../db/lessonPlanQueries";

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, "").trim();
}

function planKeyForSlot(dateKey: string, slotId: SlotId) {
  return `${dateKey}::${slotId}`;
}

export default function RichTextPlanEditor(props: {
  userId: string;
  dateKey: string;
  slotId: SlotId;
  initialHtml: string;
  attachments: LessonAttachment[];
}) {
  const { userId, dateKey, slotId, initialHtml, attachments } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const [html, setHtml] = useState<string>(initialHtml);
  const [active, setActive] = useState<boolean>(false);

  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef<boolean>(false);
  const hydratedRef = useRef<boolean>(false);

  // Adopt DB/prop updates only when not editing (avoids cursor/focus loss).
  useEffect(() => {
    if (active || dirtyRef.current) return;
    setHtml(initialHtml);
  }, [initialHtml, active]);

  function scheduleSave(nextHtml: string) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      upsertLessonPlan(userId, dateKey, slotId, nextHtml);
    }, 600);
  }

  // Hydrate DOM once per open.
  useEffect(() => {
    if (!active) return;
    if (hydratedRef.current) return;
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html || "<p></p>";
    hydratedRef.current = true;
  }, [active]);

  function exec(cmd: string, value?: string) {
    dirtyRef.current = true;
    ref.current?.focus();
    // eslint-disable-next-line deprecation/deprecation
    document.execCommand(cmd, false, value);
    const next = ref.current?.innerHTML ?? "";
    setHtml(next);
    scheduleSave(next);
  }

  function toolbarMouseDown(e: RMouseEvent) {
    // Prevent toolbar clicks from stealing focus / collapsing selection.
    e.preventDefault();
  }

  function onInput() {
    dirtyRef.current = true;
    const next = ref.current?.innerHTML ?? "";
    setHtml(next);
    scheduleSave(next);
  }

  // Close editor when clicking outside.
  useEffect(() => {
    if (!active) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (wrapRef.current && wrapRef.current.contains(t)) return;
      dirtyRef.current = false;
      setActive(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [active]);

  async function onAddFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const planKey = planKeyForSlot(dateKey, slotId);

    // Ensure plan exists for attachment parent.
    if (!html.trim()) {
      await upsertLessonPlan(userId, dateKey, slotId, "<p></p>");
    }

    for (const f of Array.from(files)) {
      await addAttachmentToPlan(userId, planKey, f);
    }
  }

  const plain = stripHtml(html);

  return (
    <div ref={wrapRef} className="card" style={{ marginTop: 8, background: "#0b0b0b" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="badge">Lesson plan</span>
        {active ? <span className="muted">Auto-saves</span> : null}
      </div>

      {!active ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            hydratedRef.current = false;
            setActive(true);
            setTimeout(() => {
              if (ref.current) {
                ref.current.innerHTML = html || "<p></p>";
                ref.current.focus();
              }
            }, 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              hydratedRef.current = false;
              setActive(true);
              setTimeout(() => {
                if (ref.current) {
                  ref.current.innerHTML = html || "<p></p>";
                  ref.current.focus();
                }
              }, 0);
            }
          }}
          style={{
            marginTop: 8,
            width: "100%",
            boxSizing: "border-box",
            minHeight: 84,
            maxHeight: 140,
            overflow: "hidden",
            padding: 10,
            borderRadius: 12,
            background: "#0f0f0f",
            border: "1px solid rgba(255,255,255,0.08)",
            cursor: "text",
          }}
        >
          {html.trim() ? (
            <div
              style={{ color: "rgba(255,255,255,0.85)" }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="muted">Click to add a lesson plan…</div>
          )}
        </div>
      ) : null}

      {active ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={() => exec("bold")}>B</button>
            <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={() => exec("italic")}>I</button>
            <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={() => exec("underline")}>U</button>
            <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={() => exec("insertUnorderedList")}>• List</button>
            <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={() => exec("insertOrderedList")}>1. List</button>

            <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Text
              <input
                type="color"
                onChange={(e) => exec("foreColor", e.target.value)}
                style={{ width: 28, height: 18, padding: 0, border: 0, background: "transparent" }}
              />
            </label>

            <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Highlight
              <input
                type="color"
                onChange={(e) => exec("hiliteColor", e.target.value)}
                style={{ width: 28, height: 18, padding: 0, border: 0, background: "transparent" }}
              />
            </label>

            <button
              className="btn"
              type="button"
              onMouseDown={toolbarMouseDown}
              onClick={() => {
                const url = window.prompt("URL (https://...)");
                if (url) exec("createLink", url);
              }}
            >
              Link
            </button>

            <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Attach
              <input
                type="file"
                multiple
                onChange={(e) => {
                  onAddFiles(e.target.files);
                  e.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>

            <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={() => exec("removeFormat")}>Clear</button>

            <button
              className="btn"
              type="button"
              onMouseDown={toolbarMouseDown}
              onClick={() => {
                dirtyRef.current = false;
                setActive(false);
              }}
              style={{ marginLeft: "auto" }}
            >
              Done
            </button>
          </div>

          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            onInput={onInput}
            style={{
              marginTop: 8,
              width: "100%",
              boxSizing: "border-box",
              minHeight: 140,
              maxHeight: 320,
              overflowY: "auto",
              padding: 10,
              borderRadius: 12,
              background: "#0f0f0f",
              border: "1px solid rgba(255,255,255,0.08)",
              outline: "none",
            }}
          />

          {attachments.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <div className="muted" style={{ marginBottom: 6 }}>
                Attachments
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {attachments.map((a) => (
                  <div key={a.id} className="row" style={{ justifyContent: "space-between" }}>
                    <a
                      href={URL.createObjectURL(a.blob)}
                      download={a.name}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        const url = (e.currentTarget as HTMLAnchorElement).href;
                        setTimeout(() => URL.revokeObjectURL(url), 5_000);
                      }}
                    >
                      {a.name}
                    </a>
                    <button className="btn" type="button" onClick={() => deleteAttachment(a.id)}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div
          className="muted"
          style={{
            marginTop: 8,
            width: "100%",
            boxSizing: "border-box",
            padding: 10,
            borderRadius: 12,
            background: "#0f0f0f",
            border: "1px solid rgba(255,255,255,0.08)",
            cursor: "text",
            minHeight: 52,
            display: "flex",
            alignItems: "center",
          }}
          onClick={() => {
            hydratedRef.current = false;
            setActive(true);
            setTimeout(() => {
              if (ref.current) {
                ref.current.innerHTML = html || "<p></p>";
                ref.current.focus();
              }
            }, 0);
          }}
        >
          {plain ? (
            <span>
              {plain.slice(0, 140)}
              {plain.length > 140 ? "…" : ""}
            </span>
          ) : (
            <span>Add lesson plan…</span>
          )}
        </div>
      )}
    </div>
  );
}
