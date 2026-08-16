// ProviderManager — local brain first (Ollama), then the free cloud failover
// chain: Gemini (Google AI Studio) -> OpenRouter free models -> Hugging Face
// -> Puter.js (no key needed). Tavily powers live web search.
// No paid provider is ever required.

import { createHash } from "node:crypto";
import { getSettings } from "./settings";
import { logProvider, cacheGet, cacheSet } from "./db";
import { noteModelUse } from "./engine";
import { log } from "./logger";

export interface LlmResult {
  content: string;
  provider: string;
  latencyMs: number;
  confidence: "local" | "cloud" | "search" | "guess";
}

export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }

function hashQuestion(messages: LlmMessage[]): string {
  const last = messages[messages.length - 1]?.content ?? "";
  return createHash("sha256").update(last.trim().toLowerCase()).digest("hex");
}

async function askOllama(messages: LlmMessage[]): Promise<string> {
  const s = getSettings();
  const res = await fetch(`${s.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: s.ollamaModel, messages, stream: false, keep_alive: `${s.idleModelReleaseMinutes}m` }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const content = data.message?.content;
  if (!content) throw new Error("Ollama returned an empty reply");
  noteModelUse();
  return content;
}

async function askGemini(messages: LlmMessage[]): Promise<string> {
  const key = getSettings().geminiKey || process.env.RANZO_GEMINI_KEY;
  if (!key) throw new Error("no key");
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned an empty reply");
  return text;
}

async function askOpenRouter(messages: LlmMessage[]): Promise<string> {
  const key = getSettings().openrouterKey || process.env.RANZO_OPENROUTER_KEY;
  if (!key) throw new Error("no key");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "meta-llama/llama-3.3-70b-instruct:free", messages }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter returned an empty reply");
  return text;
}

async function askHuggingFace(messages: LlmMessage[]): Promise<string> {
  const key = getSettings().huggingfaceKey || process.env.RANZO_HF_KEY;
  if (!key) throw new Error("no key");
  const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "meta-llama/Llama-3.1-8B-Instruct", messages }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HuggingFace HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("HuggingFace returned an empty reply");
  return text;
}

async function askPuter(messages: LlmMessage[]): Promise<string> {
  // Puter.js public driver endpoint — requires no API key.
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const res = await fetch("https://api.puter.com/drivers/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      interface: "puter-chat-completion",
      driver: "openai-completion",
      method: "complete",
      args: { messages: [{ role: "user", content: prompt }] },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Puter HTTP ${res.status}`);
  const data = (await res.json()) as { result?: { message?: { content?: string } }; success?: boolean };
  const text = data.result?.message?.content;
  if (!text) throw new Error("Puter returned an empty reply");
  return text;
}

export async function webSearch(query: string): Promise<{ answer: string; sources: { title: string; url: string }[] } | null> {
  const key = getSettings().tavilyKey || process.env.RANZO_TAVILY_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query, include_answer: true, max_results: 5 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { answer?: string; results?: { title: string; url: string; content: string }[] };
    return {
      answer: data.answer ?? (data.results ?? []).map((r) => `${r.title}: ${r.content}`).join("\n\n"),
      sources: (data.results ?? []).map((r) => ({ title: r.title, url: r.url })),
    };
  } catch (err) {
    log("warn", "providers", `Tavily search failed: ${String(err)}`);
    return null;
  }
}

type Provider = { name: string; fn: (m: LlmMessage[]) => Promise<string>; confidence: "local" | "cloud" };

export async function askLlm(messages: LlmMessage[], opts?: { skipCache?: boolean }): Promise<LlmResult> {
  const s = getSettings();
  const qHash = hashQuestion(messages);

  if (!opts?.skipCache) {
    const hit = cacheGet(qHash);
    if (hit) return { content: hit.answer, provider: `${hit.provider} (cached)`, latencyMs: 0, confidence: hit.provider === "ollama" ? "local" : "cloud" };
  }

  const chain: Provider[] = [{ name: "ollama", fn: askOllama, confidence: "local" }];
  if (!s.forceOffline) {
    chain.push(
      { name: "gemini", fn: askGemini, confidence: "cloud" },
      { name: "openrouter", fn: askOpenRouter, confidence: "cloud" },
      { name: "huggingface", fn: askHuggingFace, confidence: "cloud" },
      { name: "puter", fn: askPuter, confidence: "cloud" },
    );
  }

  const errors: string[] = [];
  for (const p of chain) {
    const start = Date.now();
    try {
      const content = await p.fn(messages);
      const latencyMs = Date.now() - start;
      logProvider(p.name, latencyMs, true);
      cacheSet(qHash, content, p.name);
      return { content, provider: p.name, latencyMs, confidence: p.confidence };
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      if (msg !== "no key") {
        logProvider(p.name, Date.now() - start, false);
        log("warn", "providers", `${p.name} failed: ${msg}`);
      }
      errors.push(`${p.name}: ${msg}`);
    }
  }
  throw new Error(`ALL_PROVIDERS_FAILED: ${errors.join(" | ")}`);
}
