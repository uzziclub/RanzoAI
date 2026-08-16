// Tests for the curated voice catalog and language/gender resolution rules.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = join(tmpdir(), "voices-entry.ts");
writeFileSync(entry, `export * from "${process.cwd()}/shared/voices";`);
await build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", outfile: "/tmp/ranzo-voices.cjs", logLevel: "silent" });
const v = await import("/tmp/ranzo-voices.cjs");

let pass = 0, fail = 0;
const expect = (name, a, w) => { if (a === w) pass++; else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(w)}`); } };

// catalog sanity: both genders present, all voices are neural, default exists
expect("has male voices", v.CURATED_VOICES.some(x => x.gender === "male"), true);
expect("has female voices", v.CURATED_VOICES.some(x => x.gender === "female"), true);
expect("all neural", v.CURATED_VOICES.every(x => x.id.includes("Neural")), true);
expect("default in catalog", Boolean(v.voiceById(v.DEFAULT_VOICE)), true);
expect("default is multilingual", v.voiceById(v.DEFAULT_VOICE).multilingual, true);

// multilingual voices keep themselves for any language
expect("multilingual keeps for ur", v.resolveVoiceForLanguage("en-US-AvaMultilingualNeural", "ur"), "en-US-AvaMultilingualNeural");
expect("multilingual keeps for ar", v.resolveVoiceForLanguage("en-US-AndrewMultilingualNeural", "ar"), "en-US-AndrewMultilingualNeural");

// classic voices hand off to the SAME GENDER native voice
expect("Guy(male) -> Urdu male", v.resolveVoiceForLanguage("en-US-GuyNeural", "ur"), "ur-PK-AsadNeural");
expect("Jenny(female) -> Urdu female", v.resolveVoiceForLanguage("en-US-JennyNeural", "ur"), "ur-PK-UzmaNeural");
expect("Jenny(female) -> Arabic female", v.resolveVoiceForLanguage("en-US-JennyNeural", "ar"), "ar-SA-ZariyahNeural");
expect("Guy(male) -> Hindi male", v.resolveVoiceForLanguage("en-US-GuyNeural", "hi"), "hi-IN-MadhurNeural");

// english stays as chosen
expect("english unchanged", v.resolveVoiceForLanguage("en-US-JennyNeural", "en"), "en-US-JennyNeural");

// fallback keeps gender
expect("female fallback", v.fallbackVoice("en-US-AvaMultilingualNeural"), "en-US-JennyNeural");
expect("male fallback", v.fallbackVoice("en-US-BrianMultilingualNeural"), "en-US-GuyNeural");

// gender inference for language voices
expect("Uzma is female", v.genderOf("ur-PK-UzmaNeural"), "female");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
