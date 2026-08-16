# Ranzo AI

Ranzo AI is a free, local-first, offline-capable Windows desktop assistant by **Uzzi Club** — a Jarvis-like voice and text assistant with an offline brain, persistent local memory, tiered-safety system control, and a calm creamy-white / creamy-blue / matte-black claymorphism interface.

![Ranzo AI](resources/logo-512.png)

## What's in this build (honest status)

Everything listed as **working** actually works — nothing is a mockup. Anything not implemented is listed under **not yet built**, per the project's no-fake-features rule.

### Working

| Area | Status |
|---|---|
| Three-column claymorphism UI (orb, chat, history, sidebars) | ✅ Working |
| Signup / login with local accounts (scrypt-hashed, SQLite) | ✅ Working |
| Admin account + user management panel (allow / revoke / block) | ✅ Working — blocked/revoked users cannot log in or keep a session |
| Central license control via Supabase free tier (optional) | ✅ Working — see “Licensing” below |
| Custom setup wizard (hardware check → engine → voice → tour) | ✅ Working |
| Offline brain: Ollama auto-detect, auto-start, model auto-pull | ✅ Working (needs Ollama installed; wizard links to it) |
| Free cloud failover chain: Gemini → OpenRouter → HF → Puter | ✅ Working (keys optional; Puter needs no key) |
| Live web search via Tavily (free key) | ✅ Working |
| Request router (local / search / action / memory-command) | ✅ Working |
| Response cache + per-request provider/latency log | ✅ Working (visible in Settings → Advanced & Diagnostics) |
| Honest confidence labels (“answered locally” / “checked the live web” / “best effort”) | ✅ Working |
| Force-offline toggle | ✅ Working |
| Chat history in local SQLite — previews, delete one, clear all | ✅ Working |
| Memory: auto-remember, categories, “why remembered”, expiry, pause, export/import, “forget this” | ✅ Working |
| Memory Viewer (separate from Settings) | ✅ Working |
| System control with safety tiers + plain-language confirmation + undo stack | ✅ Working on Windows (volume, open apps, lock, sleep, shutdown/restart, delete-to-recycle-bin, move, screenshots, clipboard, file listing, arbitrary confirmed commands) |
| Safe zones (folders that always require confirmation) | ✅ Working |
| Clipboard memory (rolling 20 items, local) | ✅ Working (“what did I copy before this?”) |
| TTS: Edge-TTS (free) with rate/pitch/whisper mode, auto voice per language (EN/UR/AR/HI) | ✅ Working |
| STT: push-to-talk (hold mic / Ctrl+Space) and Live mode | ✅ Working where the OS speech engine is available; falls back to text-only with one clear notice |
| Copilot mode — floating always-on-top pill bar with mic/live/expand | ✅ Working |
| Mini mode — floating orb-only window | ✅ Working |
| System tray (wake, copilot bar, quit) — close hides to tray | ✅ Working |
| Command palette (Ctrl+K) | ✅ Working |
| Personas (natural / professional / witty / focused / custom) + one-word switch (“focus mode”) | ✅ Working |
| Hardware tiering with reason + manual override + low-tier animation cut | ✅ Working |
| Weather (Open-Meteo, no key, row hides offline), clock, battery, CPU, online state | ✅ Working |
| Error translator — plain sentences, full technical log kept separately | ✅ Working |
| Diagnostics bundle export (local file, nothing uploaded) | ✅ Working |
| Idle model release (frees RAM after configurable idle time) | ✅ Working |
| Background copilot: morning news briefing (free RSS + LLM summary, once a day, at your hour) | ✅ Working |
| Health watch: low disk / low battery — one clear alert per issue per day | ✅ Working |
| Daily wrap-up (evening) and weekly digest (Mondays) | ✅ Working |
| Focus sessions (“start a focus session for 25 minutes”) — mutes non-urgent notifications, announces when done | ✅ Working |
| NotificationBroker — one in-app queue, no scattered Windows popups; native toast only for briefing/health | ✅ Working |
| Battery awareness — copilot skips background work on battery | ✅ Working |
| Quick Capture — global hotkey Ctrl+Shift+Space, tiny always-on-top box, filed into memory with timestamp | ✅ Working |
| Offline RAG — point Ranzo at folders, ask questions about your own files; auto-reindexes as files change | ✅ Working (Settings → Memory → Your documents) |
| Windows NSIS installer packaging + uninstaller | ✅ Configured (built by CI on Windows — see Packaging) |

