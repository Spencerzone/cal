import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "../auth/AuthProvider";
import type { Subject, TodoItem } from "../db/db";
import { getAllSubjectsByUser } from "../db/subjectQueries";
import {
  getTodosForUser,
  upsertTodo,
  deleteTodo,
  updateTodoOrders,
} from "../db/todoQueries";
import { getRollingSettings } from "../rolling/settings";

// ─── helpers ─────────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDueDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function dueDateClass(dueDate: string | null, completed: boolean): string {
  if (completed || !dueDate) return "";
  const diff = Math.ceil(
    (new Date(dueDate).getTime() - Date.now()) / 86400000,
  );
  if (diff < 0) return "overdue";
  if (diff <= 3) return "due-soon";
  return "";
}

type SortMode = "custom" | "dueDate" | "entryDate";

function sortItems(items: TodoItem[], mode: SortMode): TodoItem[] {
  const incomplete = items.filter((t) => !t.completed);
  const complete = items.filter((t) => t.completed);
  const sortFn =
    mode === "dueDate"
      ? (a: TodoItem, b: TodoItem) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        }
      : mode === "entryDate"
        ? (a: TodoItem, b: TodoItem) => a.createdAt - b.createdAt
        : (a: TodoItem, b: TodoItem) => a.order - b.order;
  return [...incomplete.sort(sortFn), ...complete.sort(sortFn)];
}

// ─── SortableItem ─────────────────────────────────────────────────────────────

function SortableItem({
  todo,
  sortMode,
  userId,
  onToggle,
  onDelete,
  onEditTitle,
  onEditDue,
}: {
  todo: TodoItem;
  sortMode: SortMode;
  userId: string;
  onToggle: (todo: TodoItem) => void;
  onDelete: (todo: TodoItem) => void;
  onEditTitle: (todo: TodoItem, title: string) => void;
  onEditDue: (todo: TodoItem, dueDate: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id, disabled: sortMode !== "custom" });

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const dcClass = dueDateClass(todo.dueDate, todo.completed);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 4px",
        borderBottom: "1px solid var(--line)",
        background: isDragging ? "var(--panel2)" : "transparent",
        borderRadius: isDragging ? 8 : 0,
      }}
    >
      {/* Drag handle — only shown in custom sort mode */}
      {sortMode === "custom" && (
        <span
          {...attributes}
          {...listeners}
          style={{
            cursor: "grab",
            color: "var(--muted)",
            padding: "0 2px",
            touchAction: "none",
            flexShrink: 0,
          }}
          title="Drag to reorder"
        >
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="4" cy="4"  r="1.5"/>
            <circle cx="4" cy="8"  r="1.5"/>
            <circle cx="4" cy="12" r="1.5"/>
            <circle cx="8" cy="4"  r="1.5"/>
            <circle cx="8" cy="8"  r="1.5"/>
            <circle cx="8" cy="12" r="1.5"/>
          </svg>
        </span>
      )}

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => onToggle(todo)}
        style={{ flexShrink: 0, width: 15, height: 15, cursor: "pointer" }}
      />

      {/* Title */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              setEditingTitle(false);
              if (titleDraft.trim() && titleDraft.trim() !== todo.title) {
                onEditTitle(todo, titleDraft.trim());
              } else {
                setTitleDraft(todo.title);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setTitleDraft(todo.title);
                setEditingTitle(false);
              }
            }}
            style={{
              width: "100%",
              background: "var(--panel2)",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              padding: "2px 6px",
              color: "var(--text)",
              fontSize: 14,
            }}
          />
        ) : (
          <span
            onClick={() => {
              setTitleDraft(todo.title);
              setEditingTitle(true);
            }}
            style={{
              cursor: "text",
              textDecoration: todo.completed ? "line-through" : "none",
              color: todo.completed ? "var(--muted)" : "var(--text)",
              fontSize: 14,
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title="Click to edit"
          >
            {todo.title}
          </span>
        )}
      </div>

      {/* Due date */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="date"
          value={todo.dueDate ?? ""}
          onChange={(e) => onEditDue(todo, e.target.value || null)}
          title="Due date"
          style={{
            background: "transparent",
            border: "none",
            color:
              dcClass === "overdue"
                ? "#ef4444"
                : dcClass === "due-soon"
                  ? "#f59e0b"
                  : "var(--muted)",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
            width: todo.dueDate ? "auto" : 22,
          }}
        />
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete(todo)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--muted)",
          cursor: "pointer",
          padding: "2px 4px",
          borderRadius: 4,
          fontSize: 14,
          flexShrink: 0,
        }}
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

// ─── AddTodoForm ──────────────────────────────────────────────────────────────

