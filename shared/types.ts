// Shared contracts between the Electron main process and the React renderer.

export type AgentState = "idle" | "listening" | "thinking" | "speaking" | "working" | "starting";

export type PersonaId = "natural" | "professional" | "witty" | "focused" | "custom";

export type ActionTier = "read-only" | "reversible" | "destructive";

export type ProviderId =
  | "ollama"
  | "gemini"
  | "openrouter"
  | "huggingface"
  | "puter"
  | "tavily";

export interface ChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  provider?: string;
  latencyMs?: number;
  confidence?: "local" | "cloud" | "search" | "guess";
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview: string;
  messageCount: number;
}

export interface MemoryItem {
  id: string;
  content: string;
  category: "people" | "projects" | "preferences" | "facts" | "notes" | "other";
  source: string; // "why Ranzo remembers this"
  createdAt: number;
  expiresAt: number | null;
  pinned: boolean;
}

export interface ActionLogEntry {
  id: string;
  description: string;
  tier: ActionTier;
  status: "done" | "undone" | "cancelled" | "failed" | "pending-confirmation";
  undoable: boolean;
  createdAt: number;
  detail?: string;
}

export interface PendingAction {
  id: string;
  description: string;
  tier: ActionTier;
  command: string;
  humanPrompt: string; // e.g. "Delete these 4 files?"
}

export interface EngineStatus {
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  modelName: string | null;
  modelReady: boolean;
  state: "ready" | "starting" | "downloading-model" | "not-installed" | "stopped" | "error";
  detail: string; // plain-language, already translated
}

export interface SystemInfo {
  platform: string;
  cpuName: string;
  totalRamGb: number;
  battery: { percent: number; charging: boolean } | null;
  online: boolean;
  hardwareTier: "low" | "mid" | "high";
  tierReason: string;
}

