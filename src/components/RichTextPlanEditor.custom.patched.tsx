import { useEffect, useRef, useState, type MouseEvent as RMouseEvent } from "react";
import type { SlotId } from "../db/db";
import { upsertLessonPlan } from "../db/lessonPlanQueries";

export default function RichTextPlanEditor(props: {
  userId: string;
  dateKey: string;
  slotId: SlotId;
  initialHtml: string;
  // kept for compatibility with existing call sites; ignored when attachments disabled
  attachments: any[];
  /** Optional colour palette (e.g. subject colours) to render quick swatches. */
  palette?: string[];
}) {
  const { userId, dateKey, slotId, initialHtml, palette = [] } = props;
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

  function onInput() {
    dirtyRef.current = true;
    const next = ref.current?.innerHTML ?? "";
    setHtml(next);
    scheduleSave(next);
  }

  function getBlockContainer(node: Node | null): HTMLElement | null {
    let cur: Node | null = node;
    while (cur && cur !== ref.current) {
      if (cur instanceof HTMLElement) {
        const tag = cur.tagName.toLowerCase();
        if (tag === "p" || tag === "div" || tag === "li") return cur;
      }
      cur = cur.parentNode;
    }
    return ref.current;
  }

  function getLineTextBeforeCaret(): string {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return "";

    const block = getBlockContainer(range.startContainer);
    if (!block) return "";

    const r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(range.startContainer, range.startOffset);
    return (r.toString() ?? "").replace(/\u00a0/g, " ");
  }

  function deleteTextBeforeCaret(chars: number) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;

    const startNode = range.startContainer;
    if (!(startNode instanceof Text)) return;
    const startOffset = range.startOffset;
    const from = Math.max(0, startOffset - chars);
    const r = document.createRange();
    r.setStart(startNode, from);
    r.setEnd(startNode, startOffset);
    r.deleteContents();
  }

  function onEditorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl/Cmd shortcuts
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        exec("bold");
        return;
      }
      if (k === "i") {
        e.preventDefault();
        exec("italic");
        return;
      }
      if (k === "u") {
        e.preventDefault();
        exec("underline");
        return;
      }
    }

    // Auto-list: "* " / "- " / "1. " / "1) " at start of a line
    if (e.key === " " && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const before = getLineTextBeforeCaret();
      const trimmed = before.trim();
      if (trimmed === "*" || trimmed === "-") {
        e.preventDefault();
        deleteTextBeforeCaret(trimmed.length);
        exec("insertUnorderedList");
        return;
      }
      if (trimmed === "1." || trimmed === "1)") {
        e.preventDefault();
        deleteTextBeforeCaret(trimmed.length);
        exec("insertOrderedList");
        return;
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

            <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Text
              <input
                type="color"
                onChange={(e) => exec("foreColor", e.target.value)}
                style={{ width: 28, height: 18, padding: 0, border: 0, background: "transparent" }}
              />
            </label>

            {palette.length > 0 ? (
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                {Array.from(new Set(palette.map((c) => (c || "").trim()).filter(Boolean)))
                  .slice(0, 16)
                  .map((c) => (
                    <button
                      key={c}
                      type="button"
                      onMouseDown={toolbarMouseDown}
                      onClick={() => exec("foreColor", c)}
                      title={c}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: c,
                        padding: 0,
                      }}
                    />
                  ))}
              </div>
            ) : null}

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