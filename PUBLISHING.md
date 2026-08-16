# Publishing Ranzo AI

The complete path from this repository to a downloadable `Ranzo-AI-Setup-1.0.0.exe` your users can install. Everything here is free.

## One-time setup (1 minute)

The CI workflow already runs from `.github/workflows/build-windows.yml` — every push builds, typechecks, runs all 78 tests, and produces the installer on a real Windows runner.

**One pending change to apply.** GitHub blocks this repo's build agent from writing to `.github/workflows/`, so updates to the pipeline are staged in `ci/build-windows.yml`. That copy is currently ahead of the live workflow: it adds the build-time secret injection and attaches the update metadata to releases. Promote it once:

```bash
cp ci/build-windows.yml .github/workflows/build-windows.yml
git commit -am "Update Windows installer CI"
git push
```

Until you do, builds keep working exactly as before — they just won't bake in secrets or publish `latest.yml`.

### Optional: bake your configuration into the installer

Add any of these under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Effect |
|---|---|
| `RANZO_SUPABASE_URL` | licensing project URL |
| `RANZO_SUPABASE_ANON_KEY` | licensing project anon key |
| `RANZO_GEMINI_KEY` | Gemini fallback preconfigured |
| `RANZO_OPENROUTER_KEY` | OpenRouter fallback preconfigured |
| `RANZO_HF_KEY` | Hugging Face fallback preconfigured |
| `RANZO_TAVILY_KEY` | live web search preconfigured |
| `RANZO_PICOVOICE_KEY` | reserved for the wake word |

Skip any you don't have — an unset secret is not baked in, and that feature keeps working exactly as before (asks in Settings, or stays off). Baked values are inlined into `dist-electron/main.js` at build time; the build log lists only the key *names*, and a user typing their own key in Settings always overrides the baked one.

To bake values into a local build instead:

```bash
set RANZO_TAVILY_KEY=your-key
npm run dist:win
```

## Releasing a version

```bash
# 1. Bump the version
npm version 1.0.0 --no-git-tag-version
git commit -am "Release 1.0.0"

# 2. Tag and push — the tag triggers the release build
git tag v1.0.0
git push && git push --tags
```

GitHub Actions then automatically:
- builds `Ranzo-AI-Setup-1.0.0.exe` (NSIS, x64, installer + uninstaller, license screen)
- creates a **GitHub Release** with the installer attached and auto-generated notes
- attaches the update metadata — `latest.yml` and `Ranzo-AI-Setup-1.0.0.exe.blockmap` — alongside it (once the CI change above is promoted)

Your public download link will be:
`https://github.com/uzziclub/RanzoAI/releases/latest`

## Building on any Windows PC instead (no CI)

```bash
npm ci
npm run dist:win
# → release/Ranzo-AI-Setup-1.0.0.exe
```

## Before you ship — checklist

- [ ] `npm test` — 78/78 green
- [ ] `npm run typecheck` — clean
- [ ] Install the .exe on a clean Windows 10/11 machine
- [ ] First-run: signup → wizard → Ollama install prompt → chat works
- [ ] Admin login works (`mr304e@gmail.com`)
- [ ] (Optional) Set up the Supabase licensing project — see README → “Central control” — and bake the URL/key in via `RANZO_SUPABASE_URL` / `RANZO_SUPABASE_ANON_KEY` at build time, or enter them in Settings → AI Providers → Licensing after install

## Code signing (recommended, not required)

Unsigned installers trigger Windows SmartScreen (“unrecognized app”) until your download reputation builds. Users can click “More info → Run anyway”, and it goes away over time on its own.

To remove it immediately you'd need an OV/EV code-signing certificate (paid, ~$100+/yr). When you have one:

```bash
set CSC_LINK=path\to\cert.pfx
set CSC_KEY_PASSWORD=yourpassword
npm run dist:win
```

electron-builder signs automatically when those variables are set. Until then, ship unsigned — it's how most indie apps start.

## What the installer contains

- NSIS installer with license (EULA) screen, install-dir choice, desktop + start-menu shortcuts, proper uninstaller
- App ID `club.uzzi.ranzoai`, publisher “Uzzi Club”
- User data lives in `%APPDATA%/ranzo-ai/` (database, logs, settings) and survives reinstalls; the uninstaller leaves it alone
- No updater runs inside the app in v1 (by design). To ship an update: bump version, tag, publish the new release, tell users to download it.
- Releases do carry `latest.yml` + `.blockmap`, generated from the `publish` block in `package.json`. Those are exactly the files an `electron-updater` client reads, so switching auto-update on later is a client-side change only — the release side is already correct, and old installers are unaffected.