export interface WeatherInfo {
  tempC: number;
  code: number;
  description: string;
  city: string;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  status: "active" | "revoked" | "blocked";
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AuthResult {
  ok: boolean;
  user?: UserAccount;
  error?: string;
}

export interface AppSettings {
  // Voice
  ttsVoice: string;
  ttsRate: number; // 0.5 - 2
  ttsPitch: number; // -50 - +50 (Hz offset for edge-tts)
  whisperMode: boolean;
  pushToTalkHotkey: string;
  wakeWordSensitivity: number;
  speakReplies: boolean;
  // Language
  language: "auto" | "en" | "ur" | "ar" | "hi";
  languageLock: boolean;
  // AI Providers
  ollamaUrl: string;
  ollamaModel: string;
  forceOffline: boolean;
  geminiKey: string;
  openrouterKey: string;
  huggingfaceKey: string;
  tavilyKey: string;
  picovoiceKey: string;
  // Memory
  memoryEnabled: boolean;
  memoryPaused: boolean;
  // Permissions
  confirmDestructive: boolean; // always true; kept for display
  safeZones: string[]; // paths that always require confirmation
  // Performance
  hardwareTierOverride: "auto" | "low" | "mid" | "high";
  idleModelReleaseMinutes: number;
  // Privacy
  telemetry: boolean; // always false by default, local-only
  // Notifications
  briefingEnabled: boolean;
  briefingHour: number;
  focusSessionUntil: number | null;
  // Shortcuts
  quickCaptureHotkey: string;
  commandPaletteHotkey: string;
  // Advanced
  persona: PersonaId;
  customPersona: string;
  // Licensing
  supabaseUrl: string;
  supabaseAnonKey: string;
  offlineGraceDays: number;
}

export interface RouteDecision {
  target: "local" | "cloud" | "search" | "action" | "memory-command";
  reason: string;
}

export interface AskResponse {
  messageId: string;
  content: string;
  provider: string;
  latencyMs: number;
  confidence: "local" | "cloud" | "search" | "guess";
  pendingAction?: PendingAction;
  error?: string;
}

export interface DiagnosticsInfo {
  engine: EngineStatus;
  system: SystemInfo;
  providerLog: { provider: string; latencyMs: number; at: number; ok: boolean }[];
  logTail: string[];
  /** Names — never values — of secrets baked into this build at compile time. */
  bakedKeys: string[];
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  at: number;
}

export interface KnowledgeStatus {
  folders: string[];
  chunks: number;
  indexedAt: number;
}

// The bridge surface exposed on window.ranzo
export interface RanzoBridge {
  platform: () => Promise<string>;
  // auth
  login(email: string, password: string): Promise<AuthResult>;
  signup(email: string, password: string, name: string): Promise<AuthResult>;
  logout(): Promise<void>;
  currentUser(): Promise<UserAccount | null>;
  adminListUsers(): Promise<UserAccount[]>;
  adminSetStatus(userId: string, status: "active" | "revoked" | "blocked"): Promise<{ ok: boolean; error?: string }>;
  // setup
  isSetupComplete(): Promise<boolean>;
  completeSetup(): Promise<void>;
  // engine
  engineStatus(): Promise<EngineStatus>;
  startEngine(): Promise<EngineStatus>;
  // chat
  ask(chatId: string | null, text: string): Promise<AskResponse>;
  listChats(): Promise<ChatSummary[]>;
  getMessages(chatId: string): Promise<ChatMessage[]>;
  deleteChat(chatId: string): Promise<void>;
  clearAllChats(): Promise<void>;
  // actions
  confirmAction(actionId: string, approved: boolean, chatId?: string | null): Promise<AskResponse>;
  actionLog(): Promise<ActionLogEntry[]>;
  undoLastAction(): Promise<{ ok: boolean; message: string }>;
  // memory
  listMemories(): Promise<MemoryItem[]>;
  addMemory(content: string, category: MemoryItem["category"]): Promise<MemoryItem>;
  updateMemory(id: string, content: string): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  exportMemories(): Promise<{ ok: boolean; path?: string; error?: string }>;
  importMemories(): Promise<{ ok: boolean; count?: number; error?: string }>;
  // settings
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  // system
  systemInfo(): Promise<SystemInfo>;
  weather(): Promise<WeatherInfo | null>;
  diagnostics(): Promise<DiagnosticsInfo>;
  exportDiagnostics(): Promise<{ ok: boolean; path?: string; error?: string }>;
  // voice
  speak(text: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }>;
  previewVoice(voiceId: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }>;
  stopSpeaking(): Promise<void>;
  // notifications
  listNotifications(): Promise<AppNotification[]>;
  markNotificationsRead(): Promise<void>;
  clearNotifications(): Promise<void>;
  // knowledge base
  knowledgeStatus(): Promise<KnowledgeStatus>;
  addKnowledgeFolder(): Promise<KnowledgeStatus>;
  removeKnowledgeFolder(path: string): Promise<KnowledgeStatus>;
  rebuildKnowledge(): Promise<KnowledgeStatus>;
  // quick capture
  quickCapture(text: string): Promise<void>;
  // windows
  setCopilotMode(on: boolean): Promise<void>;
  setMiniMode(on: boolean): Promise<void>;
  restoreMainWindow(): Promise<void>;
  quitApp(): Promise<void>;
  // events
  on(channel: "agent-state" | "engine-status" | "notification", cb: (payload: unknown) => void): () => void;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ttsVoice: "en-US-AndrewMultilingualNeural",
  ttsRate: 1,
  ttsPitch: 0,
  whisperMode: false,
  pushToTalkHotkey: "Ctrl+Space",
  wakeWordSensitivity: 0.5,
  speakReplies: true,
  language: "auto",
  languageLock: false,
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3.1:8b-instruct-q4_K_M",
  forceOffline: false,
  geminiKey: "",
  openrouterKey: "",
  huggingfaceKey: "",
  tavilyKey: "",
  picovoiceKey: "",
  memoryEnabled: true,
  memoryPaused: false,
  confirmDestructive: true,
  safeZones: [],
  hardwareTierOverride: "auto",
  idleModelReleaseMinutes: 15,
  telemetry: false,
  briefingEnabled: true,
  briefingHour: 8,
  focusSessionUntil: null,
  quickCaptureHotkey: "Ctrl+Shift+Space",
  commandPaletteHotkey: "Ctrl+K",
  persona: "natural",
  customPersona: "",
  supabaseUrl: "",
  supabaseAnonKey: "",
  offlineGraceDays: 7,
};
