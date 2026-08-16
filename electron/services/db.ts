// Local SQLite storage using Node's built-in sqlite module (no native compilation needed).
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  ChatMessage,
  ChatSummary,
  MemoryItem,
  ActionLogEntry,
  UserAccount,
} from "../../shared/types";

let db: DatabaseSync;

export function initDb(userDataDir: string) {
  mkdirSync(userDataDir, { recursive: true });
  db = new DatabaseSync(join(userDataDir, "ranzo.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      provider TEXT,
      latency_ms INTEGER,
      confidence TEXT
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      source TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS actions (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      undoable INTEGER NOT NULL DEFAULT 0,
      undo_command TEXT,
      created_at INTEGER NOT NULL,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS provider_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS response_cache (
      question_hash TEXT PRIMARY KEY,
      answer TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clipboard_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'info',
      read INTEGER NOT NULL DEFAULT 0,
      at INTEGER NOT NULL
    );
  `);
}

export function getDb() {
  return db;
}

const now = () => Date.now();

// ---------- chats ----------
export function createChat(title: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    id, title, now(), now(),
  );
  return id;
}

export function addMessage(msg: Omit<ChatMessage, "id" | "createdAt"> & { id?: string }): ChatMessage {
  const id = msg.id ?? randomUUID();
  const createdAt = now();
  db.prepare(
    "INSERT INTO messages (id, chat_id, role, content, created_at, provider, latency_ms, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, msg.chatId, msg.role, msg.content, createdAt, msg.provider ?? null, msg.latencyMs ?? null, msg.confidence ?? null);
  db.prepare("UPDATE chats SET updated_at = ? WHERE id = ?").run(createdAt, msg.chatId);
  return { ...msg, id, createdAt };
}

export function listChats(): ChatSummary[] {
  const rows = db.prepare(`
    SELECT c.id, c.title, c.created_at, c.updated_at,
      (SELECT content FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS preview,
      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count
    FROM chats c ORDER BY c.updated_at DESC
  `).all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    preview: String(r.preview ?? ""),
    messageCount: Number(r.message_count),
  }));
}

export function getMessages(chatId: string): ChatMessage[] {
  const rows = db.prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC").all(chatId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    chatId: String(r.chat_id),
    role: r.role as ChatMessage["role"],
    content: String(r.content),
    createdAt: Number(r.created_at),
    provider: r.provider ? String(r.provider) : undefined,
    latencyMs: r.latency_ms != null ? Number(r.latency_ms) : undefined,
    confidence: (r.confidence ?? undefined) as ChatMessage["confidence"],
  }));
}

export function deleteChat(chatId: string) {
  db.prepare("DELETE FROM messages WHERE chat_id = ?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id = ?").run(chatId);
}

export function clearAllChats() {
  db.exec("DELETE FROM messages; DELETE FROM chats;");
}

// ---------- memories ----------
export function addMemoryRow(content: string, category: MemoryItem["category"], source: string, expiresAt: number | null = null): MemoryItem {
  const id = randomUUID();
  db.prepare("INSERT INTO memories (id, content, category, source, created_at, expires_at, pinned) VALUES (?, ?, ?, ?, ?, ?, 0)").run(
    id, content, category, source, now(), expiresAt,
  );
  return { id, content, category, source, createdAt: now(), expiresAt, pinned: false };
}

export function listMemoriesRows(): MemoryItem[] {
  db.prepare("DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ? AND pinned = 0").run(now());
  const rows = db.prepare("SELECT * FROM memories ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    content: String(r.content),
    category: r.category as MemoryItem["category"],
    source: String(r.source),
    createdAt: Number(r.created_at),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
    pinned: Boolean(r.pinned),
  }));
}

export function updateMemoryRow(id: string, content: string) {
  db.prepare("UPDATE memories SET content = ? WHERE id = ?").run(content, id);
}

export function deleteMemoryRow(id: string) {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}

// ---------- actions ----------
export function logAction(entry: Omit<ActionLogEntry, "id" | "createdAt"> & { undoCommand?: string }): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO actions (id, description, tier, status, undoable, undo_command, created_at, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, entry.description, entry.tier, entry.status, entry.undoable ? 1 : 0, entry.undoCommand ?? null, now(), entry.detail ?? null);
  return id;
}

export function updateActionStatus(id: string, status: ActionLogEntry["status"]) {
  db.prepare("UPDATE actions SET status = ? WHERE id = ?").run(status, id);
}

export function listActions(limit = 50): (ActionLogEntry & { undoCommand?: string })[] {
  const rows = db.prepare("SELECT * FROM actions ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    description: String(r.description),
    tier: r.tier as ActionLogEntry["tier"],
    status: r.status as ActionLogEntry["status"],
    undoable: Boolean(r.undoable),
    createdAt: Number(r.created_at),
    detail: r.detail ? String(r.detail) : undefined,
    undoCommand: r.undo_command ? String(r.undo_command) : undefined,
  }));
}

// ---------- settings ----------
export function getSettingRow(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function setSettingRow(key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------- users ----------
export interface UserRow extends UserAccount {
  passwordHash: string;
  salt: string;
}

export function getUserByEmail(email: string): UserRow | null {
  const r = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as Record<string, unknown> | undefined;
  if (!r) return null;
  return rowToUser(r);
}

export function getUserById(id: string): UserRow | null {
  const r = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return rowToUser(r);
}

function rowToUser(r: Record<string, unknown>): UserRow {
  return {
    id: String(r.id),
    email: String(r.email),
    name: String(r.name),
    role: r.role as UserAccount["role"],
    status: r.status as UserAccount["status"],
    createdAt: Number(r.created_at),
    lastLoginAt: r.last_login_at != null ? Number(r.last_login_at) : null,
    passwordHash: String(r.password_hash),
    salt: String(r.salt),
  };
}

export function insertUser(u: { email: string; name: string; passwordHash: string; salt: string; role: "admin" | "user" }): UserRow {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, salt, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)",
  ).run(id, u.email.toLowerCase(), u.name, u.passwordHash, u.salt, u.role, now());
  return getUserById(id)!;
}

export function listUsers(): UserAccount[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as Record<string, unknown>[];
  return rows.map((r) => {
    const u = rowToUser(r);
    return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };
  });
}

export function setUserStatus(id: string, status: "active" | "revoked" | "blocked") {
  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, id);
}

export function touchLogin(id: string) {
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now(), id);
}

// ---------- provider log / cache ----------
export function logProvider(provider: string, latencyMs: number, ok: boolean) {
  db.prepare("INSERT INTO provider_log (provider, latency_ms, ok, at) VALUES (?, ?, ?, ?)").run(provider, latencyMs, ok ? 1 : 0, now());
  db.prepare("DELETE FROM provider_log WHERE id NOT IN (SELECT id FROM provider_log ORDER BY at DESC LIMIT 200)").run();
}

export function providerLog(): { provider: string; latencyMs: number; at: number; ok: boolean }[] {
  const rows = db.prepare("SELECT * FROM provider_log ORDER BY at DESC LIMIT 50").all() as Record<string, unknown>[];
  return rows.map((r) => ({ provider: String(r.provider), latencyMs: Number(r.latency_ms), at: Number(r.at), ok: Boolean(r.ok) }));
}

export function cacheGet(hash: string): { answer: string; provider: string } | null {
  const r = db.prepare("SELECT answer, provider, created_at FROM response_cache WHERE question_hash = ?").get(hash) as Record<string, unknown> | undefined;
  if (!r) return null;
  // Cache entries live 24h.
  if (Number(r.created_at) < now() - 24 * 3600 * 1000) {
    db.prepare("DELETE FROM response_cache WHERE question_hash = ?").run(hash);
    return null;
  }
  return { answer: String(r.answer), provider: String(r.provider) };
}

export function cacheSet(hash: string, answer: string, provider: string) {
  db.prepare(
    "INSERT INTO response_cache (question_hash, answer, provider, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(question_hash) DO UPDATE SET answer = excluded.answer, provider = excluded.provider, created_at = excluded.created_at",
  ).run(hash, answer, provider, now());
}

// ---------- clipboard ----------
export function pushClipboard(content: string) {
  const last = db.prepare("SELECT content FROM clipboard_history ORDER BY at DESC LIMIT 1").get() as { content?: string } | undefined;
  if (last?.content === content) return;
  db.prepare("INSERT INTO clipboard_history (content, at) VALUES (?, ?)").run(content, now());
  db.prepare("DELETE FROM clipboard_history WHERE id NOT IN (SELECT id FROM clipboard_history ORDER BY at DESC LIMIT 20)").run();
}

export function clipboardHistory(): { content: string; at: number }[] {
  const rows = db.prepare("SELECT content, at FROM clipboard_history ORDER BY at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({ content: String(r.content), at: Number(r.at) }));
}

export function clearClipboardHistory() {
  db.exec("DELETE FROM clipboard_history");
}

// ---------- notifications ----------
export function addNotificationRow(title: string, body: string, kind: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO notifications (id, title, body, kind, read, at) VALUES (?, ?, ?, ?, 0, ?)").run(id, title, body, kind, now());
  db.prepare("DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY at DESC LIMIT 100)").run();
  return id;
}

export function listNotificationRows(): { id: string; title: string; body: string; kind: string; read: boolean; at: number }[] {
  const rows = db.prepare("SELECT * FROM notifications ORDER BY at DESC LIMIT 50").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id), title: String(r.title), body: String(r.body),
    kind: String(r.kind), read: Boolean(r.read), at: Number(r.at),
  }));
}

export function markNotificationsRead() {
  db.exec("UPDATE notifications SET read = 1");
}

export function clearNotificationRows() {
  db.exec("DELETE FROM notifications");
}

export function unreadNotificationCount(): number {
  const r = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE read = 0").get() as { c?: number };
  return Number(r?.c ?? 0);
}

// ---------- activity queries (daily wrap-up / weekly digest) ----------
export function messagesSince(ts: number): { role: string; content: string; created_at: number }[] {
  const rows = db.prepare("SELECT role, content, created_at FROM messages WHERE created_at >= ? ORDER BY created_at ASC LIMIT 200").all(ts) as Record<string, unknown>[];
  return rows.map((r) => ({ role: String(r.role), content: String(r.content), created_at: Number(r.created_at) }));
}

export function actionsSince(ts: number): { description: string; tier: string; status: string; created_at: number }[] {
  const rows = db.prepare("SELECT description, tier, status, created_at FROM actions WHERE created_at >= ? ORDER BY created_at ASC LIMIT 100").all(ts) as Record<string, unknown>[];
  return rows.map((r) => ({ description: String(r.description), tier: String(r.tier), status: String(r.status), created_at: Number(r.created_at) }));
}
