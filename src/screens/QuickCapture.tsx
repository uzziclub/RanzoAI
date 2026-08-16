// Quick Capture — tiny always-on-top note box (global hotkey Ctrl+Shift+Space).
// The entry is timestamped and filed straight into memory as a note.

import { useEffect, useRef, useState } from "react";
import { ranzo } from "../bridge";

export function QuickCapture() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function save() {
    void ranzo.quickCapture(text);
    setText("");
  }

  return (
    <div style={{ padding: 8 }}>
      <div className="clay-card" style={{ padding: 16 }}>
        <label className="field-label">Quick capture — saved straight into memory</label>
        <div className="row">
          <input
            ref={inputRef}
            className="clay-input"
            placeholder="Type a thought, Enter to save, Esc to close…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") void ranzo.quickCapture("");
            }}
          />
          <button className="clay-btn primary" onClick={save} disabled={!text.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
