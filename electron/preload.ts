import { contextBridge, ipcRenderer } from "electron";

// Narrow, promise-based bridge. The renderer never gets Node or shell access.
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("ranzo", {
  platform: () => invoke("app:platform"),
  // auth
  login: (email: string, password: string) => invoke("auth:login", email, password),
  signup: (email: string, password: string, name: string) => invoke("auth:signup", email, password, name),
  logout: () => invoke("auth:logout"),
  currentUser: () => invoke("auth:current"),
  adminListUsers: () => invoke("auth:admin-list"),
  adminSetStatus: (userId: string, status: string) => invoke("auth:admin-set-status", userId, status),
  // setup
  isSetupComplete: () => invoke("setup:is-complete"),
  completeSetup: () => invoke("setup:complete"),
  // engine
  engineStatus: () => invoke("engine:status"),
  startEngine: () => invoke("engine:start"),
  // chat
  ask: (chatId: string | null, text: string) => invoke("chat:ask", chatId, text),
  listChats: () => invoke("chat:list"),
  getMessages: (chatId: string) => invoke("chat:messages", chatId),
  deleteChat: (chatId: string) => invoke("chat:delete", chatId),
  clearAllChats: () => invoke("chat:clear-all"),
  // actions
  confirmAction: (actionId: string, approved: boolean, chatId?: string | null) => invoke("action:confirm", actionId, approved, chatId ?? null),
  actionLog: () => invoke("action:log"),
  undoLastAction: () => invoke("action:undo-last"),
  // memory
  listMemories: () => invoke("memory:list"),
  addMemory: (content: string, category: string) => invoke("memory:add", content, category),
  updateMemory: (id: string, content: string) => invoke("memory:update", id, content),
  deleteMemory: (id: string) => invoke("memory:delete", id),
  exportMemories: () => invoke("memory:export"),
  importMemories: () => invoke("memory:import"),
  // settings
  getSettings: () => invoke("settings:get"),
  saveSettings: (patch: unknown) => invoke("settings:save", patch),
  // system
  systemInfo: () => invoke("system:info"),
  weather: () => invoke("system:weather"),
  diagnostics: () => invoke("system:diagnostics"),
  exportDiagnostics: () => invoke("system:export-diagnostics"),
  // voice
  speak: (text: string) => invoke("voice:speak", text),
  stopSpeaking: () => invoke("voice:stop"),
  // notifications
  listNotifications: () => invoke("notify:list"),
  markNotificationsRead: () => invoke("notify:mark-read"),
  clearNotifications: () => invoke("notify:clear"),
  // knowledge base
  knowledgeStatus: () => invoke("knowledge:status"),
  addKnowledgeFolder: () => invoke("knowledge:add-folder"),
  removeKnowledgeFolder: (path: string) => invoke("knowledge:remove-folder", path),
  rebuildKnowledge: () => invoke("knowledge:rebuild"),
  // quick capture
  quickCapture: (text: string) => invoke("capture:save", text),
  // windows
  setCopilotMode: (on: boolean) => invoke("window:copilot", on),
  setMiniMode: (on: boolean) => invoke("window:mini", on),
  restoreMainWindow: () => invoke("window:restore"),
  quitApp: () => invoke("app:quit"),
  // events
  on: (channel: string, cb: (payload: unknown) => void) => {
    const allowed = ["agent-state", "engine-status", "notification"];
    if (!allowed.includes(channel)) return () => undefined;
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
