import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import type { LessonAttachment, SlotId } from "../db/db";
import { addUrlAttachmentToPlan, deleteAttachment, updateUrlAttachment, upsertLessonPlan } from "../db/lessonPlanQueries";

export default function RichTextPlanEditor(props: {
  userId: string;
  dateKey: string;
  slotId: SlotId;
  initialHtml: string;
  attachments: LessonAttachment[];
  palette?: string[];
}) {
  const { userId, dateKey, slotId, initialHtml, attachments, palette = [] } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const [openPicker, setOpenPicker] = useState<null | "text" | "highlight">(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const customTextRef = useRef<HTMLInputElement | null>(null);
  const customHiRef = useRef<HTMLInputElement | null>(null);

  const [html, setHtml] = useState<string>(initialHtml);
  const [active, setActive] = useState<boolean>(false);

  const [urlForm, setUrlForm] = useState<null | { mode: "add" | "edit"; id?: string; name: string; url: string }>(
    null
  );

  const saveTimer = useRef<number | null>(null);
  const dirtyRef = useRef<boolean>(false);
  const hydratedRef = useRef<boolean>(false);

  // Adopt DB/prop updates only when not editing (avoids cursor/focus loss).
  useEffect(() => {
    if (active || dirtyRef.current) return;
    setHtml(initialHtml);
  }, [initialHtml, active]);

  function isHtmlEffectivelyEmpty(raw: string): boolean {
    const s = (raw ?? "").trim();
    if (!s) return true;
    const text = s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?p[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim();
    return text.length === 0;
  }

  function normaliseForDb(raw: string): string {
    return isHtmlEffectivelyEmpty(raw) ? "" : raw;
  }

  function scheduleSave(nextHtml: string) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      upsertLessonPlan(userId, dateKey, slotId, normaliseForDb(nextHtml));
    }, 600);
  }

  // Hydrate DOM once per open.
  useEffect(() => {
    if (!active) return;
    if (hydratedRef.current) return;
    const el = ref.current;
    if (!el) return;

    // eslint-disable-next-line deprecation/deprecation
    document.execCommand("defaultParagraphSeparator", false, "p");

    el.innerHTML = html || "<p><br></p>";
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
    e.preventDefault();
  }

  // Close colour popover on any click that is not inside the popover itself.
  useEffect(() => {
    if (!openPicker) return;
    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      if (!t) return;
      if (popoverRef.current && popoverRef.current.contains(t)) return;
      setOpenPicker(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openPicker]);

  const swatches = useMemo(() => {
    const uniq = Array.from(new Set(palette.map((c) => (c || "").trim().toLowerCase()).filter(Boolean)));
    return uniq.slice(0, 24);
  }, [palette]);

  function onInput() {
    dirtyRef.current = true;
    const next = ref.current?.innerHTML ?? "";
    setHtml(next);
    scheduleSave(next);
  }

  function onEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl/Cmd shortcuts
    const isMod = e.ctrlKey || e.metaKey;
    if (isMod && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      exec("bold");
      return;
    }
    if (isMod && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      exec("italic");
      return;
    }
    if (isMod && (e.key === "u" || e.key === "U")) {
      e.preventDefault();
      exec("underline");
      return;
    }

    // List triggers: "* " / "- " / "1. " / "1) " at the start of a line
    if (e.key === " " && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const sel = window.getSelection();
      const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (r && r.collapsed) {
        // Find the current block element
        let node: Node | null = r.startContainer;
        if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        let block: HTMLElement | null = node as HTMLElement | null;
        while (block && block !== ref.current && !(block.tagName === "P" || block.tagName === "DIV" || block.tagName === "LI")) {
          block = block.parentElement;
        }
        if (block && block !== ref.current) {
          const text = block.innerText.replace(/\u00a0/g, " ");
          const uptoCaret = text.slice(0, Math.min(text.length, r.startOffset));
          const trimmed = uptoCaret.trimEnd();
          if (trimmed === "*" || trimmed === "-") {
            e.preventDefault();
            exec("insertUnorderedList");
            // remove the marker
            try {
              // eslint-disable-next-line deprecation/deprecation
              document.execCommand("undo");
              // eslint-disable-next-line deprecation/deprecation
              document.execCommand("insertUnorderedList");
            } catch {}
            return;
          }
          if (/^\d+[\.|\)]$/.test(trimmed)) {
            e.preventDefault();
            exec("insertOrderedList");
            try {
              // eslint-disable-next-line deprecation/deprecation
              document.execCommand("undo");
              // eslint-disable-next-line deprecation/deprecation
              document.execCommand("insertOrderedList");
            } catch {}
            return;
          }
        }
      }
    }

    if (e.key !== "Enter") return;

    if (e.shiftKey) {
      e.preventDefault();
      // eslint-disable-next-line deprecation/deprecation
      document.execCommand("insertLineBreak");
      return;
    }

    e.preventDefault();
    // eslint-disable-next-line deprecation/deprecation
    document.execCommand("insertParagraph");
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

  const hasContent = !isHtmlEffectivelyEmpty(html);

  const planKey = `${dateKey}::${slotId}`;

  async function onAddUrl() {
    setUrlForm({ mode: "add", name: "", url: "" });
  }

  async function onSubmitUrl() {
    if (!urlForm) return;
    const name = urlForm.name.trim();
    const url = urlForm.url.trim();
    if (!url) return;
    if (urlForm.mode === "add") {
      await addUrlAttachmentToPlan(userId, planKey, name, url);
    } else if (urlForm.mode === "edit" && urlForm.id) {
      await updateUrlAttachment(userId, urlForm.id, { name: name || url, url });
    }
    setUrlForm(null);
  }

  function openAttachment(att: LessonAttachment) {
    const href = att.kind === "url" ? att.url : att.downloadUrl;
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      ref={wrapRef}
      className="card"
      style={{ marginTop: 8, background: "#0b0b0b" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {active ? (
        <div className="row" style={{ justifyContent: "flex-end", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>Auto-saves</span>
        </div>
      ) : null}

      {!active ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            hydratedRef.current = false;
            setActive(true);
            setTimeout(() => {
              if (ref.current) {
                ref.current.innerHTML = html || "<p><br></p>";
                ref.current.focus();
              }
            }, 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              hydratedRef.current = false;
              setActive(true);
              setTimeout(() => {
                if (ref.current) {
                  ref.current.innerHTML = html || "<p><br></p>";
                  ref.current.focus();
                }
              }, 0);
            }
          }}
          style={{
            marginTop: 8,
            width: "100%",
            boxSizing: "border-box",
            minHeight: 72,
            maxHeight: 260,
            overflowY: "auto",
            padding: 10,
            borderRadius: 12,
            background: "#0f0f0f",
            border: "1px solid rgba(255,255,255,0.08)",
            cursor: "text",
          }}
        >
          {hasContent ? (
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

            <div style={{ position: "relative" }}>
              <button
                className="btn"
                type="button"
                onMouseDown={toolbarMouseDown}
                onClick={() => setOpenPicker((p) => (p === "text" ? null : "text"))}
                title="Text colour"
              >
                Text
              </button>
              <button
                className="btn"
                type="button"
                onMouseDown={toolbarMouseDown}
                onClick={() => setOpenPicker((p) => (p === "highlight" ? null : "highlight"))}
                title="Highlight"
              >
                Highlight
              </button>

              {openPicker ? (
                <div
                  ref={popoverRef}
                  className="card"
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: 6,
                    padding: 10,
                    zIndex: 50,
                    minWidth: 240,
                    background: "#0b0b0b",
                    border: "1px solid rgba(255,255,255,0.14)",
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {openPicker === "text" ? "Text colour" : "Highlight"}
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onMouseDown={toolbarMouseDown}
                      onClick={() => {
                        if (openPicker === "text") customTextRef.current?.click();
                        else customHiRef.current?.click();
                      }}
                      title="Custom colour"
                    >
                      🎨
                    </button>

                    <input
                      ref={customTextRef}
                      type="color"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        exec("foreColor", e.target.value);
                        setOpenPicker(null);
                      }}
                    />
                    <input
                      ref={customHiRef}
                      type="color"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        try {
                          // eslint-disable-next-line deprecation/deprecation
                          document.execCommand("hiliteColor", false, e.target.value);
                        } catch {
                          exec("backColor", e.target.value);
                        }
                        const next = ref.current?.innerHTML ?? "";
                        setHtml(next);
                        scheduleSave(next);
                        setOpenPicker(null);
                      }}
                    />
                  </div>

                  <div style={{ height: 8 }} />

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
                    {swatches.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onMouseDown={toolbarMouseDown}
                        onClick={() => {
                          if (openPicker === "text") {
                            exec("foreColor", c);
                          } else {
                            try {
                              // eslint-disable-next-line deprecation/deprecation
                              document.execCommand("hiliteColor", false, c);
                            } catch {
                              exec("backColor", c);
                            }
                            const next = ref.current?.innerHTML ?? "";
                            setHtml(next);
                            scheduleSave(next);
                          }
                          setOpenPicker(null);
                        }}
                        title={c}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,0.18)",
                          background: c,
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={onAddUrl}>
              + URL
            </button>

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

          {/* URL attachment form */}
          {urlForm ? (
            <div className="card" style={{ marginTop: 8, background: "#0f0f0f" }} onMouseDown={(e) => e.stopPropagation()}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  value={urlForm.name}
                  placeholder="Label (optional)"
                  onChange={(e) => setUrlForm((cur) => (cur ? { ...cur, name: e.target.value } : cur))}
                  style={{ flex: "1 1 220px" }}
                />
                <input
                  value={urlForm.url}
                  placeholder="URL"
                  onChange={(e) => setUrlForm((cur) => (cur ? { ...cur, url: e.target.value } : cur))}
                  style={{ flex: "2 1 320px" }}
                />
                <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={onSubmitUrl}>
                  Save
                </button>
                <button className="btn" type="button" onMouseDown={toolbarMouseDown} onClick={() => setUrlForm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {/* Attachments list (URLs) */}
          {attachments && attachments.length ? (
            <div className="card" style={{ marginTop: 8, background: "#0f0f0f" }} onMouseDown={(e) => e.stopPropagation()}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Links
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {attachments
                  .filter((a) => (a.kind ?? "file") === "url")
                  .map((a) => (
                    <div key={a.id} className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ minWidth: 0 }}>
                        <button
                          className="btn"
                          type="button"
                          onMouseDown={toolbarMouseDown}
                          onClick={() => openAttachment(a)}
                          style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={a.url ?? a.name}
                        >
                          {a.name}
                        </button>
                        {a.url ? (
                          <div className="muted" style={{ fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {a.url}
                          </div>
                        ) : null}
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn"
                          type="button"
                          onMouseDown={toolbarMouseDown}
                          onClick={() => setUrlForm({ mode: "edit", id: a.id, name: a.name ?? "", url: a.url ?? "" })}
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onMouseDown={toolbarMouseDown}
                          onClick={() => deleteAttachment(userId, a.id)}
                          title="Remove"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : null}

          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            onInput={onInput}
            onKeyDown={onEditorKeyDown}
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
        </>
      ) : null}
    </div>
  );
}