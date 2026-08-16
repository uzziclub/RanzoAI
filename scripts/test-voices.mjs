// Tests for the curated voice catalog and language/gender resolution rules.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const entry = join(tmpdir(), "voices-entry.ts");
// Windows-safe: forward slashes in generated import paths (see test-router.mjs).
writeFileSync(entry, `export * from "${process.cwd().replace(/\\/g, "/")}/shared/voices";`);
const outfile = join(tmpdir(), "ranzo-voices.cjs");
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent" });
const v = await import(pathToFileURL(outfile).href);

// english stays as chosen
expect("english unchanged", v.resolveVoiceForLanguage("en-US-JennyNeural", "en"), "en-US-JennyNeural");

// fallback keeps gender
expect("female fallback", v.fallbackVoice("en-US-AvaMultilingualNeural"), "en-US-JennyNeural");
expect("male fallback", v.fallbackVoice("en-US-BrianMultilingualNeural"), "en-US-GuyNeural");

// gender inference for language voices
expect("Uzma is female", v.genderOf("ur-PK-UzmaNeural"), "female");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
