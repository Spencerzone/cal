import { deleteDoc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import type { TodoItem, TodoListConfig } from "./db";
import { todoDoc, todosCol, settingDoc } from "./db";

const TODO_LIST_CONFIG_KEY = "todoListConfig";
const TODO_LIST_CONFIG_DEFAULTS: TodoListConfig = { hiddenListIds: [], customLists: [] };

export async function getTodosForUser(userId: string): Promise<TodoItem[]> {
  const snap = await getDocs(todosCol(userId));
  return snap.docs.map((d) => d.data() as TodoItem);
}

export async function upsertTodo(todo: TodoItem): Promise<void> {
  try {
    await setDoc(todoDoc(todo.userId, todo.id), todo, { merge: false });
  } catch (e) {
    console.error("[todoQueries] Failed to save todo", e);
    throw e;
  }
  window.dispatchEvent(new Event("todos-changed"));
}

export async function deleteTodo(userId: string, todoId: string): Promise<void> {
  try {
    await deleteDoc(todoDoc(userId, todoId));
  } catch (e) {
    console.error("[todoQueries] Failed to delete todo", e);
    throw e;
  }
  window.dispatchEvent(new Event("todos-changed"));
}

export async function updateTodoOrders(
  userId: string,
  updates: { id: string; order: number }[],
): Promise<void> {
  if (updates.length === 0) return;
  const batch = writeBatch(db);
  for (const { id, order } of updates) {
    batch.update(todoDoc(userId, id), { order });
  }
  try {
    await batch.commit();
  } catch (e) {
    console.error("[todoQueries] Failed to update todo orders", e);
    throw e;
  }
  window.dispatchEvent(new Event("todos-changed"));
}

export async function getTodoListConfig(userId: string): Promise<TodoListConfig> {
  const snap = await getDoc(settingDoc(userId, TODO_LIST_CONFIG_KEY));
  if (!snap.exists()) return { ...TODO_LIST_CONFIG_DEFAULTS };
  const v = (snap.data() as any).value;
  return v ? { ...TODO_LIST_CONFIG_DEFAULTS, ...v } : { ...TODO_LIST_CONFIG_DEFAULTS };
}

export async function setTodoListConfig(
  userId: string,
  config: TodoListConfig,
): Promise<void> {
  await setDoc(settingDoc(userId, TODO_LIST_CONFIG_KEY), {
    key: TODO_LIST_CONFIG_KEY,
    value: config,
  });
  window.dispatchEvent(new Event("todo-list-config-changed"));
}

export async function clearCompletedTodos(
  userId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const batch = writeBatch(db);
  for (const id of ids) {
    batch.delete(todoDoc(userId, id));
  }
  try {
    await batch.commit();
  } catch (e) {
    console.error("[todoQueries] Failed to clear completed todos", e);
    throw e;
  }
  window.dispatchEvent(new Event("todos-changed"));
}
