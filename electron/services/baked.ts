// Build-time baked configuration.
//
// Ranzo reads optional API keys and the Supabase licensing config from three
// places, in this order:
//   1. the user's own Settings (typed into the app, stored in the local DB)
//   2. a runtime environment variable (handy while developing)
//   3. a value baked into the bundle at build time (this file)
//
// The baked values come from `scripts/build-electron.mjs`, which passes them to
// esbuild as a `define` so the packaged app carries them without shipping a
// plaintext config file next to the .exe. CI supplies them from GitHub Actions
// secrets; when a secret is absent the key is simply not baked, and the feature
// stays optional exactly as before.
//
// Nothing here ever logs a secret value — only the *names* of baked keys are
// ever exposed (in diagnostics), so a support bundle can say "a Gemini key was
// baked in" without leaking it.

declare const __RANZO_BAKED_CONFIG__: Record<string, string> | undefined;

export const BAKEABLE_KEYS = [
  "RANZO_SUPABASE_URL",
  "RANZO_SUPABASE_ANON_KEY",
  "RANZO_GEMINI_KEY",
  "RANZO_OPENROUTER_KEY",
  "RANZO_HF_KEY",
  "RANZO_TAVILY_KEY",
  "RANZO_PICOVOICE_KEY",
] as const;

export type BakeableKey = (typeof BAKEABLE_KEYS)[number];

// `typeof` on a possibly-undeclared identifier is safe in JS, so an unbaked
// build (plain `npm run build` with no secrets) never throws here.
const BAKED: Record<string, string> =
  typeof __RANZO_BAKED_CONFIG__ !== "undefined" && __RANZO_BAKED_CONFIG__ ? __RANZO_BAKED_CONFIG__ : {};

function clean(value: string | undefined): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Resolve a build-time secret: runtime environment first (so a developer can
 * override a baked value without rebuilding), then the baked bundle value.
 * Returns "" when neither is present — callers treat that as "not configured".
 */
export function bakedSecret(key: BakeableKey): string {
  return clean(process.env[key]) || clean(BAKED[key]);
}

/** Names (never values) of the keys that were baked into this build. */
export function bakedKeyNames(): BakeableKey[] {
  return BAKEABLE_KEYS.filter((k) => clean(BAKED[k]) !== "");
}

/** True when this build carries any baked configuration at all. */
export function hasBakedConfig(): boolean {
  return bakedKeyNames().length > 0;
}
