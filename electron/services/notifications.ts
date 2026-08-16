// NotificationBroker — every alert (copilot, errors, updates) funnels into one
// queue with one visual style. The OS is never spammed with separate popups:
// at most one native Windows notification per event, and none at all during a
// focus session or when the user disabled that kind.

import { Notification } from "electron";
import {
  addNotificationRow, listNotificationRows, markNotificationsRead,
  clearNotificationRows, unreadNotificationCount,
} from "./db";
import { getSettings } from "./settings";
import { log } from "./logger";

export type NotifyKind = "info" | "briefing" | "health" | "wrap-up" | "digest" | "error";

let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;

export function bindBroadcast(fn: (channel: string, payload: unknown) => void) {
  broadcastFn = fn;
}

export function inFocusSession(): boolean {
  const until = getSettings().focusSessionUntil;
  return until != null && until > Date.now();
}

export function notify(title: string, body: string, kind: NotifyKind = "info", opts?: { native?: boolean }) {
  const id = addNotificationRow(title, body, kind);
  log("info", "notify", `[${kind}] ${title}`);
  // In-app queue update, always.
  broadcastFn?.("notification", { id, title, body, kind, at: Date.now() });
  // Native toast only when appropriate: not in focus session, and only for
  // things worth interrupting for.
  const wantNative = opts?.native ?? (kind === "briefing" || kind === "health");
  if (wantNative && !inFocusSession() && Notification.isSupported()) {
    try {
      new Notification({ title: `Ranzo — ${title}`, body: body.slice(0, 200), silent: getSettings().whisperMode }).show();
    } catch { /* never let a toast crash anything */ }
  }
  return id;
}

export const notificationApi = {
  list: listNotificationRows,
  markRead: markNotificationsRead,
  clear: clearNotificationRows,
  unreadCount: unreadNotificationCount,
};
