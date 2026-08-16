import { DEFAULT_SETTINGS, type AppSettings } from "../../shared/types";
import { getSettingRow, setSettingRow } from "./db";

let cached: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cached) return cached;
  const raw = getSettingRow("app-settings");
  if (!raw) {
    cached = { ...DEFAULT_SETTINGS };
    return cached;
  }
  try {
    cached = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    cached = { ...DEFAULT_SETTINGS };
  }
  return cached;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = { ...getSettings(), ...patch };
  // Destructive confirmation can never be turned off — it is a core safety rule.
  merged.confirmDestructive = true;
  // Telemetry is local-only and off by default; there is no remote telemetry endpoint at all.
  cached = merged;
  setSettingRow("app-settings", JSON.stringify(merged));
  return merged;
}

export function isSetupComplete(): boolean {
  return getSettingRow("setup-complete") === "yes";
}

export function markSetupComplete() {
  setSettingRow("setup-complete", "yes");
}