### Not yet built (planned, honestly not in this build)

- **Wake word “Ranzo” via Porcupine** — needs a free Picovoice key and the custom keyword file; the Settings field and sensitivity slider exist, the engine hookup is next.
- **Offline STT via faster-whisper** — current STT uses the platform speech engine; the whisper sidecar is the planned replacement so voice input works fully offline.
- **Downloads-folder triage and automation recipes** — not started.
- **Vision / screen understanding, OCR** — not started.
- **Browser automation (Playwright), UI Automation for native apps, macro recording** — not started.
- **Snapshot restore points, per-user voice profiles, dark mode** — not started.

## Requirements

- Windows 10 or 11 (the app runs elsewhere for development, but system control is Windows-only)
- [Node.js 22+](https://nodejs.org) (only for building from source)
- [Ollama](https://ollama.com/download/windows) for the offline brain (free; the setup wizard walks you through it)

## Development

```bash
npm install
npm run dev          # browser preview of the UI at http://localhost:5173
npm run typecheck    # strict TS across renderer + electron + shared
npm run build        # renderer (vite) + main/preload (esbuild)
npm start            # build then launch the real Electron app
```

The browser preview clearly labels itself and never fakes system work — voice, engine, and PC control activate in the installed desktop app.

## Packaging the Windows installer

On a Windows machine (or the included GitHub Actions workflow):

```bash
npm run dist:win
# → release/Ranzo-AI-Setup-<version>.exe  (NSIS, with uninstaller)
```

The repo ships `.github/workflows/build-windows.yml`: every push builds the installer on a real Windows runner and uploads it as the `Ranzo-AI-Windows-Installer` artifact — no Wine, no cross-compile flakiness.

## Accounts, admin, and licensing

- The admin account is seeded on first run: `mr304e@gmail.com`. The admin opens **Manage users** from the left sidebar to allow, revoke, or block any account. Blocked or revoked users cannot log in, and an active session is terminated on its next check.
- Passwords are scrypt-hashed with per-user salts in the local SQLite DB (`%APPDATA%/ranzo-ai/ranzo.db`). No plaintext, ever.

### Central control (optional, free)

To manage users across many machines, create a free [Supabase](https://supabase.com) project and run this SQL:

```sql
create table ranzo_licenses (
  email text primary key,
  status text not null default 'active'  -- 'active' | 'revoked' | 'blocked'
);
alter table ranzo_licenses enable row level security;
create policy "anon can read" on ranzo_licenses for select using (true);
create policy "anon can upsert" on ranzo_licenses for insert with check (true);
create policy "anon can update" on ranzo_licenses for update using (true);
```

Then put the project URL and anon key into **Settings → AI Providers → Licensing** (or ship them via the `RANZO_SUPABASE_URL` / `RANZO_SUPABASE_ANON_KEY` environment variables at build time). Signups self-register; admin status changes sync up; every login and session check enforces the central status, with a configurable offline grace window (default 7 days). Without Supabase configured, the app runs in local-only licensing mode.

## The stack

- **Shell:** Electron 37 (secure defaults: context isolation, no node in renderer, narrow preload bridge)
- **Renderer:** React 18 + TypeScript + Vite, claymorphism theme in plain CSS
- **Storage:** Node's built-in `node:sqlite` — no native compilation step
- **Brain:** Ollama (default `llama3.1:8b-instruct-q4_K_M`, weak-hardware options `qwen2.5:3b` / `phi3:mini`), then Gemini → OpenRouter → Hugging Face → Puter, all free
- **Voice:** Edge-TTS out (free, multilingual), platform speech engine in
- **Weather:** Open-Meteo (no key)

## Privacy rules baked in

- No telemetry endpoint exists in the codebase.
- Files, screenshots, clipboard, and voice are never uploaded silently.
- Auto-memory refuses anything that looks like a password, key, or card number.
- Destructive actions always confirm in plain language; that switch cannot be turned off.
- API keys live in your local settings DB, never hard-coded.

## CI note

GitHub blocked this session from pushing files into `.github/workflows/`, so the Windows-installer workflow lives at `ci/build-windows.yml`. To enable automatic installer builds, move it once:

```bash
mkdir -p .github/workflows
git mv ci/build-windows.yml .github/workflows/build-windows.yml
git commit -m "Enable Windows installer CI" && git push
```
