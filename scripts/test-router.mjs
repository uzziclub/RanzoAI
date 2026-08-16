// Functional test: bundles router + db together with an electron stub, then
// exercises classification, meta commands, and the memory/db layer.
import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Windows-safe: import paths inside generated source must use forward slashes,
// otherwise backslashes in e.g. D:\a\RanzoAI are treated as escapes by esbuild.
const cwd = process.cwd().replace(/\\/g, "/");

const stub = join(tmpdir(), "electron-stub.cjs");
writeFileSync(stub, "module.exports={Notification:class{static isSupported(){return false}show(){}},app:{},dialog:{}};");

const entry = join(tmpdir(), "router-entry.ts");
writeFileSync(entry, `
export { classify } from "${cwd}/electron/services/router";
export { initDb, addMemoryRow, listMemoriesRows, pushClipboard, clipboardHistory, addNotificationRow, listNotificationRows, cacheSet, cacheGet } from "${cwd}/electron/services/db";
export { searchMemories, maybeAutoRemember, forgetMatching } from "${cwd}/electron/services/memory";
export { getSettings, saveSettings } from "${cwd}/electron/services/settings";
export { initLogger } from "${cwd}/electron/services/logger";
`);

const outfile = join(tmpdir(), "ranzo-test-bundle.cjs");
await build({
  entryPoints: [entry], bundle: true, platform: "node", format: "cjs",
  outfile, external: ["node:sqlite"],
  alias: { electron: stub }, logLevel: "silent",
});

const m = await import(pathToFileURL(outfile).href);
const dir = mkdtempSync(join(tmpdir(), "ranzo-test-"));
m.initLogger(dir);
m.initDb(dir);

let pass = 0, fail = 0;
function expect(name, actual, wanted) {
  if (actual === wanted) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got "${actual}", wanted "${wanted}"`); }
}

// --- classification ---
expect("plain question -> local", m.classify("why is the sky blue?").target, "local");
expect("live data -> search", m.classify("what's the latest on the elections?").target, "search");
expect("open app -> action", m.classify("open notepad").target, "action");
expect("volume -> action", m.classify("set volume to 40").target, "action");
expect("delete file -> action", m.classify('delete the file "C:\\\\tmp\\\\x.txt"').target, "action");
expect("forget -> memory-command", m.classify("forget that I like tea").target, "memory-command");
expect("undo -> memory-command", m.classify("undo the last action").target, "memory-command");
expect("focus session -> memory-command", m.classify("start a focus session for 30 minutes").target, "memory-command");
expect("news request -> memory-command", m.classify("what's the news?").target, "memory-command");
expect("news word in sentence -> NOT news cmd", m.classify("I heard some news about my cousin yesterday, can you write a reply?").target, "local");
expect("persona switch -> memory-command", m.classify("focus mode").target, "memory-command");
expect("screenshot -> action", m.classify("take a screenshot").target, "action");
expect("clipboard -> action", m.classify("what is on my clipboard").target, "action");

// force-offline should keep live-data local
m.saveSettings({ forceOffline: true });
expect("live data offline -> local", m.classify("what's the latest on AI?").target, "local");
m.saveSettings({ forceOffline: false });

// --- memory ---
const mem = m.maybeAutoRemember("my name is Uzair", "my name is Uzair");
expect("auto-remember name", mem?.category, "people");
expect("credential refused", m.maybeAutoRemember("my password is hunter2", "x"), null);
const found = m.searchMemories("what is my name", 3);
expect("memory search finds name", found.length > 0, true);
const forgotten = m.forgetMatching("my name");
expect("forget removes", forgotten.forgotten, true);

// expiry phrasing
const weekMem = m.maybeAutoRemember("remember that the deadline is this week", "ctx");
expect("expiring memory has expiresAt", weekMem?.expiresAt != null, true);

// --- clipboard dedupe + cap ---
for (let i = 0; i < 30; i++) m.pushClipboard("item " + i);
m.pushClipboard("item 29"); // dupe
const clip = m.clipboardHistory();
expect("clipboard capped at 20", clip.length, 20);
expect("clipboard newest first", clip[0].content, "item 29");

// --- notifications ---
m.addNotificationRow("t", "b", "info");
expect("notification listed", m.listNotificationRows().length >= 1, true);

// --- cache ---
m.cacheSet("h1", "answer", "ollama");
expect("cache hit", m.cacheGet("h1")?.answer, "answer");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
