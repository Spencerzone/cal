// src/pages/ItemsPage.tsx
import { useEffect, useMemo, useState } from "react";
import type { Item, ItemType } from "../db/db";
import { ensureItemsForTemplates } from "../db/seedItemsFromTemplates";
import { getItemsByUser, upsertItem } from "../db/itemQueries";

const userId = "local";

const TYPE_LABEL: Record<ItemType, string> = {
  class: "Class",
  duty: "Duty",
  break: "Break",
  event: "Event",
  other: "Other",
};

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [filter, setFilter] = useState<ItemType | "all">("all");
  const [q, setQ] = useState("");

  async function refresh() {
    await ensureItemsForTemplates(userId);
    const all = await getItemsByUser(userId);
    setItems(all);
  }

  useEffect(() => {
    refresh();
  }, []);

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items
      .filter((it) => (filter === "all" ? true : it.type === filter))
      .filter((it) => (query ? it.title.toLowerCase().includes(query) : true))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.title.localeCompare(b.title);
      });
  }, [items, filter, q]);

  async function saveItem(next: Item) {
    await upsertItem(next);
    setItems((prev) => prev.map((p) => (p.id === next.id ? next : p)));
  }

  return (
    <div className="grid">
      <h1>Items</h1>

      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option value="all">All</option>
            <option value="class">Classes</option>
            <option value="duty">Duties</option>
            <option value="break">Breaks</option>
            <option value="event">Events</option>
            <option value="other">Other</option>
          </select>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            style={{ minWidth: 220 }}
          />

          <button onClick={refresh}>Refresh</button>
        </div>

        <div className="muted" style={{ marginTop: 8 }}>
          Renaming/recolouring updates the item everywhere it appears.
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
              <th style={{ textAlign: "left", width: 120 }} className="muted">
                Type
              </th>
              <th style={{ textAlign: "left", width: 120 }} className="muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((it) => (
              <tr key={it.id}>
                <td style={{ verticalAlign: "top" }}>
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    {/* Swatch */}
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: it.color || "#0f0f0f",
                        border: "1px solid rgba(255,255,255,0.15)",
                      }}
                      title={it.color}
                    />
                    {/* Picker */}
                    <input
                      type="color"
                      value={normaliseToHex(it.color) ?? "#3b82f6"}
                      onChange={(e) => saveItem({ ...it, color: e.target.value })}
                      aria-label="Pick colour"
                      style={{ width: 42, height: 32 }}
                    />
                  </div>
                </td>

                <td style={{ verticalAlign: "top" }}>
                  <input
                    defaultValue={it.title}
                    onBlur={(e) => {
                      const nextTitle = e.target.value.trim();
                      if (!nextTitle || nextTitle === it.title) return;
                      saveItem({ ...it, title: nextTitle });
                    }}
                    style={{ minWidth: 260 }}
                  />
                </td>

                <td style={{ verticalAlign: "top" }} className="muted">
                  {TYPE_LABEL[it.type]}
                </td>

                <td style={{ verticalAlign: "top" }}>
                  <button
                    onClick={() => {
                      // quick reset: regenerate a colour by clearing then refresh seed won't overwrite,
                      // so just set to a sensible default.
                      saveItem({ ...it, color: "#0f0f0f" });
                    }}
                  >
                    Reset
                  </button>
                </td>
              </tr>
            ))}

            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No items found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Your seed currently uses `hsl(...)`. <input type="color"> only accepts hex.
// This converts `hsl(...)` to null (so we fall back) unless you switch seed to hex.
function normaliseToHex(color: string | undefined): string | null {
  if (!color) return null;
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) return color;
  return null;
}