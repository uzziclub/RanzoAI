// AuthService — commercial licensing with a local account store plus optional
// central control through Supabase (free tier).
//
// How access control works:
// 1. Accounts are created and verified locally (scrypt-hashed passwords, SQLite).
// 2. If a Supabase project is configured (Settings > AI Providers > Licensing or
//    the RANZO_SUPABASE_URL / RANZO_SUPABASE_ANON_KEY env vars), every login and
//    every app start checks the central `ranzo_licenses` table. The admin can set
//    a user's status to active / revoked / blocked from any machine, and the
//    change takes effect on the user's next online check.
// 3. Offline grace: if the machine is offline, the last known central status is
//    honored for `offlineGraceDays` days, after which Ranzo requires one online
//    check. Blocked users are locked out immediately once the status is known.
//
// The admin account (mr304e@gmail.com) is seeded on first run and cannot be
// blocked or revoked from inside the app.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthResult, UserAccount } from "../../shared/types";
import {
  getUserByEmail, getUserById, insertUser, listUsers, setUserStatus, touchLogin,
  getSettingRow, setSettingRow,
} from "./db";
import { getSettings } from "./settings";
import { log } from "./logger";

const ADMIN_EMAIL = "mr304e@gmail.com";
const ADMIN_PASSWORD = "itXcritical4me";

let currentUserId: string | null = null;

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function seedAdmin() {
  if (!getUserByEmail(ADMIN_EMAIL)) {
    const salt = randomBytes(16).toString("hex");
    insertUser({
      email: ADMIN_EMAIL,
      name: "Admin",
      passwordHash: hashPassword(ADMIN_PASSWORD, salt),
      salt,
      role: "admin",
    });
    log("info", "auth", "Admin account seeded.");
  }
  // Restore remembered session
  const remembered = getSettingRow("session-user-id");
  if (remembered && getUserById(remembered)) currentUserId = remembered;
}

function supabaseConfig(): { url: string; key: string } | null {
  const s = getSettings();
  const url = s.supabaseUrl || process.env.RANZO_SUPABASE_URL || "";
  const key = s.supabaseAnonKey || process.env.RANZO_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return { url, key };
}

interface CentralStatus {
  status: "active" | "revoked" | "blocked";
  checkedAt: number;
}

async function checkCentralStatus(email: string): Promise<CentralStatus | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.url.replace(/\/$/, "")}/rest/v1/ranzo_licenses?email=eq.${encodeURIComponent(email.toLowerCase())}&select=status`,
      {
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      log("warn", "auth", `Central license check HTTP ${res.status}`);
      return null;
    }
    const rows = (await res.json()) as { status?: string }[];
    const status = (rows[0]?.status ?? "active") as CentralStatus["status"];
    const result: CentralStatus = { status, checkedAt: Date.now() };
    setSettingRow(`license-cache:${email.toLowerCase()}`, JSON.stringify(result));
    return result;
  } catch (err) {
    log("warn", "auth", `Central license check failed (offline?): ${String(err)}`);
    return null;
  }
}

async function pushCentralStatus(email: string, status: string): Promise<boolean> {
  const cfg = supabaseConfig();
  if (!cfg) return false;
  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/ranzo_licenses`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ email: email.toLowerCase(), status }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function cachedCentralStatus(email: string): CentralStatus | null {
  const raw = getSettingRow(`license-cache:${email.toLowerCase()}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as CentralStatus; } catch { return null; }
}

async function effectiveStatus(user: UserAccount): Promise<"active" | "revoked" | "blocked" | "grace-expired"> {
  if (user.role === "admin") return "active";
  // Local status wins when it is a restriction (admin set it on this machine).
  if (user.status !== "active") return user.status;
  const central = (await checkCentralStatus(user.email)) ?? cachedCentralStatus(user.email);
  if (!central) return "active"; // no central config: local-only mode
  if (central.status !== "active") return central.status;
  const graceMs = getSettings().offlineGraceDays * 24 * 3600 * 1000;
  if (Date.now() - central.checkedAt > graceMs) return "grace-expired";
  return "active";
}

function statusMessage(status: string): string {
  switch (status) {
    case "blocked": return "This account has been blocked. Contact the administrator.";
    case "revoked": return "Access for this account has been revoked. Contact the administrator.";
    case "grace-expired": return "Ranzo needs to verify your access. Connect to the internet once and try again.";
    default: return "This account can't be used right now.";
  }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = getUserByEmail(email);
  if (!user) return { ok: false, error: "No account with that email. Check the address or sign up first." };
  const expected = Buffer.from(user.passwordHash, "hex");
  const actual = Buffer.from(hashPassword(password, user.salt), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, error: "That password isn't right. Try again." };
  }
  const status = await effectiveStatus(user);
  if (status !== "active") return { ok: false, error: statusMessage(status) };
  currentUserId = user.id;
  touchLogin(user.id);
  setSettingRow("session-user-id", user.id);
  const { passwordHash: _p, salt: _s, ...pub } = user;
  return { ok: true, user: pub };
}

export async function signup(email: string, password: string, name: string): Promise<AuthResult> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, error: "That doesn't look like a valid email address." };
  if (password.length < 8) return { ok: false, error: "Password needs at least 8 characters." };
  if (!name.trim()) return { ok: false, error: "Please enter your name." };
  if (getUserByEmail(clean)) return { ok: false, error: "An account with that email already exists. Log in instead." };
  const salt = randomBytes(16).toString("hex");
  const user = insertUser({ email: clean, name: name.trim(), passwordHash: hashPassword(password, salt), salt, role: "user" });
  // Register centrally so the admin can manage this account from anywhere.
  void pushCentralStatus(clean, "active");
  currentUserId = user.id;
  touchLogin(user.id);
  setSettingRow("session-user-id", user.id);
  const { passwordHash: _p, salt: _s, ...pub } = user;
  return { ok: true, user: pub };
}

export function logout() {
  currentUserId = null;
  setSettingRow("session-user-id", "");
}

export async function currentUser(): Promise<UserAccount | null> {
  if (!currentUserId) return null;
  const user = getUserById(currentUserId);
  if (!user) return null;
  const status = await effectiveStatus(user);
  if (status !== "active") {
    // Session is no longer valid — enforce immediately.
    logout();
    return null;
  }
  const { passwordHash: _p, salt: _s, ...pub } = user;
  return pub;
}

export function requireAdmin(): boolean {
  if (!currentUserId) return false;
  const user = getUserById(currentUserId);
  return user?.role === "admin";
}

export function adminListUsers(): UserAccount[] {
  return listUsers();
}

export async function adminSetStatus(userId: string, status: "active" | "revoked" | "blocked"): Promise<{ ok: boolean; error?: string }> {
  if (!requireAdmin()) return { ok: false, error: "Only the admin can manage accounts." };
  const target = getUserById(userId);
  if (!target) return { ok: false, error: "User not found." };
  if (target.role === "admin") return { ok: false, error: "The admin account can't be blocked or revoked." };
  setUserStatus(userId, status);
  // Best-effort central sync so the change follows the user to other machines.
  const synced = await pushCentralStatus(target.email, status);
  if (!synced) log("warn", "auth", `Status for ${target.email} set locally; central sync unavailable.`);
  return { ok: true };
}
