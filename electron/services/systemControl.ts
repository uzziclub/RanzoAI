// SystemController + ActionManager + PermissionService.
// Every action is classified read-only / reversible / destructive.
// Read-only: runs automatically. Reversible: runs and is logged.
// Destructive: always confirmed first in plain language, undo where possible.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionTier, PendingAction } from "../../shared/types";
import { logAction, updateActionStatus, listActions, getSettings as _gs } from "./allServices";
import { log } from "./logger";

const execAsync = promisify(exec);
const IS_WIN = process.platform === "win32";

export interface ActionSpec {
  description: string;
  tier: ActionTier;
  humanPrompt: string;
  run: () => Promise<string>;
  undo?: () => Promise<string>;
}

const pendingActions = new Map<string, ActionSpec & { id: string }>();
const undoStack: { id: string; description: string; undo: () => Promise<string> }[] = [];

async function ps(script: string): Promise<string> {
  if (!IS_WIN) {
    throw new Error("This system action needs Windows. On this machine I can only simulate it.");
  }
  // -EncodedCommand avoids every cmd.exe / PowerShell quoting pitfall:
  // the script travels as base64 UTF-16LE, untouched by the shell.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: 30_000, windowsHide: true },
  );
  return stdout.trim();
}

function inSafeZone(path: string): boolean {
  const zones = _gs().safeZones;
  const lower = path.toLowerCase();
  return zones.some((z) => lower.startsWith(z.toLowerCase()));
}

// ---------- Built-in action catalog ----------

