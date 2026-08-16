// Local knowledge base — offline Q&A over folders the user chooses.
// Fully local: files are read, chunked, and indexed with the same
// deterministic keyword scoring used by MemoryService. Nothing is uploaded.
// The index refreshes automatically when files change (cheap mtime scan on
// the copilot heartbeat) and can be rebuilt on demand.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { getSettingRow, setSettingRow } from "./db";
import { log } from "./logger";

const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log", ".ini", ".cfg", ".yaml", ".yml", ".html", ".htm", ".xml", ".js", ".ts", ".py", ".rs", ".java", ".c", ".cpp", ".cs", ".sql", ".sh", ".ps1", ".bat"]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 2000;
const CHUNK_CHARS = 1200;

interface Chunk { file: string; part: number; text: string }

let index: Chunk[] = [];
let indexedAt = 0;
let indexing = false;

export function getKnowledgeFolders(): string[] {
  const raw = getSettingRow("knowledge-folders");
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export function setKnowledgeFolders(folders: string[]) {
  setSettingRow("knowledge-folders", JSON.stringify(folders));
  void rebuildIndex();
}

function* walk(dir: string, depth = 0): Generator<string> {
  if (depth > 6) return;
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules" || name === "__pycache__") continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.isDirectory()) yield* walk(full, depth + 1);
      else if (st.isFile() && TEXT_EXTS.has(extname(name).toLowerCase()) && st.size <= MAX_FILE_BYTES) yield full;
    } catch { /* skip unreadable */ }
  }
}

export async function rebuildIndex(): Promise<{ files: number; chunks: number }> {
  if (indexing) return { files: 0, chunks: index.length };
  indexing = true;
  try {
    const folders = getKnowledgeFolders();
    const next: Chunk[] = [];
    let fileCount = 0;
    for (const folder of folders) {
      for (const file of walk(folder)) {
        if (fileCount >= MAX_FILES) break;
        try {
          const text = readFileSync(file, "utf8");
          for (let i = 0; i * CHUNK_CHARS < text.length && i < 40; i++) {
            next.push({ file, part: i, text: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
          }
          fileCount++;
        } catch { /* unreadable — skip */ }
      }
    }
    index = next;
    indexedAt = Date.now();
    log("info", "knowledge", `Indexed ${fileCount} files, ${next.length} chunks from ${folders.length} folder(s).`);
    return { files: fileCount, chunks: next.length };
  } finally {
    indexing = false;
  }
}

const STOP = new Set("the a an and or but of to in on for with is are was were be i you it we they this that at as by from".split(" "));
function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
}

export function searchKnowledge(query: string, limit = 4): { file: string; text: string }[] {
  if (index.length === 0) return [];
  const q = new Set(tokens(query));
  if (q.size === 0) return [];
  return index
    .map((c) => {
      let score = 0;
      for (const t of tokens(c.text)) if (q.has(t)) score++;
      return { c, score };
    })
    .filter((x) => x.score > 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ file: basename(x.c.file), text: x.c.text.slice(0, 800) }));
}

export function knowledgeStatus(): { folders: string[]; chunks: number; indexedAt: number } {
  return { folders: getKnowledgeFolders(), chunks: index.length, indexedAt };
}

// Cheap change detection for the copilot heartbeat: re-index at most every
// 10 minutes and only when a folder's newest mtime moved.
let lastScanAt = 0;
export function maybeRefresh() {
  if (Date.now() - lastScanAt < 10 * 60_000) return;
  lastScanAt = Date.now();
  const folders = getKnowledgeFolders();
  if (folders.length === 0) return;
  let newest = 0;
  for (const folder of folders) {
    for (const file of walk(folder)) {
      try {
        const m = statSync(file).mtimeMs;
        if (m > newest) newest = m;
      } catch { /* skip */ }
    }
  }
  if (newest > indexedAt) void rebuildIndex();
}
