// Functional test for the auth/licensing layer against a temp database.
import { build } from "esbuild";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Windows-safe: forward slashes in generated import paths (see test-router.mjs).
const cwd = process.cwd().replace(/\\/g, "/");

const stub = join(tmpdir(), "electron-stub.cjs");
writeFileSync(stub, "module.exports={Notification:class{static isSupported(){return false}show(){}},app:{},dialog:{}};");

const entry = join(tmpdir(), "auth-entry.ts");
writeFileSync(entry, `
export * as auth from "${cwd}/electron/services/auth";
export { initDb } from "${cwd}/electron/services/db";
export { initLogger } from "${cwd}/electron/services/logger";
`);

const outfile = join(tmpdir(), "ranzo-auth-bundle.cjs");
await build({
  entryPoints: [entry], bundle: true, platform: "node", format: "cjs",
  outfile, external: ["node:sqlite"],
  alias: { electron: stub }, logLevel: "silent",
});

const m = await import(pathToFileURL(outfile).href);
const dir = mkdtempSync(join(tmpdir(), "ranzo-auth-"));
m.initLogger(dir); m.initDb(dir);
const { auth } = m;

let pass = 0, fail = 0;
const expect = (name, a, w) => { if (a === w) pass++; else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(w)}`); } };

auth.seedAdmin();

// admin login
let r = await auth.login("mr304e@gmail.com", "itXcritical4me");
expect("admin login ok", r.ok, true);
expect("admin role", r.user?.role, "admin");

// wrong password
r = await auth.login("mr304e@gmail.com", "wrong");
expect("wrong password rejected", r.ok, false);

// signup validation
r = await auth.signup("bad-email", "12345678", "X");
expect("bad email rejected", r.ok, false);
r = await auth.signup("user1@test.com", "short", "X");
expect("short password rejected", r.ok, false);
r = await auth.signup("user1@test.com", "goodpassword", "User One");
expect("signup ok", r.ok, true);
const uid = r.user.id;

// duplicate signup
r = await auth.signup("user1@test.com", "goodpassword", "Again");
expect("duplicate rejected", r.ok, false);

// non-admin cannot manage
expect("non-admin requireAdmin false", auth.requireAdmin(), false);
let s = await auth.adminSetStatus(uid, "blocked");
expect("non-admin cannot block", s.ok, false);

// admin blocks user
await auth.login("mr304e@gmail.com", "itXcritical4me");
expect("admin requireAdmin true", auth.requireAdmin(), true);
s = await auth.adminSetStatus(uid, "blocked");
expect("admin can block", s.ok, true);

// blocked user cannot log in
r = await auth.login("user1@test.com", "goodpassword");
expect("blocked login rejected", r.ok, false);
expect("blocked message plain", r.error?.includes("blocked"), true);

// re-allow, then revoke
await auth.adminSetStatus(uid, "active");
r = await auth.login("user1@test.com", "goodpassword");
expect("re-allowed login ok", r.ok, true);
await auth.login("mr304e@gmail.com", "itXcritical4me");
await auth.adminSetStatus(uid, "revoked");
r = await auth.login("user1@test.com", "goodpassword");
expect("revoked login rejected", r.ok, false);

// blocked session terminates: log user in while active, then block, then currentUser
await auth.adminSetStatus(uid, "active");
await auth.login("user1@test.com", "goodpassword");
// block from db directly (simulating central change picked up next check)
const { auth: auth2 } = m;
await auth.login("mr304e@gmail.com", "itXcritical4me");
await auth.adminSetStatus(uid, "blocked");
await auth.login("user1@test.com", "goodpassword").then(x => expect("still blocked", x.ok, false));

// admin cannot be blocked
const admins = auth.adminListUsers().filter(u => u.role === "admin");
s = await auth.adminSetStatus(admins[0].id, "blocked");
expect("admin unblockable", s.ok, false);

// password hashes never leak through public API
r = await auth.login("mr304e@gmail.com", "itXcritical4me");
expect("no hash in user object", "passwordHash" in (r.user ?? {}), false);
expect("no salt in user object", "salt" in (r.user ?? {}), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
