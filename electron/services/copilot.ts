// BackgroundCopilot — a lightweight always-on worker, dormant until needed and
// conservative with resources. It runs on a single 60-second heartbeat:
//   • Morning briefing at the user's chosen hour (default 8:00), once per day.
//   • System health watch: low disk, low battery — one clear notification,
//     never repeated within the same day.
//   • Daily wrap-up in the evening (optional, on by default at 20:00).
//   • Weekly digest of what the copilot noticed and did (Mondays).
//   • Focus sessions: while active, all non-urgent notifications are muted by
//     the NotificationBroker; the copilot announces when the session ends.
// Everything is local; the news briefing uses free public RSS feeds and the
// LLM to summarize naturally — never word-for-word.

import { statfsSync } from "node:fs";
import { homedir } from "node:os";
import { getSettings, saveSettings } from "./settings";
import { getSettingRow, setSettingRow, messagesSince, actionsSince } from "./db";
import { notify } from "./notifications";
import { askLlm } from "./providers";
import { systemInfo } from "./systemInfo";
import { log } from "./logger";

let timer: NodeJS.Timeout | null = null;
let running = false;

// ---------- once-per-day markers ----------
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function ranToday(job: string): boolean {
  return getSettingRow(`copilot-ran:${job}`) === todayKey();
}
function markRan(job: string) {
  setSettingRow(`copilot-ran:${job}`, todayKey());
}

// ---------- news briefing ----------
const FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.aljazeera.com/xml/rss/all.xml",
];

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/<[^>]+>/g, "").trim();
}

async function fetchHeadlines(): Promise<string[]> {
  const headlines: string[] = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = xml.split(/<item[\s>]/).slice(1, 8);
      for (const item of items) {
        const t = item.match(/<title>([\s\S]*?)<\/title>/);
        if (t) headlines.push(stripCdata(t[1]));
      }
    } catch { /* feed unreachable — fine */ }
    if (headlines.length >= 10) break;
  }
  return headlines.slice(0, 12);
}

async function morningBriefing() {
  const headlines = await fetchHeadlines();
  if (headlines.length === 0) {
    log("info", "copilot", "Briefing skipped — no feeds reachable (offline?).");
    markRan("briefing"); // don't retry all day while offline
    return;
  }
  try {
    const result = await askLlm([
      {
        role: "system",
        content: "You are Ranzo, a desktop assistant. Summarize today's headlines as a short natural morning briefing — 3 to 5 sentences, plain conversational language, group related items, never quote word-for-word, no bullet points, no hype.",
      },
      { role: "user", content: `Today's headlines:\n${headlines.map((h) => `- ${h}`).join("\n")}` },
    ], { skipCache: true });
    notify("Morning briefing", result.content, "briefing");
  } catch {
    // LLM unavailable — give the plain top headlines rather than nothing.
    notify("Morning briefing", `Top stories: ${headlines.slice(0, 4).join(" · ")}`, "briefing");
  }
  markRan("briefing");
}

// ---------- health watch ----------
function diskFreeGb(): number | null {
  try {
    const s = statfsSync(homedir());
    return (s.bavail * s.bsize) / 1024 ** 3;
  } catch {
    return null;
  }
}

async function healthCheck(sys: Awaited<ReturnType<typeof systemInfo>>) {
  const free = diskFreeGb();
  if (free != null && free < 5 && !ranToday("health-disk")) {
    notify("Storage is getting tight", `Only ${free.toFixed(1)} GB free on your main drive. Want me to help find what's taking the space? Just ask.`, "health");
    markRan("health-disk");
  }
  if (sys.battery && !sys.battery.charging && sys.battery.percent <= 15 && !ranToday("health-battery")) {
    notify("Battery is low", `${sys.battery.percent}% left and not charging. I've also eased off background work to stretch it.`, "health");
    markRan("health-battery");
  }
}

