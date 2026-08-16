// Engine service — manages the local Ollama brain: detection, auto-start,
// model download, warm-keeping, and idle release.

import { spawn, execFile } from "node:child_process";
import type { EngineStatus } from "../../shared/types";
import { getSettings } from "./settings";
import { log } from "./logger";

let lastStatus: EngineStatus = {
  ollamaInstalled: false,
  ollamaRunning: false,
  modelName: null,
  modelReady: false,
  state: "stopped",
  detail: "Not checked yet.",
};

let statusListeners: ((s: EngineStatus) => void)[] = [];
let lastUsedAt = Date.now();
let idleTimer: NodeJS.Timeout | null = null;

export function onEngineStatus(cb: (s: EngineStatus) => void) {
  statusListeners.push(cb);
  return () => { statusListeners = statusListeners.filter((f) => f !== cb); };
}

function emit(status: EngineStatus) {
  lastStatus = status;
  for (const cb of statusListeners) cb(status);
}

function ollamaBinary(): string {
  // On Windows the installer puts ollama on PATH; also check the default location.
  return process.platform === "win32" ? "ollama" : "ollama";
}

async function isServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${getSettings().ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function isBinaryInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(ollamaBinary(), ["--version"], { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
  });
}

async function listLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${getSettings().ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function engineStatus(): Promise<EngineStatus> {
  const settings = getSettings();
  const running = await isServerUp();
  if (!running) {
    const installed = await isBinaryInstalled();
    const status: EngineStatus = installed
      ? { ollamaInstalled: true, ollamaRunning: false, modelName: null, modelReady: false, state: "stopped", detail: "The local engine is installed but not running." }
      : { ollamaInstalled: false, ollamaRunning: false, modelName: null, modelReady: false, state: "not-installed", detail: "Ollama isn't installed yet. The setup wizard can install it for you." };
    emit(status);
    return status;
  }
  const models = await listLocalModels();
  const wanted = settings.ollamaModel;
  const have = models.some((m) => m === wanted || m.startsWith(wanted.split(":")[0]));
  const status: EngineStatus = {
    ollamaInstalled: true,
    ollamaRunning: true,
    modelName: have ? wanted : null,
    modelReady: have,
    state: have ? "ready" : "downloading-model",
    detail: have ? "Local brain is ready." : `The model ${wanted} isn't downloaded yet.`,
  };
  emit(status);
  return status;
}

export async function startEngine(): Promise<EngineStatus> {
  emit({ ...lastStatus, state: "starting", detail: "Starting the local engine…" });
  if (!(await isServerUp())) {
    const installed = await isBinaryInstalled();
    if (!installed) {
      const s: EngineStatus = { ollamaInstalled: false, ollamaRunning: false, modelName: null, modelReady: false, state: "not-installed", detail: "Ollama isn't installed. Run the setup wizard or install it from ollama.com, then try again." };
      emit(s);
      return s;
    }
    try {
      const child = spawn(ollamaBinary(), ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      log("info", "engine", "Spawned ollama serve");
    } catch (err) {
      log("error", "engine", `Failed to spawn ollama: ${String(err)}`);
    }
    // Wait up to 15 seconds for the server to come up.
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await isServerUp()) break;
    }
  }
  if (!(await isServerUp())) {
    const s: EngineStatus = { ollamaInstalled: true, ollamaRunning: false, modelName: null, modelReady: false, state: "error", detail: "The local engine didn't start. Try starting Ollama manually, then press Start engine again." };
    emit(s);
    return s;
  }
  const status = await engineStatus();
  if (!status.modelReady) {
    void pullModel();
  }
  return status;
}

let pulling = false;

export async function pullModel(): Promise<void> {
  if (pulling) return;
  pulling = true;
  const model = getSettings().ollamaModel;
  emit({ ...lastStatus, state: "downloading-model", detail: `Downloading ${model}. This happens once and can take a while.` });
  try {
    const res = await fetch(`${getSettings().ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n").filter(Boolean)) {
          try {
            const evt = JSON.parse(line) as { status?: string; completed?: number; total?: number };
            if (evt.total && evt.completed != null) {
              const pct = Math.round((evt.completed / evt.total) * 100);
              emit({ ...lastStatus, state: "downloading-model", detail: `Downloading ${model} — ${pct}%` });
            }
          } catch { /* partial line */ }
        }
      }
    }
  } catch (err) {
    log("error", "engine", `Model pull failed: ${String(err)}`);
  }
  pulling = false;
  await engineStatus();
}

export function noteModelUse() {
  lastUsedAt = Date.now();
  scheduleIdleRelease();
}

function scheduleIdleRelease() {
  if (idleTimer) clearTimeout(idleTimer);
  const minutes = getSettings().idleModelReleaseMinutes;
  if (minutes <= 0) return;
  idleTimer = setTimeout(async () => {
    if (Date.now() - lastUsedAt >= minutes * 60_000) {
      // Ask Ollama to unload the model to free RAM (keep_alive: 0).
      try {
        await fetch(`${getSettings().ollamaUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: getSettings().ollamaModel, keep_alive: 0 }),
          signal: AbortSignal.timeout(5000),
        });
        log("info", "engine", "Released idle model from memory.");
      } catch { /* engine may be down; fine */ }
    }
  }, minutes * 60_000 + 1000);
}

export function currentEngineStatus(): EngineStatus {
  return lastStatus;
}