export function buildAction(kind: string, args: Record<string, string>): ActionSpec | null {
  switch (kind) {
    case "open-app": {
      const app = args.app ?? "";
      return {
        description: `Open ${app}`,
        tier: "reversible",
        humanPrompt: "",
        run: async () => {
          await ps(`Start-Process "${app}"`);
          return `Opened ${app}.`;
        },
      };
    }
    case "set-volume": {
      const level = Math.max(0, Math.min(100, Number(args.level ?? 50)));
      return {
        description: `Set volume to ${level}%`,
        tier: "reversible",
        humanPrompt: "",
        run: async () => {
          // Uses WScript SendKeys-free approach via Windows CoreAudio through PowerShell + WScript.Shell fallback
          const script = `
$vol = ${level};
Add-Type -TypeDefinition '
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext); int j(); int GetMasterVolumeLevelScalar(out float pfLevel); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Audio {
  public static void SetVolume(float level) {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev; enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
    var aevGuid = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume aev;
    dev.Activate(ref aevGuid, 1, 0, out aev);
    aev.SetMasterVolumeLevelScalar(level, System.Guid.Empty);
  }
}';
[Audio]::SetVolume($vol / 100)`;
          await ps(script);
          return `Volume set to ${level}%.`;
        },
      };
    }
    case "lock-screen":
      return {
        description: "Lock the screen",
        tier: "reversible",
        humanPrompt: "",
        run: async () => { await ps("rundll32.exe user32.dll,LockWorkStation"); return "Screen locked."; },
      };
    case "empty-recycle-bin":
      return {
        description: "Empty the Recycle Bin",
        tier: "destructive",
        humanPrompt: "Empty the Recycle Bin? Everything in it will be gone for good.",
        run: async () => { await ps("Clear-RecycleBin -Force -ErrorAction SilentlyContinue"); return "Recycle Bin emptied."; },
      };
    case "shutdown":
      return {
        description: "Shut down the computer",
        tier: "destructive",
        humanPrompt: "Shut down the computer now?",
        run: async () => { await ps("Stop-Computer -Force"); return "Shutting down."; },
      };
    case "restart":
      return {
        description: "Restart the computer",
        tier: "destructive",
        humanPrompt: "Restart the computer now?",
        run: async () => { await ps("Restart-Computer -Force"); return "Restarting."; },
      };
    case "sleep":
      return {
        description: "Put the computer to sleep",
        tier: "reversible",
        humanPrompt: "",
        run: async () => { await ps("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"); return "Going to sleep."; },
      };
    case "delete-file": {
      const path = args.path ?? "";
      const tier: ActionTier = "destructive";
      return {
        description: `Delete ${path}`,
        tier,
        humanPrompt: `Delete "${path}"? It will go to the Recycle Bin so you can still get it back.`,
        run: async () => {
          // Send to recycle bin (undoable) instead of a hard delete.
          await ps(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${path.replace(/'/g, "''")}', 'OnlyErrorDialogs', 'SendToRecycleBin')`);
          return `Moved "${path}" to the Recycle Bin.`;
        },
      };
    }
    case "move-file": {
      const from = args.from ?? "", to = args.to ?? "";
      const tier: ActionTier = inSafeZone(from) || inSafeZone(to) ? "destructive" : "reversible";
      return {
        description: `Move ${from} to ${to}`,
        tier,
        humanPrompt: `Move "${from}" to "${to}"?`,
        run: async () => { await ps(`Move-Item -Path '${from.replace(/'/g, "''")}' -Destination '${to.replace(/'/g, "''")}'`); return `Moved to ${to}.`; },
        undo: async () => { await ps(`Move-Item -Path '${to.replace(/'/g, "''")}' -Destination '${from.replace(/'/g, "''")}'`); return `Moved back to ${from}.`; },
      };
    }
    case "run-command": {
      const cmd = args.command ?? "";
      return {
        description: `Run command: ${cmd}`,
        tier: "destructive",
        humanPrompt: `Run this command? "${cmd}"`,
        run: async () => {
          const out = await ps(cmd);
          return out || "Command finished with no output.";
        },
      };
    }
    case "take-screenshot":
      return {
        description: "Take a screenshot",
        tier: "read-only",
        humanPrompt: "",
        run: async () => {
          const out = join(tmpdir(), `ranzo-shot-${Date.now()}.png`);
          await ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $bmp.Save('${out.replace(/\\/g, "\\\\")}')`);
          return `Screenshot saved to ${out}.`;
        },
      };
    case "get-clipboard":
      return {
        description: "Read the clipboard",
        tier: "read-only",
        humanPrompt: "",
        run: async () => (await ps("Get-Clipboard")) || "The clipboard is empty.",
      };
    case "list-files": {
      const dir = args.path ?? homedir();
      return {
        description: `List files in ${dir}`,
        tier: "read-only",
        humanPrompt: "",
        run: async () => await ps(`Get-ChildItem -Path '${dir.replace(/'/g, "''")}' | Select-Object -First 40 Name, Length | Format-Table -AutoSize | Out-String`),
      };
    }
    default:
      return null;
  }
}

// ---------- Execution with tiering ----------

export interface ActionOutcome {
  ran: boolean;
  message: string;
  pending?: PendingAction;
}

export async function requestAction(spec: ActionSpec): Promise<ActionOutcome> {
  if (spec.tier === "destructive") {
    const id = randomUUID();
    pendingActions.set(id, { ...spec, id });
    logAction({ description: spec.description, tier: spec.tier, status: "pending-confirmation", undoable: Boolean(spec.undo) });
    return {
      ran: false,
      message: spec.humanPrompt || `Do you want me to ${spec.description.toLowerCase()}?`,
      pending: { id, description: spec.description, tier: spec.tier, command: "", humanPrompt: spec.humanPrompt },
    };
  }
  return executeSpec(spec);
}

async function executeSpec(spec: ActionSpec): Promise<ActionOutcome> {
  const actionId = logAction({ description: spec.description, tier: spec.tier, status: "done", undoable: Boolean(spec.undo) });
  try {
    const message = await spec.run();
    if (spec.undo) {
      undoStack.push({ id: actionId, description: spec.description, undo: spec.undo });
      if (undoStack.length > 20) undoStack.shift();
    }
    log("info", "actions", `${spec.tier}: ${spec.description}`);
    return { ran: true, message };
  } catch (err) {
    updateActionStatus(actionId, "failed");
    log("error", "actions", `${spec.description} failed: ${String(err)}`);
    throw err;
  }
}

export async function confirmPending(actionId: string, approved: boolean): Promise<ActionOutcome> {
  const spec = pendingActions.get(actionId);
  pendingActions.delete(actionId);
  if (!spec) return { ran: false, message: "That action isn't waiting anymore." };
  if (!approved) {
    updateActionStatus(actionId, "cancelled");
    return { ran: false, message: "Okay, cancelled. Nothing was changed." };
  }
  return executeSpec(spec);
}

export async function undoLast(): Promise<{ ok: boolean; message: string }> {
  const last = undoStack.pop();
  if (!last) return { ok: false, message: "There's nothing recent I can undo." };
  try {
    const msg = await last.undo();
    updateActionStatus(last.id, "undone");
    return { ok: true, message: `Undone: ${last.description}. ${msg}` };
  } catch (err) {
    return { ok: false, message: `I couldn't undo that: ${String(err instanceof Error ? err.message : err)}` };
  }
}

export function actionHistory() {
  return listActions().map(({ undoCommand: _u, ...rest }) => rest);
}
