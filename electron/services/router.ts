// RequestRouter — lightweight local classifier. Decides per request whether to
// use the local model, live web search, an OS action, or a memory command.
// Always prefers local; never leaves the machine unless needed.

import type { RouteDecision, PendingAction, AskResponse } from "../../shared/types";
import { askLlm, webSearch, type LlmMessage } from "./providers";
import { buildAction, requestAction, undoLast } from "./systemControl";
import { searchMemories, maybeAutoRemember, forgetMatching } from "./memory";
import { getSettings, saveSettings } from "./settings";
import { translateError } from "./errorTranslator";
import { clipboardHistory } from "./db";
import { searchKnowledge, knowledgeStatus } from "./knowledge";
import { startFocusSession, endFocusSession, newsNow } from "./copilot";
import { log } from "./logger";

// ---------- classification ----------

// Note: bare "news" is NOT here — real briefing requests match NEWS_CMD below,
// while sentences that merely mention news ("news about my cousin") stay local.
const LIVE_DATA = /\b(today|latest|current|right now|price of|stock|weather in|score|happening|this week'?s)\b/i;
const SEARCH_VERB = /\b(search (the web|online|for)|look up|google)\b/i;
// A briefing request, not merely a sentence containing the word "news".
const NEWS_CMD = /\b(?:what'?s?|any|show(?: me)?|give me|read(?: me)?|tell me|get)\s+(?:the\s+|some\s+|today'?s\s+)?news\b|^news$|\bnews (?:briefing|update|summary)\b|\bmorning briefing\b|\bdaily briefing\b/i;

interface ActionMatch { kind: string; args: Record<string, string> }

function matchAction(text: string): ActionMatch | null {
  const t = text.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(?:open|launch|start)\s+(?:the\s+)?(?:app\s+)?([\w .-]{2,40})$/i))) {
    const app = m[1].trim();
    // Don't hijack phrases like "open question"
    if (!/^(question|mind|to|up|source)/i.test(app)) return { kind: "open-app", args: { app } };
  }
  if ((m = t.match(/\b(?:set\s+)?volume\s+(?:to\s+)?(\d{1,3})\s*%?/i))) return { kind: "set-volume", args: { level: m[1] } };
  if (/\block (?:the )?(?:screen|computer|pc)\b/i.test(t)) return { kind: "lock-screen", args: {} };
  if (/\bempty (?:the )?recycle bin\b/i.test(t)) return { kind: "empty-recycle-bin", args: {} };
  if (/\bshut ?down (?:the )?(?:computer|pc|system)\b/i.test(t)) return { kind: "shutdown", args: {} };
  if (/\brestart (?:the )?(?:computer|pc|system)\b/i.test(t)) return { kind: "restart", args: {} };
  if (/\b(?:go to )?sleep(?: the)? (?:computer|pc|now)?$/i.test(t) && /\b(computer|pc|sleep now)\b/i.test(t)) return { kind: "sleep", args: {} };
  if ((m = t.match(/\bdelete (?:the )?file\s+["']?([^"']+)["']?/i))) return { kind: "delete-file", args: { path: m[1].trim() } };
  if ((m = t.match(/\btake a screenshot\b/i))) return { kind: "take-screenshot", args: {} };
  if (/\bwhat(?:'s| is) (?:on|in) (?:my|the) clipboard\b/i.test(t)) return { kind: "get-clipboard", args: {} };
  if ((m = t.match(/\blist (?:the )?files (?:in|at)\s+["']?([^"']+)["']?/i))) return { kind: "list-files", args: { path: m[1].trim() } };
  if ((m = t.match(/\brun (?:the )?command\s+(.+)/i))) return { kind: "run-command", args: { command: m[1].trim() } };
  return null;
}

export function classify(text: string): RouteDecision {
  if (/\bforget (?:this|that|about)\b/i.test(text)) return { target: "memory-command", reason: "User asked to forget something." };
  if (/\bundo (?:that|the last|last action)\b/i.test(text)) return { target: "memory-command", reason: "Undo command." };
  if (/\bwhat did i copy\b/i.test(text)) return { target: "memory-command", reason: "Clipboard recall." };
  if (/\bfocus session\b|\bstart (?:a )?focus\b|\bend focus\b|\bstop focus\b/i.test(text)) return { target: "memory-command", reason: "Focus session control." };
  if (NEWS_CMD.test(text.trim())) return { target: "memory-command", reason: "News briefing on demand." };
  if (/\b(focus|professional|witty|natural|normal) mode\b/i.test(text)) return { target: "memory-command", reason: "Persona switch." };
  if (matchAction(text)) return { target: "action", reason: "Matches a system control pattern." };
  if (!getSettings().forceOffline && (SEARCH_VERB.test(text) || LIVE_DATA.test(text))) {
    return { target: "search", reason: "Needs live or current information." };
  }
  return { target: "local", reason: "Answerable from the local model and memory." };
}

// ---------- persona ----------

function personaInstruction(): string {
  const s = getSettings();
  const base =
    "You are Ranzo, a capable desktop assistant made by Uzzi Club, running locally on the user's Windows PC. " +
    "Write like a sharp, helpful friend: plain everyday language, contractions, no marketing fluff, no 'Absolutely!'. " +
    "Keep answers concise unless depth is asked for. If you're not sure of a fact, say so plainly. " +
    "Reply in the language the user wrote in.";
  switch (s.persona) {
    case "professional": return base + " Tone: concise and formal, suited to work.";
    case "witty": return base + " Tone: dry humor, but usefulness always comes first.";
    case "focused": return base + " Tone: no small talk at all. Shortest correct answer.";
    case "custom": return base + ` Tone, as described by the user: ${s.customPersona || "natural"}.`;
    default: return base + " Tone: natural and easy.";
  }
}

// ---------- main ask flow ----------

export async function handleAsk(text: string, history: LlmMessage[]): Promise<Omit<AskResponse, "messageId">> {
  const decision = classify(text);
  log("info", "router", `"${text.slice(0, 60)}" -> ${decision.target} (${decision.reason})`);

  try {
    if (decision.target === "memory-command") return await handleMetaCommand(text);
    if (decision.target === "action") return await handleAction(text);
    if (decision.target === "search") return await handleSearch(text, history);
    return await handleLocal(text, history);
  } catch (err) {
    return {
      content: translateError(err),
      provider: "error",
      latencyMs: 0,
      confidence: "guess",
      error: String(err instanceof Error ? err.message : err),
    };
  }
}

async function handleMetaCommand(text: string): Promise<Omit<AskResponse, "messageId">> {
  if (/\bundo\b/i.test(text)) {
    const res = await undoLast();
    return { content: res.message, provider: "actions", latencyMs: 0, confidence: "local" };
  }
  if (/\bforget\b/i.test(text)) {
    const topic = text.replace(/\bforget (?:this|that|about)\b/i, "").trim() || text;
    const res = forgetMatching(topic);
    return {
      content: res.forgotten
        ? `Done — I've forgotten: "${res.content}".`
        : "I looked, but I don't have a memory matching that. You can check everything I remember in the Memory Viewer.",
      provider: "memory", latencyMs: 0, confidence: "local",
    };
  }
  if (/\bwhat did i copy\b/i.test(text)) {
    const hist = clipboardHistory();
    if (hist.length === 0) return { content: "I haven't seen anything on the clipboard yet this session.", provider: "clipboard", latencyMs: 0, confidence: "local" };
    const items = hist.slice(0, 5).map((h, i) => `${i + 1}. ${h.content.slice(0, 80)}`).join("\n");
    return { content: `Here's your recent clipboard history:\n${items}`, provider: "clipboard", latencyMs: 0, confidence: "local" };
  }
  const focusStart = text.match(/\b(?:start (?:a )?focus(?: session)?|focus session)(?:\s+for)?\s+(\d{1,3})\s*(?:min|minutes|m)?\b/i);
  if (focusStart) {
    return { content: startFocusSession(Number(focusStart[1])), provider: "copilot", latencyMs: 0, confidence: "local" };
  }
  if (/\bstart (?:a )?focus\b|\bfocus session\b/i.test(text) && !/\bend|stop\b/i.test(text)) {
    return { content: startFocusSession(25), provider: "copilot", latencyMs: 0, confidence: "local" };
  }
  if (/\bend focus\b|\bstop focus\b/i.test(text)) {
    return { content: endFocusSession(), provider: "copilot", latencyMs: 0, confidence: "local" };
  }
  if (NEWS_CMD.test(text.trim())) {
    const start = Date.now();
    const summary = await newsNow();
    return { content: summary, provider: "news", latencyMs: Date.now() - start, confidence: "search" };
  }
  const personaMatch = text.match(/\b(focus|professional|witty|natural|normal) mode\b/i);
  if (personaMatch) {
    const word = personaMatch[1].toLowerCase();
    const persona = word === "focus" ? "focused" : word === "normal" ? "natural" : (word as "professional" | "witty" | "natural");
    saveSettings({ persona });
    return { content: `Switched to ${persona} mode.`, provider: "persona", latencyMs: 0, confidence: "local" };
  }
  return { content: "Hmm, I understood that as a command but couldn't work out which one. Try rephrasing it.", provider: "router", latencyMs: 0, confidence: "guess" };
}

async function handleAction(text: string): Promise<Omit<AskResponse, "messageId">> {
  const match = matchAction(text)!;
  const spec = buildAction(match.kind, match.args);
  if (!spec) return { content: "I recognized that as a computer action but can't do that one yet.", provider: "actions", latencyMs: 0, confidence: "local" };
  const start = Date.now();
  const outcome = await requestAction(spec);
  const result: Omit<AskResponse, "messageId"> = {
    content: outcome.message,
    provider: "actions",
    latencyMs: Date.now() - start,
    confidence: "local",
  };
  if (outcome.pending) result.pendingAction = outcome.pending as PendingAction;
  return result;
}

async function handleSearch(text: string, history: LlmMessage[]): Promise<Omit<AskResponse, "messageId">> {
  const start = Date.now();
  const search = await webSearch(text);
  if (!search) {
    // No Tavily key or offline — answer locally, honestly labeled as possibly stale.
    const local = await handleLocal(text, history);
    return {
      ...local,
      content: local.content + "\n\n(I couldn't check the live web for this, so it's from what I already know — it may be out of date.)",
      confidence: "guess",
    };
  }
  const msgs: LlmMessage[] = [
    { role: "system", content: personaInstruction() + " Use the provided live search results to answer. Summarize naturally — never word-for-word. Mention you checked the web." },
    ...history.slice(-6),
    { role: "user", content: `${text}\n\nLive search results:\n${search.answer}\n\nSources: ${search.sources.map((s) => s.title).join("; ")}` },
  ];
  const result = await askLlm(msgs, { skipCache: true });
  return { content: result.content, provider: `search + ${result.provider}`, latencyMs: Date.now() - start, confidence: "search" };
}

async function handleLocal(text: string, history: LlmMessage[]): Promise<Omit<AskResponse, "messageId">> {
  const memories = searchMemories(text, 4);
  const memoryBlock = memories.length
    ? `\n\nThings you remember about this user (use them naturally, don't recite them):\n${memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";
  // Offline RAG: if the user has pointed Ranzo at folders, pull matching
  // chunks from their own documents into context — fully local.
  let docBlock = "";
  let usedDocs = false;
  if (knowledgeStatus().chunks > 0) {
    const hits = searchKnowledge(text, 3);
    if (hits.length > 0) {
      usedDocs = true;
      docBlock = `\n\nRelevant excerpts from the user's own documents (cite the file name when you use one):\n${hits.map((h) => `[${h.file}]\n${h.text}`).join("\n---\n")}`;
    }
  }
  const msgs: LlmMessage[] = [
    { role: "system", content: personaInstruction() + memoryBlock + docBlock },
    ...history.slice(-10),
    { role: "user", content: text },
  ];
  const result = await askLlm(msgs, usedDocs ? { skipCache: true } : undefined);
  maybeAutoRemember(text, text);
  return {
    content: result.content,
    provider: usedDocs ? `${result.provider} + your documents` : result.provider,
    latencyMs: result.latencyMs,
    confidence: result.confidence,
  };
}
