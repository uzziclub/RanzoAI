// Tests for build-time secret injection (services/baked.ts + the build script
// and CI wiring that feed it). Nothing here uses a real key — only sentinels.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cwd = process.cwd().replace(/\\/g, "/");

// Compile services/baked.ts the same way scripts/build-electron.mjs does, with
// an optional `define` standing in for the values CI bakes in.
let counter = 0;
async function loadBaked(bakedValues) {
  const entry = join(tmpdir(), `baked-entry-${counter}.ts`);
  writeFileSync(entry, `export * from "${cwd}/electron/services/baked";`);
  const outfile = join(tmpdir(), `ranzo-baked-${counter++}.cjs`);
  await build({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent",
    define: bakedValues ? { __RANZO_BAKED_CONFIG__: JSON.stringify(bakedValues) } : undefined,
  });
  return import(pathToFileURL(outfile).href);
}

let pass = 0, fail = 0;
const expect = (name, a, w) => {
  const got = JSON.stringify(a), want = JSON.stringify(w);
  if (got === want) pass++; else { fail++; console.error(`FAIL ${name}: got ${got}, wanted ${want}`); }
};

// --- an unbaked build (plain `npm run build`) must not throw and must stay empty
delete process.env.RANZO_GEMINI_KEY;
delete process.env.RANZO_SUPABASE_URL;
const plain = await loadBaked(null);
expect("unbaked: no keys", plain.bakedKeyNames(), []);
expect("unbaked: nothing baked", plain.hasBakedConfig(), false);
expect("unbaked: secret is empty string", plain.bakedSecret("RANZO_GEMINI_KEY"), "");

// --- a baked build carries the value
const baked = await loadBaked({ RANZO_GEMINI_KEY: "sentinel-gemini", RANZO_SUPABASE_URL: "https://sentinel.supabase.co" });
expect("baked: value returned", baked.bakedSecret("RANZO_GEMINI_KEY"), "sentinel-gemini");
expect("baked: supabase url returned", baked.bakedSecret("RANZO_SUPABASE_URL"), "https://sentinel.supabase.co");
expect("baked: names listed", baked.bakedKeyNames(), ["RANZO_SUPABASE_URL", "RANZO_GEMINI_KEY"]);
expect("baked: unbaked key still empty", baked.bakedSecret("RANZO_TAVILY_KEY"), "");
expect("baked: hasBakedConfig", baked.hasBakedConfig(), true);

// --- names only: the helper never hands out values
expect("names never contain values", baked.bakedKeyNames().some((n) => n.includes("sentinel")), false);

// --- blank/whitespace bakes are ignored rather than counting as configured
const blank = await loadBaked({ RANZO_TAVILY_KEY: "   ", RANZO_HF_KEY: "" });
expect("blank baked value ignored", blank.bakedSecret("RANZO_TAVILY_KEY"), "");
expect("blank baked names empty", blank.bakedKeyNames(), []);

// --- a runtime env var overrides the baked value (developer escape hatch)
process.env.RANZO_GEMINI_KEY = "from-environment";
const overridden = await loadBaked({ RANZO_GEMINI_KEY: "sentinel-gemini" });
expect("env overrides baked", overridden.bakedSecret("RANZO_GEMINI_KEY"), "from-environment");
delete process.env.RANZO_GEMINI_KEY;

// --- the build script and CI must know about exactly the same keys
const keys = plain.BAKEABLE_KEYS;
const buildScript = readFileSync("scripts/build-electron.mjs", "utf8");
// CI lives in two places: ci/build-windows.yml is the copy this repo's build
// agent is allowed to edit, .github/workflows/build-windows.yml is what
// actually runs. The pending copy is the one that must stay in step with the
// code; PUBLISHING.md explains the one-command promotion.
const workflow = readFileSync("ci/build-windows.yml", "utf8");
expect("build script bakes every key", keys.filter((k) => !buildScript.includes(k)), []);
expect("workflow passes every key", keys.filter((k) => !workflow.includes(`${k}: \${{ secrets.${k} }}`)), []);
expect("build script defines the bundle global", buildScript.includes("__RANZO_BAKED_CONFIG__"), true);

// --- auto-update metadata must ride along with the installer in releases
expect("release attaches latest.yml", workflow.includes("release/latest.yml"), true);
expect("release attaches blockmap", workflow.includes("release/Ranzo-AI-Setup-*.exe.blockmap"), true);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
expect("publish provider configured", pkg.build.publish?.[0]?.provider, "github");
expect("publish repo correct", `${pkg.build.publish?.[0]?.owner}/${pkg.build.publish?.[0]?.repo}`, "uzziclub/RanzoAI");

// --- the services that consume secrets go through the helper, not raw env
const auth = readFileSync("electron/services/auth.ts", "utf8");
const providers = readFileSync("electron/services/providers.ts", "utf8");
expect("auth uses bakedSecret", auth.includes('bakedSecret("RANZO_SUPABASE_URL")'), true);
expect("providers use bakedSecret", ["GEMINI", "OPENROUTER", "HF", "TAVILY"].filter((n) => !providers.includes(`bakedSecret("RANZO_${n}_KEY")`)), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
