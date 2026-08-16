# Publishing Ranzo AI

The complete path from this repository to a downloadable `Ranzo-AI-Setup-1.0.0.exe` your users can install. Everything here is free.

## One-time setup (5 minutes)

1. **Enable the CI workflow** (GitHub blocked the build agent from creating it, so it lives in `ci/`):

   ```bash
   mkdir -p .github/workflows
   git mv ci/build-windows.yml .github/workflows/build-windows.yml
   git commit -m "Enable Windows installer CI"
   git push
   ```

2. That's it. Every push now builds, typechecks, runs all 57 tests, and produces the installer on a real Windows runner.

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

Your public download link will be:
`https://github.com/uzziclub/RanzoAI/releases/latest`

## Building on any Windows PC instead (no CI)

```bash
npm ci
npm run dist:win
# → release/Ranzo-AI-Setup-1.0.0.exe
```

## Before you ship — checklist

- [ ] `npm test` — 57/57 green
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
- No auto-update in v1 (by design). To ship an update: bump version, tag, publish the new release, tell users to download it.
