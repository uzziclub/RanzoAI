import { useCallback, useEffect, useRef, useState } from "react";
import { ranzo, isDesktop } from "../bridge";
import type {
  AgentState, AskResponse, ChatMessage, ChatSummary, EngineStatus,
  PendingAction, SystemInfo, UserAccount, WeatherInfo,
} from "../../shared/types";
import { useVoice } from "../hooks/useVoice";
import { SettingsModal } from "./SettingsModal";
import { MemoryViewer } from "./MemoryViewer";
import { AdminPanel } from "./AdminPanel";
import { CommandPalette } from "../components/CommandPalette";
import { NotificationPanel } from "../components/NotificationPanel";
import logo from "../../resources/icon-256.png";

type Modal = "none" | "settings" | "memory" | "admin" | "notifications";

export function MainShell({ user, onLogout }: { user: UserAccount; onLogout: () => void }) {
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [weather, setWeather] = useState<WeatherInfo | null>(null);
  const [clock, setClock] = useState(new Date());
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [modal, setModal] = useState<Modal>("none");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [unread, setUnread] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const micNoticeShown = useRef(false);

  const voice = useVoice({
    onTranscript: (text) => void send(text),
    onStateChange: (s) => setAgentState(s),
  });

  // ---------- data loading ----------
  const refreshChats = useCallback(async () => setChats(await ranzo.listChats()), []);

  useEffect(() => {
    void refreshChats();
    void ranzo.engineStatus().then(setEngine);
    void ranzo.systemInfo().then(setSys);
    void ranzo.weather().then(setWeather);
    void ranzo.getSettings().then((s) => setSpeakReplies(s.speakReplies));
    const clockTimer = setInterval(() => setClock(new Date()), 10_000);
    const sysTimer = setInterval(() => { void ranzo.systemInfo().then(setSys); }, 60_000);
    // Weather refreshes every 30 minutes; the row hides itself when offline.
    const weatherTimer = setInterval(() => { void ranzo.weather().then(setWeather); }, 30 * 60_000);
    void ranzo.listNotifications().then((ns) => setUnread(ns.filter((n) => !n.read).length));
    const offEngine = ranzo.on("engine-status", (s) => setEngine(s as EngineStatus));
    const offState = ranzo.on("agent-state", (s) => setAgentState(s as AgentState));
    const offNotify = ranzo.on("notification", () => setUnread((u) => u + 1));
    return () => { clearInterval(clockTimer); clearInterval(sysTimer); clearInterval(weatherTimer); offEngine(); offState(); offNotify(); };
  }, [refreshChats]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // keyboard: Ctrl+K palette, Ctrl+Space push-to-talk.
  // Re-registered every render so the handlers never see stale voice state,
  // and releasing either Ctrl or Space (in any order) stops the mic.
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
      if (e.ctrlKey && e.code === "Space" && !e.repeat) { e.preventDefault(); handleMicDown(); }
    }
    function up(e: KeyboardEvent) {
      if (e.code === "Space" || e.key === "Control") { handleMicUp(); }
      if (e.key === "Escape") { setPaletteOpen(false); setModal("none"); }
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  function showMicUnavailable() {
    if (!micNoticeShown.current) {
      micNoticeShown.current = true;
      setNotice("The microphone isn't available here, so I've switched to text-only. Everything else keeps working.");
      setTimeout(() => setNotice(null), 6000);
    }
  }

  function handleMicDown() {
    if (voice.micAvailable === false) { showMicUnavailable(); return; }
    if (!voice.listening) {
      const ok = voice.startListening(false);
      if (!ok) showMicUnavailable(); else setMicOn(true);
    }
  }
  function handleMicUp() {
    if (voice.listening && !voice.liveMode) { voice.stopListening(); setMicOn(false); }
  }

  // ---------- chat ----------
  async function openChat(id: string) {
    setActiveChat(id);
    setMessages(await ranzo.getMessages(id));
  }

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    setBusy(true);
    setPending(null);
    setAgentState("thinking");
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, chatId: activeChat ?? "", role: "user", content: clean, createdAt: Date.now() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = (await ranzo.ask(activeChat, clean)) as AskResponse & { chatId?: string };
      const cid = res.chatId ?? activeChat;
      if (cid) {
        setActiveChat(cid);
        setMessages(await ranzo.getMessages(cid));
      }
      if (res.pendingAction) setPending(res.pendingAction);
      await refreshChats();
      if (speakReplies && !res.pendingAction && res.content.length < 600) {
        void voice.speak(res.content);
      }
    } catch {
      // The bridge itself failed (should be rare — errors are normally
      // translated into a reply). Say so plainly instead of going silent.
      setMessages((m) => [...m, {
        id: `err-${Date.now()}`, chatId: activeChat ?? "", role: "assistant",
        content: "Something went wrong getting that answer through. Try once more — if it keeps happening, check Settings → Advanced & Diagnostics.",
        createdAt: Date.now(), provider: "error",
      }]);
    } finally {
      setBusy(false);
      setAgentState("idle");
    }
  }

  async function confirmAction(approved: boolean) {
    if (!pending) return;
    const p = pending;
    setPending(null);
    setAgentState("working");
    const res = await ranzo.confirmAction(p.id, approved, activeChat);
    if (activeChat) {
      // The outcome is persisted server-side; reload so the id is real.
      setMessages(await ranzo.getMessages(activeChat));
    }
    setAgentState("idle");
    if (speakReplies) void voice.speak(res.content);
  }

  // ---------- header widgets ----------
  const timeStr = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = clock.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  const engineBadge = engine
    ? engine.state === "ready" ? { cls: "ok", label: "Brain ready" }
      : engine.state === "downloading-model" ? { cls: "warn", label: "Downloading model" }
        : engine.state === "starting" ? { cls: "warn", label: "Starting engine" }
          : { cls: "bad", label: engine.state === "not-installed" ? "Engine not installed" : "Engine off" }
    : { cls: "warn", label: "Checking…" };

  const stateLabel: Record<AgentState, string> = {
    idle: "Idle", listening: "Listening", thinking: "Thinking", speaking: "Speaking", working: "Working", starting: "Starting",
  };

  return (
    <div className={`shell ${sys?.hardwareTier === "low" ? "low-tier" : ""}`}>
      {/* ---------------- left sidebar ---------------- */}
      <div className="col clay-card sidebar-left">
        <div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{timeStr}</div>
          <div className="small muted">{dateStr}</div>
        </div>

        {weather && (
          <div className="clay-card" style={{ padding: "10px 14px", boxShadow: "var(--clay-sm)" }}>
            <div style={{ fontWeight: 700 }}>{weather.tempC}°C {weather.description && `· ${weather.description}`}</div>
            <div className="small muted">{weather.city}</div>
          </div>
        )}

        {sys && (
          <div className="stack small" style={{ gap: 6 }}>
            <div className="row"><span className={`badge-dot ${sys.online ? "ok" : "warn"}`} />{sys.online ? "Online" : "Offline — local brain only"}</div>
            {sys.battery && <div className="row"><span className="badge-dot ok" />Battery {sys.battery.percent}%{sys.battery.charging ? " (charging)" : ""}</div>}
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>{sys.cpuName}</div>
            <div className="clay-chip" style={{ alignSelf: "flex-start" }}>{sys.hardwareTier} tier</div>
          </div>
        )}

        <div className="clay-card" style={{ padding: "10px 14px", boxShadow: "var(--clay-sm)" }}>
          <div className="row">
            <span className={`badge-dot ${engineBadge.cls}`} />
            <b className="small">{engineBadge.label}</b>
          </div>
          {engine && engine.state !== "ready" && (
            <>
              <p className="muted" style={{ fontSize: 11, margin: "6px 0" }}>{engine.detail}</p>
              {engine.state !== "downloading-model" && engine.state !== "starting" && (
                <button className="clay-btn small" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => { void ranzo.startEngine().then(setEngine); }}>
                  Start engine
                </button>
              )}
            </>
          )}
        </div>

        <div className="clay-chip" style={{ alignSelf: "flex-start" }}>
          <span className={`badge-dot ${agentState === "idle" ? "ok" : "warn"}`} /> {stateLabel[agentState]}
        </div>

        <div style={{ flex: 1 }} />

        <div className="stack" style={{ gap: 8 }}>
          {user.role === "admin" && (
            <button className="clay-btn subtle" onClick={() => setModal("admin")}>Manage users</button>
          )}
          <button className="clay-btn subtle" onClick={() => { setModal("notifications"); setUnread(0); }}>
            Notifications{unread > 0 ? ` (${unread})` : ""}
          </button>
          <button className="clay-btn subtle" onClick={() => setModal("memory")}>Memory Viewer</button>
          <div className="spread">
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{user.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>{user.role === "admin" ? "Administrator" : "Member"}</div>
            </div>
            <button className="clay-btn" title="Settings" onClick={() => setModal("settings")} style={{ padding: "8px 12px" }}>⚙</button>
          </div>
          <button className="clay-btn subtle small" style={{ fontSize: 12 }} onClick={onLogout}>Log out</button>
        </div>
      </div>

      {/* ---------------- center column ---------------- */}
      <div className="col" style={{ alignItems: "stretch" }}>
        <div className="orb-wrap" style={{ paddingTop: 8 }}>
          <div className={`orb ${agentState}`} title={stateLabel[agentState]} />
          <div className={`wave ${agentState === "speaking" || agentState === "listening" ? "active" : ""}`} aria-hidden>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button
              className={`clay-btn ${micOn || voice.listening ? "on" : ""}`}
              onMouseDown={handleMicDown}
              onMouseUp={handleMicUp}
              onMouseLeave={handleMicUp}
              title="Push to talk — hold this button or Ctrl+Space"
            >
              🎙 Mic
            </button>
            <button
              className={`clay-btn ${voice.liveMode ? "on" : ""}`}
              onClick={() => {
                if (voice.micAvailable === false) { showMicUnavailable(); return; }
                voice.toggleLive();
              }}
              title="Live mode — keeps listening until you turn it off"
            >
              ⦿ Live
            </button>
            <button
              className="clay-btn"
              onClick={() => { void ranzo.setCopilotMode(true); }}
              title="Copilot mode — minimizes Ranzo to a floating bar on top of the screen"
            >
              ▣ Copilot
            </button>
          </div>
        </div>

        {notice && (
          <div className="clay-card" style={{ padding: "10px 16px", boxShadow: "var(--clay-sm)", background: "var(--blue-ghost)" }}>
            <span className="small">{notice}</span>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", marginTop: 40 }} className="muted">
              <img src={logo} width={40} height={40} style={{ borderRadius: 12, opacity: 0.7 }} alt="" />
              <p style={{ marginTop: 10 }}>Ask me anything, or tell me to do something —<br />"open notepad", "set volume to 40", "what's the latest on…"</p>
              <p className="small" style={{ marginTop: 8 }}>Hold <kbd>Ctrl</kbd>+<kbd>Space</kbd> to talk · <kbd>Ctrl</kbd>+<kbd>K</kbd> for commands</p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.content}
              {m.role === "assistant" && m.provider && m.provider !== "preview" && (
                <div className="meta">
                  {m.confidence === "local" && "answered locally"}
                  {m.confidence === "cloud" && "answered via free cloud"}
                  {m.confidence === "search" && "checked the live web"}
                  {m.confidence === "guess" && "best effort — couldn't verify"}
                  {m.latencyMs != null && m.latencyMs > 0 && ` · ${(m.latencyMs / 1000).toFixed(1)}s`}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="bubble assistant muted">…</div>}
          {pending && (
            <div className="bubble assistant" style={{ background: "var(--blue-ghost)" }}>
              <b>{pending.humanPrompt || `Confirm: ${pending.description}?`}</b>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="clay-btn primary" onClick={() => void confirmAction(true)}>Yes, do it</button>
                <button className="clay-btn subtle" onClick={() => void confirmAction(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void send(input); }}
          className="row"
          style={{ gap: 10 }}
        >
          <input
            className="clay-input"
            placeholder="Type to Ranzo…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button className="clay-btn primary" type="submit" disabled={busy || !input.trim()}>Send</button>
        </form>
      </div>

      {/* ---------------- right sidebar ---------------- */}
      <div className="col clay-card sidebar-right">
        <div className="spread">
          <h3 style={{ fontSize: 15 }}>History</h3>
          <button
            className="clay-btn subtle"
            style={{ padding: "5px 10px", fontSize: 12 }}
            onClick={() => { setActiveChat(null); setMessages([]); setPending(null); }}
          >
            + New
          </button>
        </div>
        <div className="list-scroll">
          {chats.length === 0 && <p className="small muted">No conversations yet.</p>}
          {chats.map((c) => (
            <div key={c.id} className={`chat-preview ${c.id === activeChat ? "active" : ""}`} onClick={() => void openChat(c.id)}>
              <div className="spread">
                <b style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</b>
                <button
                  className="clay-btn subtle"
                  style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void ranzo.deleteChat(c.id).then(() => {
                      if (activeChat === c.id) { setActiveChat(null); setMessages([]); }
                      void refreshChats();
                    });
                  }}
                  title="Delete this chat"
                >
                  ✕
                </button>
              </div>
              <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.preview}</div>
              <div className="muted" style={{ fontSize: 10 }}>{new Date(c.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {c.messageCount} messages</div>
            </div>
          ))}
        </div>
        {chats.length > 0 && (
          <button
            className="clay-btn danger"
            style={{ fontSize: 12 }}
            onClick={() => {
              if (window.confirm("Clear all chat history? This can't be undone.")) {
                void ranzo.clearAllChats().then(() => { setChats([]); setActiveChat(null); setMessages([]); });
              }
            }}
          >
            Clear all history
          </button>
        )}
        <button className="clay-btn subtle" style={{ fontSize: 12 }} onClick={() => { void ranzo.setMiniMode(true); }}>
          ○ Mini mode
        </button>
      </div>

      {/* ---------------- modals ---------------- */}
      {modal === "settings" && <SettingsModal onClose={() => setModal("none")} onSpeakRepliesChange={setSpeakReplies} />}
      {modal === "memory" && <MemoryViewer onClose={() => setModal("none")} />}
      {modal === "admin" && user.role === "admin" && <AdminPanel onClose={() => setModal("none")} />}
      {modal === "notifications" && <NotificationPanel onClose={() => setModal("none")} />}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onRun={(cmd) => { setPaletteOpen(false); void send(cmd); }}
          onOpenSettings={() => { setPaletteOpen(false); setModal("settings"); }}
          onOpenMemory={() => { setPaletteOpen(false); setModal("memory"); }}
        />
      )}
      {!isDesktop && (
        <div style={{ position: "fixed", bottom: 10, left: "50%", transform: "translateX(-50%)", zIndex: 40 }}>
          <span className="clay-chip">Browser preview — install the Windows app for voice & system control</span>
        </div>
      )}
    </div>
  );
}
