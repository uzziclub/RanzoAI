import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist-electron", { recursive: true });

// ---- build-time secret injection -------------------------------------------
// Any of these present in the environment at build time gets baked into the
// main bundle, so a packaged installer can ship with the licensing project and
// optional free-tier keys already configured. Absent ones are simply skipped —
// the app then behaves exactly as it does today and asks in Settings.
// Values are never printed; only the key names are logged.
const BAKEABLE_KEYS = [
  "RANZO_SUPABASE_URL",
  "RANZO_SUPABASE_ANON_KEY",
  "RANZO_GEMINI_KEY",
  "RANZO_OPENROUTER_KEY",
  "RANZO_HF_KEY",
  "RANZO_TAVILY_KEY",
  "RANZO_PICOVOICE_KEY",
];

const baked = {};
for (const key of BAKEABLE_KEYS) {
  const value = process.env[key];
  if (typeof value === "string" && value.trim()) baked[key] = value.trim();
}

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron", "node:sqlite"],
  sourcemap: false,
  minify: false,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.js",
  define: { __RANZO_BAKED_CONFIG__: JSON.stringify(baked) },
});

await build({
  ...common,
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.js",
});

const bakedNames = Object.keys(baked);
console.log(
  bakedNames.length
    ? `Electron main + preload bundled. Baked in at build time: ${bakedNames.join(", ")}.`
    : "Electron main + preload bundled. No build-time keys baked in (all optional).",
);
