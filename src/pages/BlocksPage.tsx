// src/pages/BlocksPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { Block, BlockKind } from "../db/db";
import { ensureDefaultBlocks } from "../db/seed";
import { getVisibleBlocks } from "../db/blockQueries";
import { createBlock, reorderBlocks, setBlockVisible, updateBlock } from "../db/blockMutations";


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

  async function refresh() {
    await ensureDefaultBlocks(userId);
    setBlocks(await getVisibleBlocks(userId));
  }

  useEffect(() => {
    refresh();
  }, []);

  const canAdd = useMemo(() => name.trim().length > 0, [name]);

  async function addBlock() {
    if (!canAdd) return;
    await createBlock(userId, name.trim(), kind);
    setName("");
    setKind("class");
    await refresh();
  }

  async function move(blockId: string, dir: -1 | 1) {
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= blocks.length) return;

    const ordered = [...blocks];
    const [item] = ordered.splice(idx, 1);
    ordered.splice(j, 0, item);

    await reorderBlocks(userId, ordered.map((b) => b.id));
    setBlocks(ordered.map((b, i) => ({ ...b, orderIndex: i })));
  }

  async function toggleVisible(b: Block) {
    await setBlockVisible(b.id, b.isVisible ? 0 : 1);
    await refresh();
  }

  async function renameBlock(b: Block, newName: string) {
    const n = newName.trim();
    if (!n || n === b.name) return;
    await updateBlock({ ...b, name: n });
    await refresh();
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
            {blocks.map((b, i) => (
              <tr key={b.id}>
                <td className="muted">{i + 1}</td>

                <td>
                  <input
                    defaultValue={b.name}
                    onBlur={(e) => renameBlock(b, e.target.value)}
                    style={{ minWidth: 220 }}
                  />
                </td>

                <td className="muted">{KIND_LABELS[b.kind]}</td>

                <td>
                  <button onClick={() => toggleVisible(b)}>{b.isVisible ? "Shown" : "Hidden"}</button>
                </td>

                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <button onClick={() => move(b.id, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button onClick={() => move(b.id, 1)} disabled={i === blocks.length - 1}>
                      ↓
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {blocks.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No blocks yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}