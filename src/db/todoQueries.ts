import { deleteDoc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import type { TodoItem } from "./db";
import { todoDoc, todosCol } from "./db";

export async function getTodosForUser(userId: string): Promise<TodoItem[]> {
  const snap = await getDocs(todosCol(userId));
  return snap.docs.map((d) => d.data() as TodoItem);
}

export async function upsertTodo(todo: TodoItem): Promise<void> {
  const { setDoc } = await import("firebase/firestore");
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
