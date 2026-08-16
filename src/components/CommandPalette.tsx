import { useEffect, useRef, useState } from "react";

interface Cmd { label: string; hint: string; run: () => void }

export function CommandPalette({ onClose, onRun, onOpenSettings, onOpenMemory }: {
  onClose: () => void;
  onRun: (cmd: string) => void;
  onOpenSettings: () => void;
  onOpenMemory: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commands: Cmd[] = [
    { label: "Open Settings", hint: "app", run: onOpenSettings },
    { label: "Open Memory Viewer", hint: "app", run: onOpenMemory },
    { label: "Undo last action", hint: "control", run: () => onRun("undo the last action") },
    { label: "Take a screenshot", hint: "control", run: () => onRun("take a screenshot") },
    { label: "Lock the screen", hint: "control", run: () => onRun("lock the screen") },
    { label: "Set volume to 50", hint: "control", run: () => onRun("set volume to 50") },
    { label: "What's on my clipboard?", hint: "memory", run: () => onRun("what's on my clipboard") },
    { label: "What did I copy before this?", hint: "memory", run: () => onRun("what did I copy before this?") },
    { label: "Focus mode", hint: "persona", run: () => onRun("focus mode") },
    { label: "Natural mode", hint: "persona", run: () => onRun("natural mode") },
    { label: "Witty mode", hint: "persona", run: () => onRun("witty mode") },
  ];

  const q = query.trim().toLowerCase();
  const visible = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;

  function submit() {
    if (visible[selected]) visible[selected].run();
    else if (q) onRun(query);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="clay-card" style={{ width: 480, padding: 18, alignSelf: "flex-start", marginTop: 90 }} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="clay-input"
          placeholder="Type a command… (Enter runs, Esc closes)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, visible.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); submit(); }
          }}
        />
        <div className="stack" style={{ marginTop: 10, gap: 4, maxHeight: 300, overflowY: "auto" }}>
          {visible.map((c, i) => (
            <div
              key={c.label}
              className="spread"
              style={{
                padding: "8px 12px", borderRadius: "var(--r-sm)", cursor: "pointer",
                background: i === selected ? "var(--blue-ghost)" : "transparent",
              }}
              onMouseEnter={() => setSelected(i)}
              onClick={() => c.run()}
            >
              <span style={{ fontSize: 13 }}>{c.label}</span>
              <span className="clay-chip" style={{ fontSize: 10 }}>{c.hint}</span>
            </div>
          ))}
          {visible.length === 0 && <p className="small muted" style={{ padding: 8 }}>Press Enter to send "{query}" to Ranzo as-is.</p>}
        </div>
      </div>
    </div>
  );
}
