import { appendFileSync, mkdirSync, readFileSync, existsSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";

let logDir = ".";
const MAX_LOG_BYTES = 2 * 1024 * 1024;

export function initLogger(userDataDir: string) {
  logDir = join(userDataDir, "logs");
  mkdirSync(logDir, { recursive: true });
}

function logPath() {
  return join(logDir, "ranzo.log");
}

export function log(level: "info" | "warn" | "error", scope: string, message: string) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}\n`;
  try {
    const p = logPath();
    if (existsSync(p) && statSync(p).size > MAX_LOG_BYTES) {
      renameSync(p, join(logDir, "ranzo.old.log"));
    }
    appendFileSync(p, line);
  } catch {
    // Logging must never crash the app.
  }
  if (process.env.RANZO_DEBUG) console.log(line.trim());
}

export function logTail(lines = 200): string[] {
  try {
    const content = readFileSync(logPath(), "utf8");
    return content.split("\n").filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

export function getLogDir() {
  return logDir;
}
