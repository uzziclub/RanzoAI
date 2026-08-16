import { useState } from "react";
import { ranzo } from "../bridge";
import type { UserAccount } from "../../shared/types";
import logo from "../../resources/icon-256.png";

export function AuthScreen({ onAuthed }: { onAuthed: (u: UserAccount) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res = mode === "login"
      ? await ranzo.login(email.trim(), password)
      : await ranzo.signup(email.trim(), password, name);
    setBusy(false);
    if (!res.ok || !res.user) { setError(res.error ?? "Something went wrong."); return; }
    onAuthed(res.user);
  }

  return (
    <div className="center-screen">
      <div className="clay-card" style={{ width: 380, padding: 34 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <img src={logo} alt="Ranzo AI" width={72} height={72} style={{ borderRadius: 24 }} />
          <h1 style={{ fontSize: 22, marginTop: 10 }}>Ranzo AI</h1>
          <p className="muted small">Your computer, your assistant. Everything stays on your machine.</p>
        </div>
        <form className="stack" onSubmit={submit}>
          {mode === "signup" && (
            <input className="clay-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          )}
          <input className="clay-input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={mode === "login"} />
          <input className="clay-input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <p className="small" style={{ color: "#b0524d" }}>{error}</p>}
          <button className="clay-btn primary" type="submit" disabled={busy}>
            {busy ? "One moment…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
        <p className="small muted" style={{ textAlign: "center", marginTop: 16 }}>
          {mode === "login" ? (
            <>New here?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); setError(""); }} style={{ color: "var(--blue-deep)", fontWeight: 700 }}>Create an account</a>
            </>
          ) : (
            <>Already have an account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); setError(""); }} style={{ color: "var(--blue-deep)", fontWeight: 700 }}>Log in</a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
