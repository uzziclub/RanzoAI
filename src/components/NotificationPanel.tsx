import { useEffect, useState } from "react";
import { ranzo } from "../bridge";
import type { AppNotification } from "../../shared/types";

const KIND_ICON: Record<string, string> = {
  briefing: "📰", health: "❤", "wrap-up": "🌙", digest: "📅", error: "⚠", info: "•",
};

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    void ranzo.listNotifications().then(setItems);
    void ranzo.markNotificationsRead();
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="clay-card modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 17 }}>Notifications</h2>
            <p className="small muted">One queue for everything — briefings, health, wrap-ups.</p>
          </div>
          <button className="clay-btn subtle" onClick={onClose}>Close</button>
        </div>
        <div className="stack" style={{ maxHeight: 420, overflowY: "auto" }}>
          {items.length === 0 && <p className="small muted">Nothing yet. The morning briefing and any health alerts will show up here.</p>}
          {items.map((n) => (
            <div key={n.id} className="clay-card" style={{ padding: 12, boxShadow: "var(--clay-sm)", opacity: n.read ? 0.75 : 1 }}>
              <div className="row">
                <span>{KIND_ICON[n.kind] ?? "•"}</span>
                <b style={{ fontSize: 13 }}>{n.title}</b>
                <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>
                  {new Date(n.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="small" style={{ marginTop: 4, userSelect: "text" }}>{n.body}</p>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <button className="clay-btn subtle" style={{ marginTop: 12, fontSize: 12 }} onClick={() => void ranzo.clearNotifications().then(() => setItems([]))}>
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
