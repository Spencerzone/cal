// src/pages/BlocksPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { Block, BlockKind } from "../db/db";
import { ensureDefaultBlocks } from "../db/seed";
import { getAllBlocks } from "../db/blockQueries";
import { createBlock, deleteBlock, reorderBlocks, setBlockVisible, updateBlock } from "../db/blockMutations";


const KIND_LABELS: Record<BlockKind, string> = {
  class: "Class",
  duty: "Duty",
  break: "Break",
  admin: "Admin",
  other: "Other",
};

export default function BlocksPage() {
  const { user } = useAuth();
  const userId = user?.uid || "";
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<BlockKind>("class");
  const [showHidden, setShowHidden] = useState<boolean>(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  async function refresh() {
    await ensureDefaultBlocks(userId);
    setBlocks(await getAllBlocks(userId));
  }

  useEffect(() => {
    if (!userId) return;
    refresh();
    const onChanged = () => refresh();
    window.addEventListener("blocks-changed", onChanged as any);
    return () => window.removeEventListener("blocks-changed", onChanged as any);
  }, [userId]);

  const canAdd = useMemo(() => name.trim().length > 0, [name]);

  async function addBlock() {
    if (!canAdd) return;
    await createBlock(userId, name.trim(), kind);
    setName("");
    setKind("class");
    await refresh();
  }

  async function move(blockId: string, dir: -1 | 1) {
    const visibleList = blocks.filter((b) => (showHidden ? true : b.isVisible === 1));
    const idx = visibleList.findIndex((b) => b.id === blockId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= visibleList.length) return;

    const ordered = [...visibleList];
    const [item] = ordered.splice(idx, 1);
    ordered.splice(j, 0, item);

    // Reorder only affects the whole list; preserve hidden items relative order by
    // applying new indices in the combined list.
    const combined = [...blocks];
    const byId = new Map(combined.map((b) => [b.id, b] as const));
    const orderedIds = ordered.map((b) => b.id);
    // Append any remaining ids (typically hidden) in their existing order.
    for (const b of combined) if (!orderedIds.includes(b.id)) orderedIds.push(b.id);

    await reorderBlocks(userId, orderedIds);
    setBlocks(orderedIds.map((id, orderIndex) => ({ ...(byId.get(id) as Block), orderIndex })));
  }

  async function toggleVisible(b: Block) {
    await setBlockVisible(userId, b.id, b.isVisible ? 0 : 1);
  }

  async function renameBlock(b: Block, newName: string) {
    const n = newName.trim();
    if (!n || n === b.name) return;
    await updateBlock(userId, b.id, { name: n });
  }

  async function changeKind(b: Block, nextKind: BlockKind) {
    if (nextKind === b.kind) return;
    await updateBlock(userId, b.id, { kind: nextKind });
  }

  async function onDelete(b: Block) {
    const ok = window.confirm(`Delete “${b.name}”?`);
    if (!ok) return;
    await deleteBlock(userId, b.id);
  }

  function visibleList() {
    const list = [...blocks].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    return showHidden ? list : list.filter((b) => b.isVisible === 1);
  }

  async function applyDragReorder(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const list = visibleList();
    const from = list.findIndex((b) => b.id === sourceId);
    const to = list.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;

    const ordered = [...list];
    const [item] = ordered.splice(from, 1);
    ordered.splice(to, 0, item);

    const combined = [...blocks].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    const byId = new Map(combined.map((b) => [b.id, b] as const));
    const orderedIds = ordered.map((b) => b.id);
    for (const b of combined) if (!orderedIds.includes(b.id)) orderedIds.push(b.id);

    await reorderBlocks(userId, orderedIds);
    setBlocks(orderedIds.map((id, orderIndex) => ({ ...(byId.get(id) as Block), orderIndex })));
  }

  return (
    <div className="grid">
      <h1>Blocks</h1>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New block name (e.g., Assembly, Tutor time)"
            style={{ minWidth: 240 }}
          />

          <select value={kind} onChange={(e) => setKind(e.target.value as BlockKind)}>
            {(Object.keys(KIND_LABELS) as BlockKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>

          <button onClick={addBlock} disabled={!canAdd}>
            Add
          </button>

          <label className="row" style={{ gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            <span className="muted">Show hidden</span>
          </label>
        </div>
        <div className="muted" style={{ marginTop: 8 }}>
          Reorder blocks here. Today/Week will follow this order. Hidden blocks won’t display.
        </div>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }} className="muted">Order</th>
              <th style={{ textAlign: "left" }} className="muted">Name</th>
              <th style={{ textAlign: "left" }} className="muted">Kind</th>
              <th style={{ textAlign: "left" }} className="muted">Visible</th>
              <th style={{ textAlign: "left" }} className="muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleList().map((b, i) => (
              <tr
                key={b.id}
                draggable
                onDragStart={() => setDraggingId(b.id)}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(e) => {
                  // allow drop
                  e.preventDefault();
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  if (!draggingId) return;
                  const source = draggingId;
                  setDraggingId(null);
                  await applyDragReorder(source, b.id);
                }}
                style={{ cursor: "grab", opacity: draggingId && draggingId === b.id ? 0.6 : 1 }}
                title="Drag to reorder"
              >
                <td className="muted">{i + 1}</td>

                <td>
                  <input
                    defaultValue={b.name}
                    onBlur={(e) => renameBlock(b, e.target.value)}
                    style={{ minWidth: 220 }}
                  />
                </td>

                <td>
                  <select
                    value={b.kind}
                    onChange={(e) => changeKind(b, e.target.value as BlockKind)}
                    className="muted"
                  >
                    {(Object.keys(KIND_LABELS) as BlockKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </td>

                <td>
                  <button onClick={() => toggleVisible(b)}>{b.isVisible ? "Shown" : "Hidden"}</button>
                </td>

                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <button onClick={() => move(b.id, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button onClick={() => move(b.id, 1)} disabled={i === visibleList().length - 1}>
                      ↓
                    </button>

                    <button
                      onClick={() => onDelete(b)}
                      title="Delete"
                      style={{ marginLeft: 8 }}
                    >
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {visibleList().length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No blocks yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div className="muted" style={{ marginTop: 10 }}>
          Drag and drop rows to reorder.
        </div>
      </div>
    </div>
  );
}