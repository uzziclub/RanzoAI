// HardwareDetector + system info for the left sidebar and the tier system.

import { cpus, totalmem, platform } from "node:os";
import { execFile } from "node:child_process";
import type { SystemInfo, WeatherInfo } from "../../shared/types";
import { getSettings } from "./settings";
import { getSettingRow, setSettingRow } from "./db";
import { log } from "./logger";

async function batteryInfo(): Promise<{ percent: number; charging: boolean } | null> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile(
        "powershell",
        ["-NoProfile", "-Command", "(Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json)"],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout.trim()) return resolve(null);
          try {
            const b = JSON.parse(stdout) as { EstimatedChargeRemaining?: number; BatteryStatus?: number };
            if (b.EstimatedChargeRemaining == null) return resolve(null);
            resolve({ percent: b.EstimatedChargeRemaining, charging: b.BatteryStatus === 2 });
          } catch { resolve(null); }
        },
      );
    });
  }
  return null;
}

function computeTier(): { tier: "low" | "mid" | "high"; reason: string } {
  const override = getSettings().hardwareTierOverride;
  if (override !== "auto") return { tier: override, reason: "You set this tier manually in Settings → Performance." };
  const cached = getSettingRow("hardware-tier");
  if (cached) {
    try { return JSON.parse(cached) as { tier: "low" | "mid" | "high"; reason: string }; } catch { /* recompute */ }
  }
  const ramGb = totalmem() / 1024 ** 3;
  const cores = cpus().length;
  let tier: "low" | "mid" | "high";
  let reason: string;
  if (ramGb < 7 || cores <= 2) {
    tier = "low";
    reason = `This machine has ${ramGb.toFixed(0)} GB of RAM and ${cores} CPU cores, so Ranzo runs light: a smaller model, fewer animations, minimal background work.`;
  } else if (ramGb >= 15 && cores >= 8) {
    tier = "high";
    reason = `With ${ramGb.toFixed(0)} GB of RAM and ${cores} cores, Ranzo can run larger models and keep everything snappy.`;
  } else {
    tier = "mid";
    reason = `With ${ramGb.toFixed(0)} GB of RAM and ${cores} cores, Ranzo uses the standard model with the full interface.`;
  }
  const result = { tier, reason };
  setSettingRow("hardware-tier", JSON.stringify(result));
  log("info", "hardware", `Tier: ${tier} (${reason})`);
  return result;
}

// Cache the online probe and battery query so the 60-second copilot heartbeat
// and sidebar refresh stay cheap: at most one network probe / one PowerShell
// call per interval, shared by every caller.
let onlineCache: { value: boolean; at: number } | null = null;
const ONLINE_TTL = 90_000;

async function isOnline(): Promise<boolean> {
  if (onlineCache && Date.now() - onlineCache.at < ONLINE_TTL) return onlineCache.value;
  let value = false;
  try {
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m", { signal: AbortSignal.timeout(4000) });
    value = res.ok;
  } catch {
    value = false;
  }
  onlineCache = { value, at: Date.now() };
  return value;
}

let batteryCache: { value: { percent: number; charging: boolean } | null; at: number } | null = null;
const BATTERY_TTL = 55_000;

async function batteryCached() {
  if (batteryCache && Date.now() - batteryCache.at < BATTERY_TTL) return batteryCache.value;
  const value = await batteryInfo();
  batteryCache = { value, at: Date.now() };
  return value;
}

export async function systemInfo(): Promise<SystemInfo> {
  const { tier, reason } = computeTier();
  return {
    platform: platform(),
    cpuName: cpus()[0]?.model?.trim() ?? "Unknown CPU",
    totalRamGb: Math.round(totalmem() / 1024 ** 3),
    battery: await batteryCached(),
    online: await isOnline(),
    hardwareTier: tier,
    tierReason: reason,
  };
}

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Icy fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow",
  75: "Heavy snow", 80: "Light showers", 81: "Showers", 82: "Heavy showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Severe thunderstorm",
};

export async function weather(): Promise<WeatherInfo | null> {
  try {
    // Locate by IP (free, no key), then Open-Meteo (free, no key).
    const geoRes = await fetch("http://ip-api.com/json/?fields=status,city,lat,lon", { signal: AbortSignal.timeout(5000) });
    if (!geoRes.ok) return null;
    const geo = (await geoRes.json()) as { status: string; city: string; lat: number; lon: number };
    if (geo.status !== "success") return null;
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!wRes.ok) return null;
    const w = (await wRes.json()) as { current?: { temperature_2m: number; weather_code: number } };
    if (!w.current) return null;
    return {
      tempC: Math.round(w.current.temperature_2m),
      code: w.current.weather_code,
      description: WEATHER_CODES[w.current.weather_code] ?? "—",
      city: geo.city,
    };
  } catch {
    return null; // Weather row hides entirely when offline — locked decision.
  }
}
