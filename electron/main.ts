import {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, clipboard, dialog, shell, screen,
} from "electron";
import { join } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import { initLogger, log, logTail, getLogDir } from "./services/logger";
import { initDb, pushClipboard, providerLog, listMemoriesRows, addMemoryRow } from "./services/db";
import { getSettings, saveSettings, isSetupComplete, markSetupComplete } from "./services/settings";
import * as auth from "./services/auth";
import * as engine from "./services/engine";
import { handleAsk } from "./services/router";
import { addMessage, createChat, listChats, getMessages, deleteChat, clearAllChats } from "./services/db";
import { confirmPending, actionHistory, undoLast } from "./services/systemControl";
import { memoryApi } from "./services/memory";
import { systemInfo, weather } from "./services/systemInfo";
import { synthesize, stopSynthesis } from "./services/voice";
import type { AppSettings, MemoryItem } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let copilotBar: BrowserWindow | null = null;
let miniOrb: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const RENDERER_DIR = join(__dirname, "..", "dist");
const ICON_PATH = join(__dirname, "..", "resources", "icon-256.png");

function loadRoute(win: BrowserWindow, route: string) {
  if (process.env.RANZO_DEV_URL) {
    void win.loadURL(`${process.env.RANZO_DEV_URL}#${route}`);
  } else {
    void win.loadFile(join(RENDERER_DIR, "index.html"), { hash: route });
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#FBF8F2",
    icon: ICON_PATH,
    title: "Ranzo AI",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadRoute(mainWindow, "/");
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide(); // stay in tray — wake word / copilot keep working
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
}

function createCopilotBar() {
  if (copilotBar) { copilotBar.show(); return; }
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  copilotBar = new BrowserWindow({
    width: 420,
    height: 64,
    x: Math.round((width - 420) / 2),
    y: 12,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadRoute(copilotBar, "/copilot-bar");
  copilotBar.once("ready-to-show", () => copilotBar?.show());
  copilotBar.on("closed", () => { copilotBar = null; });
}

function createMiniOrb() {
  if (miniOrb) { miniOrb.show(); return; }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  miniOrb = new BrowserWindow({
    width: 120,
    height: 120,
    x: width - 150,
    y: height - 150,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadRoute(miniOrb, "/mini-orb");
  miniOrb.once("ready-to-show", () => miniOrb?.show());
  miniOrb.on("closed", () => { miniOrb = null; });
}

function createTray() {
  const img = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip("Ranzo AI");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Ranzo", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "Copilot bar", click: () => createCopilotBar() },
    { type: "separator" },
    { label: "Quit Ranzo", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("double-click", () => { mainWindow?.show(); mainWindow?.focus(); });
}

function broadcast(channel: string, payload: unknown) {
  for (const win of [mainWindow, copilotBar, miniOrb]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle("app:platform", () => process.platform);
  ipcMain.handle("app:quit", () => { quitting = true; app.quit(); });

  // auth
  ipcMain.handle("auth:login", (_e, email: string, password: string) => auth.login(email, password));
  ipcMain.handle("auth:signup", (_e, email: string, password: string, name: string) => auth.signup(email, password, name));
  ipcMain.handle("auth:logout", () => auth.logout());
  ipcMain.handle("auth:current", () => auth.currentUser());
  ipcMain.handle("auth:admin-list", () => (auth.requireAdmin() ? auth.adminListUsers() : []));
  ipcMain.handle("auth:admin-set-status", (_e, userId: string, status: "active" | "revoked" | "blocked") => auth.adminSetStatus(userId, status));

  // setup
  ipcMain.handle("setup:is-complete", () => isSetupComplete());
  ipcMain.handle("setup:complete", () => markSetupComplete());

  // engine
  ipcMain.handle("engine:status", () => engine.engineStatus());
  ipcMain.handle("engine:start", () => engine.startEngine());

  // chat
  ipcMain.handle("chat:ask", async (_e, chatId: string | null, text: string) => {
    const user = await auth.currentUser();
    if (!user) {
      return { messageId: "", content: "You're signed out — log in to keep talking to me.", provider: "auth", latencyMs: 0, confidence: "local", error: "not-authenticated" };
    }
    let cid = chatId;
    if (!cid) cid = createChat(text.slice(0, 48) || "New chat");
    addMessage({ chatId: cid, role: "user", content: text });
    broadcast("agent-state", "thinking");
    const history = getMessages(cid).slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const res = await handleAsk(text, history.slice(0, -1));
    const saved = addMessage({
      chatId: cid, role: "assistant", content: res.content,
      provider: res.provider, latencyMs: res.latencyMs, confidence: res.confidence,
    });
    broadcast("agent-state", "idle");
    return { ...res, messageId: saved.id, chatId: cid };
  });
  ipcMain.handle("chat:list", () => listChats());
  ipcMain.handle("chat:messages", (_e, chatId: string) => getMessages(chatId));
  ipcMain.handle("chat:delete", (_e, chatId: string) => deleteChat(chatId));
  ipcMain.handle("chat:clear-all", () => clearAllChats());

  // actions
  ipcMain.handle("action:confirm", async (_e, actionId: string, approved: boolean) => {
    broadcast("agent-state", "working");
    try {
      const outcome = await confirmPending(actionId, approved);
      return { messageId: "", content: outcome.message, provider: "actions", latencyMs: 0, confidence: "local" };
    } catch (err) {
      const { translateError } = await import("./services/errorTranslator");
      return { messageId: "", content: translateError(err), provider: "actions", latencyMs: 0, confidence: "local" };
    } finally {
      broadcast("agent-state", "idle");
    }
  });
  ipcMain.handle("action:log", () => actionHistory());
  ipcMain.handle("action:undo-last", () => undoLast());

  // memory
  ipcMain.handle("memory:list", () => memoryApi.list());
  ipcMain.handle("memory:add", (_e, content: string, category: MemoryItem["category"]) => memoryApi.add(content, category));
  ipcMain.handle("memory:update", (_e, id: string, content: string) => memoryApi.update(id, content));
  ipcMain.handle("memory:delete", (_e, id: string) => memoryApi.remove(id));
  ipcMain.handle("memory:export", async () => {
    const res = await dialog.showSaveDialog({ defaultPath: "ranzo-memories.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (res.canceled || !res.filePath) return { ok: false, error: "Cancelled." };
    writeFileSync(res.filePath, JSON.stringify(listMemoriesRows(), null, 2));
    return { ok: true, path: res.filePath };
  });
  ipcMain.handle("memory:import", async () => {
    const res = await dialog.showOpenDialog({ filters: [{ name: "JSON", extensions: ["json"] }], properties: ["openFile"] });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, error: "Cancelled." };
    try {
      const items = JSON.parse(readFileSync(res.filePaths[0], "utf8")) as MemoryItem[];
      let count = 0;
      for (const item of items) {
        if (item.content && item.category) { addMemoryRow(item.content, item.category, item.source || "Imported", item.expiresAt ?? null); count++; }
      }
      return { ok: true, count };
    } catch {
      return { ok: false, error: "That file doesn't look like a Ranzo memory export." };
    }
  });

  // settings
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:save", (_e, patch: Partial<AppSettings>) => saveSettings(patch));

  // system
  ipcMain.handle("system:info", () => systemInfo());
  ipcMain.handle("system:weather", () => weather());
  ipcMain.handle("system:diagnostics", async () => ({
    engine: engine.currentEngineStatus(),
    system: await systemInfo(),
    providerLog: providerLog(),
    logTail: logTail(100),
  }));
  ipcMain.handle("system:export-diagnostics", async () => {
    const res = await dialog.showSaveDialog({ defaultPath: "ranzo-diagnostics.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
    if (res.canceled || !res.filePath) return { ok: false, error: "Cancelled." };
    const info = await systemInfo();
    const body = [
      "Ranzo AI diagnostics bundle",
      `Generated: ${new Date().toISOString()}`,
      `App version: ${app.getVersion()}`,
      "",
      "-- System --",
      JSON.stringify({ ...info }, null, 2),
      "",
      "-- Engine --",
      JSON.stringify(engine.currentEngineStatus(), null, 2),
      "",
      "-- Provider log (latest 50) --",
      JSON.stringify(providerLog(), null, 2),
      "",
      "-- Log tail (no personal data is intentionally included) --",
      ...logTail(200),
    ].join("\n");
    writeFileSync(res.filePath, body);
    return { ok: true, path: res.filePath };
  });

  // voice
  ipcMain.handle("voice:speak", async (_e, text: string) => {
    broadcast("agent-state", "speaking");
    const out = await synthesize(text);
    broadcast("agent-state", "idle");
    return out;
  });
  ipcMain.handle("voice:stop", () => { stopSynthesis(); broadcast("agent-state", "idle"); });

  // windows
  ipcMain.handle("window:copilot", (_e, on: boolean) => {
    if (on) { createCopilotBar(); mainWindow?.hide(); } else { copilotBar?.close(); mainWindow?.show(); }
  });
  ipcMain.handle("window:mini", (_e, on: boolean) => {
    if (on) { createMiniOrb(); mainWindow?.hide(); } else { miniOrb?.close(); mainWindow?.show(); }
  });
  ipcMain.handle("window:restore", () => {
    copilotBar?.close();
    miniOrb?.close();
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ---------- clipboard watcher (local rolling history of 20) ----------

let lastClip = "";
function watchClipboard() {
  setInterval(() => {
    try {
      const text = clipboard.readText();
      if (text && text !== lastClip && text.length < 10_000) {
        lastClip = text;
        pushClipboard(text);
      }
    } catch { /* ignore */ }
  }, 3000);
}

// ---------- lifecycle ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { mainWindow?.show(); mainWindow?.focus(); });

  app.whenReady().then(async () => {
    const userData = app.getPath("userData");
    initLogger(userData);
    initDb(userData);
    auth.seedAdmin();
    log("info", "app", `Ranzo AI ${app.getVersion()} starting (${process.platform})`);

    registerIpc();
    createMainWindow();
    createTray();
    watchClipboard();

    engine.onEngineStatus((s) => broadcast("engine-status", s));
    // Self-check on launch: engine state is probed before the user asks anything.
    void engine.startEngine();
  });

  app.on("before-quit", () => { quitting = true; });
  app.on("window-all-closed", () => { /* stay alive in tray */ });
}