// ---------- daily wrap-up ----------
async function dailyWrapUp() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const msgs = messagesSince(dayStart.getTime());
  const acts = actionsSince(dayStart.getTime());
  if (msgs.length === 0 && acts.length === 0) { markRan("wrapup"); return; }
  const userAsks = msgs.filter((m) => m.role === "user").map((m) => m.content.slice(0, 90));
  const doneActs = acts.filter((a) => a.status === "done").map((a) => a.description);
  try {
    const result = await askLlm([
      {
        role: "system",
        content: "You are Ranzo. Write a 2-4 sentence end-of-day wrap-up of what was discussed and done today. Plain, warm, no lists, no hype. If something looks unfinished, mention it once.",
      },
      { role: "user", content: `Things the user asked today:\n${userAsks.join("\n") || "(nothing)"}\n\nActions completed:\n${doneActs.join("\n") || "(none)"}` },
    ], { skipCache: true });
    notify("Daily wrap-up", result.content, "wrap-up", { native: false });
  } catch {
    notify("Daily wrap-up", `Today: ${userAsks.length} conversations, ${doneActs.length} actions completed.`, "wrap-up", { native: false });
  }
  markRan("wrapup");
}

// ---------- weekly digest ----------
async function weeklyDigest() {
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const msgs = messagesSince(weekAgo);
  const acts = actionsSince(weekAgo);
  if (msgs.length === 0 && acts.length === 0) { markRan("digest"); return; }
  const summary = `This week: ${msgs.filter((m) => m.role === "user").length} things asked, ${acts.filter((a) => a.status === "done").length} actions done, ${acts.filter((a) => a.status === "cancelled").length} cancelled after confirmation.`;
  notify("Weekly digest", summary, "digest", { native: false });
  markRan("digest");
}

// ---------- focus sessions ----------
export function startFocusSession(minutes: number): string {
  const until = Date.now() + minutes * 60_000;
  saveSettings({ focusSessionUntil: until });
  log("info", "copilot", `Focus session started for ${minutes} minutes.`);
  return `Focus session on for ${minutes} minutes — I'll hold all non-urgent notifications until ${new Date(until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;
}

export function endFocusSession(): string {
  saveSettings({ focusSessionUntil: null });
  return "Focus session ended. Notifications are back to normal.";
}

function checkFocusExpiry() {
  const until = getSettings().focusSessionUntil;
  if (until != null && until <= Date.now()) {
    saveSettings({ focusSessionUntil: null });
    notify("Focus session finished", "That's the end of the focus block. Anything I held back is in the notification list.", "info", { native: true });
  }
}

// ---------- heartbeat ----------
async function tick() {
  if (running) return; // never overlap
  running = true;
  try {
    const s = getSettings();
    const nowD = new Date();
    const hour = nowD.getHours();
    checkFocusExpiry();
    // On battery: only focus expiry and critical health run.
    const sys = await systemInfo();
    const onBattery = sys.battery != null && !sys.battery.charging;
    if (s.briefingEnabled && hour >= s.briefingHour && hour < s.briefingHour + 3 && !ranToday("briefing") && !onBattery) {
      await morningBriefing();
    }
    await healthCheck(sys); // internally rate-limited to one alert per issue per day
    if (hour >= 20 && !ranToday("wrapup") && !onBattery) await dailyWrapUp();
    if (nowD.getDay() === 1 && hour >= 9 && !ranToday("digest") && !onBattery) await weeklyDigest();
  } catch (err) {
    log("warn", "copilot", `Heartbeat error: ${String(err)}`);
  } finally {
    running = false;
  }
}

export function startCopilot() {
  if (timer) return;
  timer = setInterval(() => void tick(), 60_000);
  // First pass shortly after launch, so a late morning start still gets a briefing.
  setTimeout(() => void tick(), 20_000);
  log("info", "copilot", "Background copilot started (60s heartbeat).");
}

export function stopCopilot() {
  if (timer) clearInterval(timer);
  timer = null;
}

// On-demand news, any time the user asks.
export async function newsNow(): Promise<string> {
  const headlines = await fetchHeadlines();
  if (headlines.length === 0) return "I couldn't reach any news feeds — it looks like the internet is down right now.";
  try {
    const result = await askLlm([
      { role: "system", content: "You are Ranzo. Summarize these headlines naturally in 3-5 sentences, conversational, never word-for-word, no bullets." },
      { role: "user", content: headlines.map((h) => `- ${h}`).join("\n") },
    ], { skipCache: true });
    return result.content;
  } catch {
    return `Here are the top stories as plain headlines (my summarizer isn't reachable): ${headlines.slice(0, 5).join(" · ")}`;
  }
}
