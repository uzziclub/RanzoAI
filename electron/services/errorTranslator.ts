// ErrorTranslator — converts internal failures into plain human sentences
// with a suggested fix. Raw errors go to the log, never to the user.

import { log } from "./logger";

export function translateError(err: unknown): string {
  const raw = String(err instanceof Error ? err.message : err);
  log("error", "translated", raw);

  if (raw.includes("ALL_PROVIDERS_FAILED")) {
    if (raw.includes("Ollama") || raw.includes("ECONNREFUSED") || raw.includes("fetch failed")) {
      return "I couldn't reach my local brain, and no cloud backup answered either. The quickest fix: press Start engine in the header, or check your internet connection.";
    }
    return "None of my brains could answer just now. Give it a moment and try again — if it keeps happening, open Diagnostics in Settings.";
  }
  if (raw.includes("ECONNREFUSED") && raw.includes("11434")) {
    return "The local engine isn't running. Press Start engine and I'll be right back.";
  }
  if (raw.includes("ENOTFOUND") || raw.includes("EAI_AGAIN")) {
    return "It looks like the internet is unreachable. I can still answer from my local brain — ask me again and I'll stay offline.";
  }
  if (raw.includes("timeout") || raw.includes("TimeoutError") || raw.includes("aborted")) {
    return "That took too long and I stopped waiting. It's usually a slow model or a busy network — try once more.";
  }
  if (raw.includes("needs Windows")) {
    return "That's a Windows system action, and I'm not running on Windows right now, so I can't actually do it here.";
  }
  if (raw.toLowerCase().includes("permission") || raw.includes("EACCES") || raw.includes("EPERM")) {
    return "Windows wouldn't let me do that — it needs higher permissions. Try running Ranzo as administrator if you really want this done.";
  }
  if (raw.includes("ENOENT")) {
    return "I couldn't find that file or program. Double-check the name or path and I'll try again.";
  }
  return "Something went wrong on my side. I've noted the details in the technical log — you can grab them from Settings → Advanced & Diagnostics if you want to dig in.";
}
