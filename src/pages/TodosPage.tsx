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
import type { CustomList, Subject, TodoItem, TodoListConfig } from "../db/db";
import { getAllSubjectsByUser } from "../db/subjectQueries";
import {
  getTodosForUser,
  upsertTodo,
  deleteTodo,
  updateTodoOrders,
  getTodoListConfig,
  setTodoListConfig,
  clearCompletedTodos,
} from "../db/todoQueries";
import { getRollingSettings } from "../rolling/settings";

// ─── helpers ─────────────────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID();
}

function formatDueDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function dueDateStatus(dueDate: string | null, completed: boolean): "overdue" | "soon" | "" {
  if (completed || !dueDate) return "";
  const diff = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff <= 3) return "soon";
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

// ─── ListVisibilityRow ────────────────────────────────────────────────────────

function ListVisibilityRow({
  label,
  color,
  visible,
  onToggle,
  canDelete,
  onDelete,
}: {
  label: string;
  color?: string;
  visible: boolean;
  onToggle: () => void;
  canDelete: boolean;
  onDelete?: () => void;
}) {
  return (
    <div
      className="row"
      style={{
        justifyContent: "space-between",
        padding: "5px 0",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div className="row" style={{ gap: 8 }}>
        {color && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: color,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontSize: 13,
            color: visible ? "var(--text)" : "var(--muted)",
            textDecoration: visible ? "none" : "line-through",
          }}
        >
          {label}
        </span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button
          type="button"
          className="btn"
          onClick={onToggle}
          style={{ padding: "2px 8px", fontSize: 11 }}
        >
          {visible ? "Hide" : "Show"}
        </button>
        {canDelete && (
          <button
            type="button"
            className="btn"
            onClick={onDelete}
            style={{ padding: "2px 8px", fontSize: 11, color: "#ef4444" }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ManageListsPanel ─────────────────────────────────────────────────────────

function ManageListsPanel({
  subjects,
  customLists,
  hiddenListIds,
  onToggleVisibility,
  onAddCustomList,
  onDeleteCustomList,
}: {
  subjects: Subject[];
  customLists: CustomList[];
  hiddenListIds: string[];
  onToggleVisibility: (id: string) => void;
  onAddCustomList: (title: string, color: string | null) => void;
  onDeleteCustomList: (id: string) => void;
}) {
  const [addingCustom, setAddingCustom] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newColor, setNewColor] = useState("#6ea8fe");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingCustom) inputRef.current?.focus();
  }, [addingCustom]);

  function submitNewList() {
    const t = newTitle.trim();
    if (!t) return;
    onAddCustomList(t, newColor);
    setNewTitle("");
    setNewColor("#6ea8fe");
    setAddingCustom(false);
  }

  return (
    <div
      style={{
        marginTop: 12,
        borderTop: "1px solid var(--line)",
        paddingTop: 12,
      }}
    >
      <div
        className="row"
        style={{ justifyContent: "space-between", marginBottom: 8 }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>Lists</span>
        {!addingCustom && (
          <button
            type="button"
            className="btn"
            onClick={() => setAddingCustom(true)}
            style={{ padding: "2px 10px", fontSize: 12 }}
          >
            + New list
          </button>
        )}
      </div>

      {/* New custom list form */}
      {addingCustom && (
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <input
            ref={inputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNewList();
              if (e.key === "Escape") setAddingCustom(false);
            }}
            placeholder="List name…"
            style={{
              flex: 1,
              background: "var(--panel2)",
              border: "1px solid var(--accent)",
              borderRadius: 6,
              padding: "4px 8px",
              color: "var(--text)",
              fontSize: 13,
            }}
          />
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            title="List colour"
            style={{
              width: 28,
              height: 28,
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: 0,
              borderRadius: 4,
            }}
          />
          <button
            type="button"
            className="btn"
            onClick={submitNewList}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            Add
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setAddingCustom(false)}
            style={{ padding: "4px 10px", fontSize: 12, color: "var(--muted)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* General */}
      <ListVisibilityRow
        label="General"
        visible={!hiddenListIds.includes("general")}
        onToggle={() => onToggleVisibility("general")}
        canDelete={false}
      />

      {/* Subject-based lists */}
      {subjects.map((s) => (
        <ListVisibilityRow
          key={s.id}
          label={s.title}
          color={s.color}
          visible={!hiddenListIds.includes(s.id)}
          onToggle={() => onToggleVisibility(s.id)}
          canDelete={false}
        />
      ))}

      {/* Custom lists */}
      {customLists.map((l) => (
        <ListVisibilityRow
          key={l.id}
          label={l.title}
          color={l.color ?? undefined}
          visible={!hiddenListIds.includes(l.id)}
          onToggle={() => onToggleVisibility(l.id)}
          canDelete
          onDelete={() => onDeleteCustomList(l.id)}
        />
      ))}
    </div>
  );
}

// ─── SortableItem ─────────────────────────────────────────────────────────────

function SortableItem({
  todo,
  sortMode,
  onToggle,
  onDelete,
  onEditTitle,
  onEditDue,
}: {
  todo: TodoItem;
  sortMode: SortMode;
  onToggle: (todo: TodoItem) => void;
  onDelete: (todo: TodoItem) => void;
  onEditTitle: (todo: TodoItem, title: string) => void;
  onEditDue: (todo: TodoItem, dueDate: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id, disabled: sortMode !== "custom" });

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(todo.title);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const dcStatus = dueDateStatus(todo.dueDate, todo.completed);

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

      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => onToggle(todo)}
        style={{ flexShrink: 0, width: 15, height: 15, cursor: "pointer" }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        {editingTitle ? (
          <input
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

      <input
        type="date"
        value={todo.dueDate ?? ""}
        onChange={(e) => onEditDue(todo, e.target.value || null)}
        title="Due date"
        style={{
          background: "transparent",
          border: "none",
          color:
            dcStatus === "overdue"
              ? "#ef4444"
              : dcStatus === "soon"
                ? "#f59e0b"
                : "var(--muted)",
          fontSize: 12,
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
          width: todo.dueDate ? "auto" : 22,
        }}
      />

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

  useEffect(() => { inputRef.current?.focus(); }, []);

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
      <button type="button" className="btn" onClick={submit}
        style={{ padding: "4px 10px", fontSize: 13 }}>
        Add
      </button>
      <button type="button" className="btn" onClick={onCancel}
        style={{ padding: "4px 10px", fontSize: 13, color: "var(--muted)" }}>
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
  onClearCompleted,
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
  onClearCompleted: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const sorted = useMemo(() => sortItems(items, sortMode), [items, sortMode]);
  const completedCount = items.filter((t) => t.completed).length;

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
      style={{ position: "relative", paddingLeft: color ? 18 : undefined, overflow: "hidden" }}
    >
      {color && (
        <div
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: 6,
            background: color,
            borderRadius: "10px 0 0 10px",
          }}
        />
      )}

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong style={{ color: color ?? "var(--text)" }}>{title}</strong>
          {incomplete > 0 && (
            <span className="badge" style={{ fontSize: 11, padding: "1px 7px" }}>
              {incomplete}
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {completedCount > 0 && !adding && (
            <button type="button" className="btn" onClick={onClearCompleted}
              style={{ padding: "2px 8px", fontSize: 11, color: "var(--muted)" }}>
              Clear checked ({completedCount})
            </button>
          )}
          {!adding && (
            <button type="button" className="btn" onClick={() => setAdding(true)}
              style={{ padding: "2px 10px", fontSize: 12 }}>
              + Add
            </button>
          )}
        </div>
      </div>

      {adding && (
        <AddTodoForm
          onAdd={(t, d) => { onAdd(t, d); setAdding(false); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {sorted.length === 0 && !adding ? (
        <div className="muted" style={{ fontSize: 13, padding: "6px 4px" }}>
          No tasks yet.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sorted.map((t) => t.id)} strategy={verticalListSortingStrategy}>
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
  const [listConfig, setListConfig] = useState<TodoListConfig>({
    hiddenListIds: [],
    customLists: [],
  });
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [showAll, setShowAll] = useState(true); // expanded by default at top
  const [showManage, setShowManage] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const [ts, ss, settings, config] = await Promise.all([
        getTodosForUser(userId),
        getAllSubjectsByUser(userId),
        getRollingSettings(userId),
        getTodoListConfig(userId),
      ]);
      if (!alive) return;
      const year = settings.activeYear;
      const filtered = ss.filter(
        (s) =>
          !s.archived &&
          s.kind === "subject" &&
          (year === undefined ||
            (s as any).year === undefined ||
            (s as any).year === year),
      );
      filtered.sort((a, b) => a.title.localeCompare(b.title));
      setSubjects(filtered);
      setTodos(ts);
      setListConfig(config);
    };
    load();
    const onChange = () => { if (alive) load(); };
    window.addEventListener("todos-changed", onChange as any);
    window.addEventListener("todo-list-config-changed", onChange as any);
    window.addEventListener("subjects-changed", onChange as any);
    window.addEventListener("rolling-settings-changed", onChange as any);
    return () => {
      alive = false;
      window.removeEventListener("todos-changed", onChange as any);
      window.removeEventListener("todo-list-config-changed", onChange as any);
      window.removeEventListener("subjects-changed", onChange as any);
      window.removeEventListener("rolling-settings-changed", onChange as any);
    };
  }, [userId]);

  // ── Derived state ─────────────────────────────────────────────────────────

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

  const visibleSubjects = useMemo(
    () => subjects.filter((s) => !listConfig.hiddenListIds.includes(s.id)),
    [subjects, listConfig.hiddenListIds],
  );

  const generalHidden = listConfig.hiddenListIds.includes("general");

  const allSortedByDue = useMemo(() => sortItems(todos, "dueDate"), [todos]);

  // ── Config mutation helpers ───────────────────────────────────────────────

  async function handleToggleListVisibility(listId: string) {
    const hidden = listConfig.hiddenListIds;
    const next: TodoListConfig = {
      ...listConfig,
      hiddenListIds: hidden.includes(listId)
        ? hidden.filter((id) => id !== listId)
        : [...hidden, listId],
    };
    setListConfig(next);
    await setTodoListConfig(userId, next);
  }

  async function handleAddCustomList(title: string, color: string | null) {
    const newList: CustomList = {
      id: newId(),
      title: title.trim(),
      color,
      order: listConfig.customLists.length,
      createdAt: Date.now(),
    };
    const next: TodoListConfig = {
      ...listConfig,
      customLists: [...listConfig.customLists, newList],
    };
    setListConfig(next);
    await setTodoListConfig(userId, next);
  }

  async function handleDeleteCustomList(listId: string) {
    // Delete all todos in this list first
    const listItems = todosBySubject.get(listId) ?? [];
    if (listItems.length > 0) {
      await clearCompletedTodos(userId, listItems.map((t) => t.id));
    }
    const next: TodoListConfig = {
      ...listConfig,
      customLists: listConfig.customLists.filter((l) => l.id !== listId),
      hiddenListIds: listConfig.hiddenListIds.filter((id) => id !== listId),
    };
    setListConfig(next);
    await setTodoListConfig(userId, next);
  }

  // ── Todo CRUD helpers ────────────────────────────────────────────────────

  function maxOrder(items: TodoItem[]): number {
    return items.reduce((m, t) => Math.max(m, t.order), 0);
  }

  async function handleAdd(
    subjectId: string | null,
    title: string,
    dueDate: string | null,
  ) {
    const existing = subjectId ? (todosBySubject.get(subjectId) ?? []) : generalTodos;
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
    await upsertTodo({ ...todo, completed: !todo.completed, updatedAt: Date.now() });
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
    const items = subjectId ? (todosBySubject.get(subjectId) ?? []) : generalTodos;
    const sorted = sortItems(items, "custom");
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    const updates = reordered.map((t, i) => ({ id: t.id, order: i + 1 }));
    setTodos((prev) => {
      const byId = new Map(reordered.map((t, i) => [t.id, { ...t, order: i + 1 }]));
      return prev.map((t) => byId.get(t.id) ?? t);
    });
    await updateTodoOrders(userId, updates);
  }

  async function handleClearCompleted(listId: string | null) {
    const items = listId === null ? generalTodos : (todosBySubject.get(listId) ?? []);
    const ids = items.filter((t) => t.completed).map((t) => t.id);
    await clearCompletedTodos(userId, ids);
  }

  async function handleClearAllCompleted() {
    const ids = todos.filter((t) => t.completed).map((t) => t.id);
    await clearCompletedTodos(userId, ids);
  }

  const anyCompleted = todos.some((t) => t.completed);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="grid">

      {/* ── Header card ── */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ margin: 0 }}>To-Dos</h1>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
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
            <button
              type="button"
              className="btn"
              onClick={() => setShowManage((v) => !v)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                background: showManage ? "var(--panel2)" : undefined,
              }}
            >
              {showManage ? "Done" : "Manage lists"}
            </button>
            {anyCompleted && (
              <button
                type="button"
                className="btn"
                onClick={handleClearAllCompleted}
                style={{ padding: "4px 10px", fontSize: 12, color: "var(--muted)" }}
              >
                Clear all checked
              </button>
            )}
          </div>
        </div>
        {sortMode === "custom" && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            Drag the ⠿ handle to reorder within each list.
          </p>
        )}

        {/* Manage lists panel — inline below header controls */}
        {showManage && (
          <ManageListsPanel
            subjects={subjects}
            customLists={listConfig.customLists}
            hiddenListIds={listConfig.hiddenListIds}
            onToggleVisibility={handleToggleListVisibility}
            onAddCustomList={handleAddCustomList}
            onDeleteCustomList={handleDeleteCustomList}
          />
        )}
      </div>

      {/* ── All To-Dos (at top, expanded by default) ── */}
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
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div>
                <strong>All tasks</strong>
                <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                  sorted by due date
                </span>
              </div>
              {anyCompleted && (
                <button
                  type="button"
                  className="btn"
                  onClick={handleClearAllCompleted}
                  style={{ padding: "2px 8px", fontSize: 11, color: "var(--muted)" }}
                >
                  Clear all checked
                </button>
              )}
            </div>
            {allSortedByDue.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No tasks yet.</div>
            ) : (
              allSortedByDue.map((todo) => {
                const subject = subjects.find((s) => s.id === todo.subjectId);
                const customList = listConfig.customLists.find((l) => l.id === todo.subjectId);
                const listLabel = subject?.title ?? customList?.title ?? null;
                const listColor = subject?.color ?? customList?.color ?? null;
                const dcStatus = dueDateStatus(todo.dueDate, todo.completed);
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
                    {listLabel && (
                      <span
                        style={{
                          fontSize: 11,
                          color: listColor ?? "var(--muted)",
                          flexShrink: 0,
                          maxWidth: 120,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {listLabel}
                      </span>
                    )}
                    {todo.dueDate && (
                      <span
                        style={{
                          fontSize: 12,
                          flexShrink: 0,
                          color:
                            dcStatus === "overdue"
                              ? "#ef4444"
                              : dcStatus === "soon"
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

      {/* ── General list ── */}
      {!generalHidden && (
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
          onClearCompleted={() => handleClearCompleted(null)}
        />
      )}

      {/* ── Subject-based lists (only visible ones) ── */}
      {visibleSubjects.map((subject) => (
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
          onClearCompleted={() => handleClearCompleted(subject.id)}
        />
      ))}

      {/* ── Custom lists ── */}
      {listConfig.customLists
        .filter((l) => !listConfig.hiddenListIds.includes(l.id))
        .map((list) => (
          <TodoList
            key={list.id}
            title={list.title}
            color={list.color ?? undefined}
            items={todosBySubject.get(list.id) ?? []}
            sortMode={sortMode}
            userId={userId}
            onAdd={(title, due) => handleAdd(list.id, title, due)}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onEditTitle={handleEditTitle}
            onEditDue={handleEditDue}
            onReorder={(o, n) => handleReorder(list.id, o, n)}
            onClearCompleted={() => handleClearCompleted(list.id)}
          />
        ))}

    </div>
  );
}
