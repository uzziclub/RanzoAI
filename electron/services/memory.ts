// MemoryService — long-term memory with keyword scoring (local, inspectable).
// A full vector DB (Chroma/Lance) can slot in behind the same interface later;
// for v1 this uses deterministic TF-style keyword retrieval, fully offline.

import type { MemoryItem } from "../../shared/types";
import { addMemoryRow, listMemoriesRows, updateMemoryRow, deleteMemoryRow } from "./db";
import { getSettings } from "./settings";
import { log } from "./logger";

const STOPWORDS = new Set("the a an and or but of to in on for with is are was were be i you he she it we they my your this that at as by from".split(" "));

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function searchMemories(query: string, limit = 5): MemoryItem[] {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return [];
  const scored = listMemoriesRows()
    .map((m) => {
      const mTokens = tokenize(m.content);
      let score = 0;
      for (const t of mTokens) if (qTokens.has(t)) score++;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.m);
}

const REMEMBER_PATTERNS: { re: RegExp; category: MemoryItem["category"] }[] = [
  { re: /\bmy name is\b|\bcall me\b/i, category: "people" },
  { re: /\bi (?:like|love|prefer|hate|dislike|enjoy)\b/i, category: "preferences" },
  { re: /\bi(?:'m| am) (?:working on|building|developing)\b/i, category: "projects" },
  { re: /\bremember (?:that|this)?\b/i, category: "facts" },
  { re: /\bmy (?:birthday|email|phone|address|city|job|company) (?:is|number is)\b/i, category: "people" },
];

const SENSITIVE = /\b(password|passcode|pin\s?code|credit card|cvv|api[_\s-]?key|secret key|token)\b/i;

export function maybeAutoRemember(userText: string, chatContext: string): MemoryItem | null {
  const s = getSettings();
  if (!s.memoryEnabled || s.memoryPaused) return null;
  // Never store credentials or secrets — locked rule.
  if (SENSITIVE.test(userText)) {
    log("info", "memory", "Skipped auto-remember: looks like a credential.");
    return null;
  }
  for (const p of REMEMBER_PATTERNS) {
    if (p.re.test(userText)) {
      // Expiry: things phrased as "this week / today / tomorrow" expire automatically.
      let expiresAt: number | null = null;
      if (/\b(this week|today|tomorrow|tonight)\b/i.test(userText)) {
        expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
      }
      const existing = listMemoriesRows().find((m) => m.content === userText.trim());
      if (existing) return null;
      return addMemoryRow(userText.trim(), p.category, `From conversation: "${chatContext.slice(0, 80)}"`, expiresAt);
    }
  }
  return null;
}

export function forgetMatching(query: string): { forgotten: boolean; content?: string } {
  const matches = searchMemories(query, 1);
  if (matches.length === 0) return { forgotten: false };
  deleteMemoryRow(matches[0].id);
  return { forgotten: true, content: matches[0].content };
}

export const memoryApi = {
  list: listMemoriesRows,
  add: (content: string, category: MemoryItem["category"]) => addMemoryRow(content, category, "Added manually in the Memory Viewer"),
  update: updateMemoryRow,
  remove: deleteMemoryRow,
};