function AddTodoForm({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string, dueDate: string | null) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit() {
    const t = title.trim();
    if (!t) return;
    onAdd(t, dueDate || null);
    setTitle("");
    setDueDate("");
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: "6px 4px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Task title…"
        style={{
          flex: 1,
          background: "var(--panel2)",
          border: "1px solid var(--accent)",
          borderRadius: 6,
          padding: "4px 8px",
          color: "var(--text)",
          fontSize: 14,
        }}
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        title="Due date (optional)"
        style={{
          background: "var(--panel2)",
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "4px 6px",
          color: "var(--text)",
          fontSize: 12,
          cursor: "pointer",
        }}
      />
      <button
        type="button"
        className="btn"
        onClick={submit}
        style={{ padding: "4px 10px", fontSize: 13 }}
      >
        Add
      </button>
      <button
        type="button"
        className="btn"
        onClick={onCancel}
        style={{ padding: "4px 10px", fontSize: 13, color: "var(--muted)" }}
      >
        Cancel
      </button>
    </div>
  );
}

// ─── TodoList ─────────────────────────────────────────────────────────────────

function TodoList({
  title,
  color,
  items,
  sortMode,
  userId,
  onAdd,
  onToggle,
  onDelete,
  onEditTitle,
  onEditDue,
  onReorder,
}: {
  title: string;
  color?: string;
  items: TodoItem[];
  sortMode: SortMode;
  userId: string;
  onAdd: (title: string, dueDate: string | null) => void;
  onToggle: (todo: TodoItem) => void;
  onDelete: (todo: TodoItem) => void;
  onEditTitle: (todo: TodoItem, title: string) => void;
  onEditDue: (todo: TodoItem, dueDate: string | null) => void;
  onReorder: (oldIndex: number, newIndex: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const sorted = useMemo(() => sortItems(items, sortMode), [items, sortMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((t) => t.id === active.id);
    const newIndex = sorted.findIndex((t) => t.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) onReorder(oldIndex, newIndex);
  }

  const incomplete = items.filter((t) => !t.completed).length;

  return (
    <div
      className="card"
      style={{
        position: "relative",
        paddingLeft: color ? 18 : undefined,
        overflow: "hidden",
      }}
    >
      {color && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
            background: color,
            borderRadius: "10px 0 0 10px",
          }}
        />
      )}

      {/* List header */}
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 4 }}
      >
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ color: color ?? "var(--text)" }}>{title}</strong>
          {incomplete > 0 && (
            <span
              className="badge"
              style={{ fontSize: 11, padding: "1px 7px" }}
            >
              {incomplete}
            </span>
          )}
        </div>
        {!adding && (
          <button
            type="button"
            className="btn"
            onClick={() => setAdding(true)}
            style={{ padding: "2px 10px", fontSize: 12 }}
          >
            + Add
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <AddTodoForm
          onAdd={(t, d) => {
            onAdd(t, d);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Items */}
      {sorted.length === 0 && !adding ? (
        <div
          className="muted"
          style={{ fontSize: 13, padding: "6px 4px" }}
        >
          No tasks yet.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sorted.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            {sorted.map((todo) => (
              <SortableItem
                key={todo.id}
                todo={todo}
                sortMode={sortMode}
                userId={userId}
                onToggle={onToggle}
                onDelete={onDelete}
                onEditTitle={onEditTitle}
                onEditDue={onEditDue}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// ─── TodosPage ────────────────────────────────────────────────────────────────

export default function TodosPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [showAll, setShowAll] = useState(false);

  // Load todos + subjects on mount; refresh on event
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const [ts, ss, settings] = await Promise.all([
        getTodosForUser(userId),
        getAllSubjectsByUser(userId),
        getRollingSettings(userId),
      ]);
      if (!alive) return;
      // Filter subjects to kind=subject only, for the active year
      const year = settings.activeYear;
      const filtered = ss.filter(
        (s) =>
          !s.archived &&
          s.kind === "subject" &&
          (year === undefined || (s as any).year === undefined || (s as any).year === year),
      );
      filtered.sort((a, b) => a.title.localeCompare(b.title));
      setSubjects(filtered);
      setTodos(ts);
    };
    load();
    const onChange = () => { if (alive) load(); };
    window.addEventListener("todos-changed", onChange as any);
    window.addEventListener("subjects-changed", onChange as any);
    window.addEventListener("rolling-settings-changed", onChange as any);
    return () => {
      alive = false;
      window.removeEventListener("todos-changed", onChange as any);
      window.removeEventListener("subjects-changed", onChange as any);
      window.removeEventListener("rolling-settings-changed", onChange as any);
    };
  }, [userId]);

  // Group todos
  const generalTodos = useMemo(
    () => todos.filter((t) => t.subjectId === null),
    [todos],
  );
  const todosBySubject = useMemo(() => {
    const map = new Map<string, TodoItem[]>();
    for (const t of todos) {
      if (t.subjectId) {
        const arr = map.get(t.subjectId) ?? [];
        arr.push(t);
        map.set(t.subjectId, arr);
      }
    }
    return map;
  }, [todos]);

  const allSortedByDue = useMemo(
    () => sortItems(todos, "dueDate"),
    [todos],
  );

  // ── CRUD helpers ─────────────────────────────────────────────────────────

  function maxOrder(items: TodoItem[]): number {
    return items.reduce((m, t) => Math.max(m, t.order), 0);
  }

  async function handleAdd(
    subjectId: string | null,
    title: string,
    dueDate: string | null,
  ) {
    const existing = subjectId
      ? (todosBySubject.get(subjectId) ?? [])
      : generalTodos;
    const todo: TodoItem = {
      id: newId(),
      userId,
      subjectId,
      title,
      dueDate,
      completed: false,
      order: maxOrder(existing) + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await upsertTodo(todo);
  }

  async function handleToggle(todo: TodoItem) {
    await upsertTodo({
      ...todo,
      completed: !todo.completed,
      updatedAt: Date.now(),
    });
  }

  async function handleDelete(todo: TodoItem) {
    await deleteTodo(userId, todo.id);
  }

  async function handleEditTitle(todo: TodoItem, title: string) {
    await upsertTodo({ ...todo, title, updatedAt: Date.now() });
  }

  async function handleEditDue(todo: TodoItem, dueDate: string | null) {
    await upsertTodo({ ...todo, dueDate, updatedAt: Date.now() });
  }

  async function handleReorder(
    subjectId: string | null,
    oldIndex: number,
    newIndex: number,
  ) {
    const items = subjectId
      ? (todosBySubject.get(subjectId) ?? [])
      : generalTodos;
    const sorted = sortItems(items, "custom");
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    const updates = reordered.map((t, i) => ({ id: t.id, order: i + 1 }));
    // Optimistic update
    setTodos((prev) => {
      const byId = new Map(reordered.map((t, i) => [t.id, { ...t, order: i + 1 }]));
      return prev.map((t) => byId.get(t.id) ?? t);
    });
    await updateTodoOrders(userId, updates);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="grid">
      {/* Header */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ margin: 0 }}>To-Dos</h1>
          <div className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>Sort:</span>
            {(["custom", "dueDate", "entryDate"] as SortMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className="btn"
                onClick={() => setSortMode(m)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  background: sortMode === m ? "var(--accent)" : undefined,
                  color: sortMode === m ? "#fff" : undefined,
                  border: sortMode === m ? "1px solid var(--accent)" : undefined,
                }}
              >
                {m === "custom" ? "Custom" : m === "dueDate" ? "Due date" : "Entry date"}
              </button>
            ))}
          </div>
        </div>
        {sortMode === "custom" && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            Drag the ⠿ handle to reorder within each list.
          </p>
        )}
      </div>

      {/* General list */}
      <TodoList
        title="General"
        items={generalTodos}
        sortMode={sortMode}
        userId={userId}
        onAdd={(title, due) => handleAdd(null, title, due)}
        onToggle={handleToggle}
        onDelete={handleDelete}
        onEditTitle={handleEditTitle}
        onEditDue={handleEditDue}
        onReorder={(o, n) => handleReorder(null, o, n)}
      />

      {/* Per-subject lists */}
      {subjects.map((subject) => (
        <TodoList
          key={subject.id}
          title={subject.title}
          color={subject.color}
          items={todosBySubject.get(subject.id) ?? []}
          sortMode={sortMode}
          userId={userId}
          onAdd={(title, due) => handleAdd(subject.id, title, due)}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onEditTitle={handleEditTitle}
          onEditDue={handleEditDue}
          onReorder={(o, n) => handleReorder(subject.id, o, n)}
        />
      ))}

      {/* All To-Dos (combined, sorted by due date) */}
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => setShowAll((v) => !v)}
          style={{ fontSize: 13, padding: "4px 12px" }}
        >
          {showAll ? "▾" : "▸"} All To-Dos ({allSortedByDue.filter((t) => !t.completed).length} pending)
        </button>
        {showAll && (
          <div className="card" style={{ marginTop: 8 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>All tasks</strong>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                sorted by due date
              </span>
            </div>
            {allSortedByDue.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No tasks yet.</div>
            ) : (
              allSortedByDue.map((todo) => {
                const subject = subjects.find((s) => s.id === todo.subjectId);
                const dcClass = dueDateClass(todo.dueDate, todo.completed);
                return (
                  <div
                    key={todo.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 4px",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => handleToggle(todo)}
                      style={{ flexShrink: 0, width: 15, height: 15, cursor: "pointer" }}
                    />
                    <span
                      style={{
                        flex: 1,
                        textDecoration: todo.completed ? "line-through" : "none",
                        color: todo.completed ? "var(--muted)" : "var(--text)",
                        fontSize: 14,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {todo.title}
                    </span>
                    {subject && (
                      <span
                        style={{
                          fontSize: 11,
                          color: subject.color,
                          flexShrink: 0,
                          maxWidth: 120,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {subject.title}
                      </span>
                    )}
                    {todo.dueDate && (
                      <span
                        style={{
                          fontSize: 12,
                          flexShrink: 0,
                          color:
                            dcClass === "overdue"
                              ? "#ef4444"
                              : dcClass === "due-soon"
                                ? "#f59e0b"
                                : "var(--muted)",
                        }}
                      >
                        {formatDueDate(todo.dueDate)}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
