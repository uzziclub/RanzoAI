import { useEffect, useState } from "react";
import { ranzo } from "../bridge";
import type { MemoryItem } from "../../shared/types";

const CATEGORIES: (MemoryItem["category"] | "all")[] = ["all", "people", "projects", "preferences", "facts", "notes", "other"];

export function MemoryViewer({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [filter, setFilter] = useState<(typeof CATEGORIES)[number]>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newText, setNewText] = useState("");
  const [newCat, setNewCat] = useState<MemoryItem["category"]>("facts");

  const refresh = () => void ranzo.listMemories().then(setItems);
  useEffect(refresh, []);

  const visible = filter === "all" ? items : items.filter((m) => m.category === filter);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="clay-card modal" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18 }}>Memory Viewer</h2>
            <p className="small muted">Everything Ranzo remembers, in plain sight. Edit or delete anything.</p>
          </div>
          <button className="clay-btn subtle" onClick={onClose}>Close</button>
        </div>

        <div className="tab-row" style={{ marginBottom: 14 }}>
          {CATEGORIES.map((c) => (
            <button key={c} className={`clay-btn ${filter === c ? "on" : "subtle"}`} style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setFilter(c)}>
              {c}{c !== "all" && ` (${items.filter((m) => m.category === c).length})`}
            </button>
          ))}
        </div>

        <form
          className="row"
          style={{ marginBottom: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!newText.trim()) return;
            void ranzo.addMemory(newText.trim(), newCat).then(() => { setNewText(""); refresh(); });
          }}
        >
          <input className="clay-input" placeholder="Add something Ranzo should remember…" value={newText} onChange={(e) => setNewText(e.target.value)} />
          <select className="clay-input" style={{ width: 140 }} value={newCat} onChange={(e) => setNewCat(e.target.value as MemoryItem["category"])}>
            {CATEGORIES.filter((c) => c !== "all").map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="clay-btn primary" type="submit">Add</button>
        </form>

        <div className="stack" style={{ maxHeight: 380, overflowY: "auto" }}>
          {visible.length === 0 && <p className="muted small">Nothing here yet. Ranzo remembers useful facts automatically as you talk — or add one above.</p>}
          {visible.map((m) => (
            <div key={m.id} className="clay-card" style={{ padding: 14, boxShadow: "var(--clay-sm)" }}>
              {editing === m.id ? (
                <div className="row">
                  <input className="clay-input" value={editText} onChange={(e) => setEditText(e.target.value)} autoFocus />
                  <button className="clay-btn primary" onClick={() => void ranzo.updateMemory(m.id, editText).then(() => { setEditing(null); refresh(); })}>Save</button>
                  <button className="clay-btn subtle" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="spread">
                    <span style={{ userSelect: "text" }}>{m.content}</span>
                    <div className="row" style={{ flexShrink: 0 }}>
                      <button className="clay-btn subtle" style={{ padding: "3px 9px", fontSize: 11 }} onClick={() => { setEditing(m.id); setEditText(m.content); }}>Edit</button>
                      <button className="clay-btn danger" style={{ padding: "3px 9px", fontSize: 11 }} onClick={() => void ranzo.deleteMemory(m.id).then(refresh)}>Forget</button>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 6, gap: 8 }}>
                    <span className="clay-chip" style={{ fontSize: 10.5 }}>{m.category}</span>
                    <span className="muted" style={{ fontSize: 10.5 }}>{m.source}</span>
                    <span className="muted" style={{ fontSize: 10.5 }}>{new Date(m.createdAt).toLocaleDateString()}</span>
                    {m.expiresAt && <span className="muted" style={{ fontSize: 10.5 }}>expires {new Date(m.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
