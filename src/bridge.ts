// Renderer-side access to the desktop bridge. When running in a plain browser
// (dev preview without Electron), a clearly-labeled preview shim is used so the
// UI can be exercised — it never pretends real system work happened.

import type {
  RanzoBridge, AppSettings, AskResponse, ChatMessage, ChatSummary, EngineStatus,
  MemoryItem, SystemInfo, UserAccount, WeatherInfo, ActionLogEntry, DiagnosticsInfo,
  AppNotification, KnowledgeStatus,
} from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/types";

declare global {
  interface Window { ranzo?: RanzoBridge }
}

export const isDesktop = typeof window !== "undefined" && Boolean(window.ranzo);

// ---------------- preview shim (browser-only development) ----------------

function makePreviewShim(): RanzoBridge {
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  let user: UserAccount | null = null;
  const users: (UserAccount & { password: string })[] = [
    { id: "admin", email: "mr304e@gmail.com", name: "Admin", role: "admin", status: "active", createdAt: Date.now(), lastLoginAt: null, password: "itXcritical4me" },
  ];
  const chats: ChatSummary[] = [];
  const messages: Record<string, ChatMessage[]> = {};
  const memories: MemoryItem[] = [];
  let setupDone = localStorage.getItem("preview-setup") === "yes";

  const engineStatus: EngineStatus = {
    ollamaInstalled: false, ollamaRunning: false, modelName: null, modelReady: false,
    state: "not-installed",
    detail: "Browser preview — the local engine only exists in the installed Windows app.",
  };

  return {
    platform: async () => "browser-preview",
    login: async (email, password) => {
      const u = users.find((x) => x.email === email.toLowerCase());
      if (!u) return { ok: false, error: "No account with that email. Check the address or sign up first." };
      if (u.password !== password) return { ok: false, error: "That password isn't right. Try again." };
      if (u.status !== "active") return { ok: false, error: u.status === "blocked" ? "This account has been blocked. Contact the administrator." : "Access for this account has been revoked. Contact the administrator." };
      user = u; return { ok: true, user: u };
    },
    signup: async (email, password, name) => {
      if (password.length < 8) return { ok: false, error: "Password needs at least 8 characters." };
      if (users.some((x) => x.email === email.toLowerCase())) return { ok: false, error: "An account with that email already exists. Log in instead." };
      const u = { id: String(Date.now()), email: email.toLowerCase(), name, role: "user" as const, status: "active" as const, createdAt: Date.now(), lastLoginAt: null, password };
      users.push(u); user = u; return { ok: true, user: u };
    },
    logout: async () => { user = null; },
    currentUser: async () => user,
    adminListUsers: async () => users.map(({ password: _p, ...u }) => u),
    adminSetStatus: async (userId, status) => {
      const u = users.find((x) => x.id === userId);
      if (!u) return { ok: false, error: "User not found." };
      if (u.role === "admin") return { ok: false, error: "The admin account can't be blocked or revoked." };
      u.status = status;
      if (user?.id === userId && status !== "active") user = null;
      return { ok: true };
    },
    isSetupComplete: async () => setupDone,
    completeSetup: async () => { setupDone = true; localStorage.setItem("preview-setup", "yes"); },
    engineStatus: async () => engineStatus,
    startEngine: async () => engineStatus,
    ask: async (chatId, text) => {
      let cid = chatId;
      if (!cid) {
        cid = String(Date.now());
        chats.unshift({ id: cid, title: text.slice(0, 48), createdAt: Date.now(), updatedAt: Date.now(), preview: text, messageCount: 0 });
        messages[cid] = [];
      }
      const um: ChatMessage = { id: `${Date.now()}u`, chatId: cid, role: "user", content: text, createdAt: Date.now() };
      const content = "This is the browser preview, so there's no local brain or system control behind me here. Install the Windows app for the real thing — everything you see is the actual interface, though.";
      const am: ChatMessage = { id: `${Date.now()}a`, chatId: cid, role: "assistant", content, createdAt: Date.now() + 1, provider: "preview", latencyMs: 0, confidence: "local" };
      messages[cid].push(um, am);
      const c = chats.find((x) => x.id === cid)!;
      c.preview = content; c.messageCount = messages[cid].length; c.updatedAt = Date.now();
      return { messageId: am.id, content, provider: "preview", latencyMs: 0, confidence: "local", chatId: cid } as AskResponse & { chatId: string };
    },
    listChats: async () => chats,
    getMessages: async (chatId) => messages[chatId] ?? [],
    deleteChat: async (chatId) => {
      const i = chats.findIndex((c) => c.id === chatId);
      if (i >= 0) chats.splice(i, 1);
      delete messages[chatId];
    },
    clearAllChats: async () => { chats.length = 0; for (const k of Object.keys(messages)) delete messages[k]; },
    confirmAction: async () => ({ messageId: "", content: "Actions only run in the installed Windows app.", provider: "preview", latencyMs: 0, confidence: "local" }),
    actionLog: async () => [] as ActionLogEntry[],
    undoLastAction: async () => ({ ok: false, message: "Nothing to undo in the browser preview." }),
    listMemories: async () => memories,
    addMemory: async (content, category) => {
      const m: MemoryItem = { id: String(Date.now()), content, category, source: "Added manually", createdAt: Date.now(), expiresAt: null, pinned: false };
      memories.unshift(m); return m;
    },
    updateMemory: async (id, content) => { const m = memories.find((x) => x.id === id); if (m) m.content = content; },
    deleteMemory: async (id) => { const i = memories.findIndex((x) => x.id === id); if (i >= 0) memories.splice(i, 1); },
    exportMemories: async () => ({ ok: false, error: "Export works in the installed Windows app." }),
    importMemories: async () => ({ ok: false, error: "Import works in the installed Windows app." }),
    getSettings: async () => settings,
    saveSettings: async (patch) => { settings = { ...settings, ...patch }; return settings; },
    systemInfo: async (): Promise<SystemInfo> => ({
      platform: "browser", cpuName: "Preview environment", totalRamGb: 0, battery: null,
      online: navigator.onLine, hardwareTier: "mid", tierReason: "Browser preview — tiering happens in the installed app.",
    }),
    weather: async (): Promise<WeatherInfo | null> => {
      try {
        const geo = await fetch("https://ipapi.co/json/").then((r) => r.json()) as { city?: string; latitude?: number; longitude?: number };
        if (geo.latitude == null || geo.longitude == null) return null;
        const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code`).then((r) => r.json()) as { current?: { temperature_2m: number; weather_code: number } };
        if (!w.current) return null;
        return { tempC: Math.round(w.current.temperature_2m), code: w.current.weather_code, description: "", city: geo.city ?? "" };
      } catch { return null; }
    },
    diagnostics: async (): Promise<DiagnosticsInfo> => ({
      engine: engineStatus,
      system: { platform: "browser", cpuName: "Preview", totalRamGb: 0, battery: null, online: navigator.onLine, hardwareTier: "mid", tierReason: "Preview" },
      providerLog: [], logTail: ["Browser preview — logs live in the installed app."],
    }),
    exportDiagnostics: async () => ({ ok: false, error: "Works in the installed Windows app." }),
    listNotifications: async (): Promise<AppNotification[]> => [
      { id: "n1", title: "Welcome to the preview", body: "In the installed app, morning briefings, health alerts, and wrap-ups land here.", kind: "info", read: false, at: Date.now() },
    ],
    markNotificationsRead: async () => undefined,
    clearNotifications: async () => undefined,
    knowledgeStatus: async (): Promise<KnowledgeStatus> => ({ folders: [], chunks: 0, indexedAt: 0 }),
    addKnowledgeFolder: async (): Promise<KnowledgeStatus> => ({ folders: [], chunks: 0, indexedAt: 0 }),
    removeKnowledgeFolder: async (): Promise<KnowledgeStatus> => ({ folders: [], chunks: 0, indexedAt: 0 }),
    rebuildKnowledge: async (): Promise<KnowledgeStatus> => ({ folders: [], chunks: 0, indexedAt: 0 }),
    quickCapture: async () => undefined,
    speak: async () => ({ ok: false, error: "Speech synthesis runs in the installed Windows app." }),
    stopSpeaking: async () => undefined,
    setCopilotMode: async () => undefined,
    setMiniMode: async () => undefined,
    restoreMainWindow: async () => undefined,
    quitApp: async () => undefined,
    on: () => () => undefined,
  };
}

export const ranzo: RanzoBridge = isDesktop ? window.ranzo! : makePreviewShim();
