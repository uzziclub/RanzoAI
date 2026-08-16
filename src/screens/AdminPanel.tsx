import { useEffect, useState } from "react";
import { ranzo } from "../bridge";
import type { UserAccount } from "../../shared/types";

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [note, setNote] = useState("");

  const refresh = () => void ranzo.adminListUsers().then(setUsers);
  useEffect(refresh, []);

  async function setStatus(u: UserAccount, status: "active" | "revoked" | "blocked") {
    const res = await ranzo.adminSetStatus(u.id, status);
    if (!res.ok) { setNote(res.error ?? "Couldn't update that account."); return; }
    setNote(`${u.email} is now ${status}.`);
    refresh();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="clay-card modal" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18 }}>User access</h2>
            <p className="small muted">Grant, revoke, or block access. Blocked and revoked accounts can't use Ranzo at all.</p>
          </div>
          <button className="clay-btn subtle" onClick={onClose}>Close</button>
        </div>
        {note && <p className="small" style={{ marginBottom: 10, color: "var(--blue-deep)", fontWeight: 600 }}>{note}</p>}
        <div className="stack" style={{ maxHeight: 420, overflowY: "auto" }}>
          {users.map((u) => (
            <div key={u.id} className="clay-card spread" style={{ padding: 14, boxShadow: "var(--clay-sm)" }}>
              <div>
                <b>{u.name}</b> <span className="muted small">{u.email}</span>
                <div className="row" style={{ marginTop: 4, gap: 6 }}>
                  <span className="clay-chip" style={{ fontSize: 10.5 }}>{u.role}</span>
                  <span className="clay-chip" style={{ fontSize: 10.5, background: u.status === "active" ? "var(--good)" : "var(--bad)" }}>{u.status}</span>
                  {u.lastLoginAt && <span className="muted" style={{ fontSize: 10.5 }}>last login {new Date(u.lastLoginAt).toLocaleDateString()}</span>}
                </div>
              </div>
              {u.role !== "admin" && (
                <div className="row" style={{ flexShrink: 0 }}>
                  {u.status !== "active" && <button className="clay-btn primary" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => void setStatus(u, "active")}>Allow</button>}
                  {u.status !== "revoked" && <button className="clay-btn" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => void setStatus(u, "revoked")}>Revoke</button>}
                  {u.status !== "blocked" && <button className="clay-btn danger" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => void setStatus(u, "blocked")}>Block</button>}
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          With a Supabase project configured under Settings → AI Providers → Licensing, these changes sync centrally and apply to users on any machine the next time they're online.
        </p>
      </div>
    </div>
  );
}
