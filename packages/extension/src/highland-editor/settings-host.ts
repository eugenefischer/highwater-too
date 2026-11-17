import * as vscode from "vscode";
import { GENERAL_DEFAULTS, generalSettings, type GeneralSettings } from "./general-settings.ts";
import { DOCUMENT_DEFAULTS, documentSettings, type DocumentSettings } from "./document-settings.ts";
import { internationalSettings } from "./international-settings.ts";
import { BACKUP_DEFAULTS, backupSettings, type BackupInfo, type BackupSettings } from "./backup-settings.ts";
import { historyApi } from "../history.ts";
import { historyRoot } from "../history-location.ts";
import { affectsInternational, currentInternational, INTERNATIONAL_KEYS } from "../script-terms.ts";
import { postTo, type BackupAction, type FromPage, type ToPage } from "./messages.ts";
import { activeView } from "../surface.ts";

/**
 * The Settings window's settings, kept as VS Code settings (`highwater.<key>`, for every document)
 * so Settings Sync carries them and they can be set in VS Code's Settings too.
 */
const GENERAL_KEYS = Object.keys(GENERAL_DEFAULTS) as (keyof GeneralSettings)[];
const DOCUMENT_KEYS = Object.keys(DOCUMENT_DEFAULTS) as (keyof DocumentSettings)[];
const BACKUP_KEYS = Object.keys(BACKUP_DEFAULTS) as (keyof BackupSettings)[];
const KEYS: string[] = [...GENERAL_KEYS, ...DOCUMENT_KEYS, ...INTERNATIONAL_KEYS, ...BACKUP_KEYS];
const config = () => vscode.workspace.getConfiguration("highwater");

/** The General settings as they stand. */
export function currentGeneral(): GeneralSettings {
  const c = config();
  return generalSettings((key) => c.get(key));
}

/** The Document settings as they stand. */
export function currentDocument(): DocumentSettings {
  const c = config();
  return documentSettings((key) => c.get(key));
}

/** The Backup settings as they stand. */
export function currentBackup(): BackupSettings {
  const c = config();
  return backupSettings((key) => c.get(key));
}

export function settingsMessage(): ToPage {
  return { type: "settings", general: currentGeneral(), document: currentDocument(), international: currentInternational(), backup: currentBackup() };
}

/** Settings → Backup's folder and mirror. */
export function backupInfoMessage(): ToPage {
  const url = config().get<string>("historyRemote", "").trim();
  const m = historyApi?.mirror();
  const reveal = process.platform === "darwin" ? "Show in Finder" : process.platform === "win32" ? "Show in Explorer" : "Open Folder";
  const info: BackupInfo = { folder: historyRoot(), reveal, mirror: url ? { url, at: m?.at?.getTime() ?? null, error: m?.error ?? null, signIn: m?.signIn ?? false, busy: m?.busy ?? false } : null };
  return { type: "backupInfo", info };
}

const BACKUP_COMMANDS: Record<BackupAction, string> = {
  setFolder: "highwater.changeHistoryLocation",
  revealFolder: "highwater.openHistoryFolder",
  setUpMirror: "highwater.setUpHistoryMirror",
  signIn: "highwater.signInHistoryMirror",
  forgetSignIn: "highwater.forgetHistoryMirrorSignIn",
  syncNow: "highwater.pushHistoryNow",
};

/** Whether a configuration change touches the Settings window's settings. */
export function affectsSettings(e: vscode.ConfigurationChangeEvent): boolean {
  return affectsInternational(e) || KEYS.some((k) => e.affectsConfiguration(`highwater.${k}`));
}

/** A setting changed in the Settings window, or a tab's Restore Defaults. True if it was one of these. */
export function handleSettingsMessage(msg: FromPage): boolean {
  if (msg.type === "settingSet") {
    // Only a value the setting can take (the page can't store anything else).
    if (!KEYS.includes(msg.key)) return true;
    const read = (k: string) => (k === msg.key ? msg.value : undefined);
    const next = (
      GENERAL_KEYS.includes(msg.key as keyof GeneralSettings)
        ? generalSettings(read)
        : DOCUMENT_KEYS.includes(msg.key as keyof DocumentSettings)
          ? documentSettings(read)
          : BACKUP_KEYS.includes(msg.key as keyof BackupSettings)
            ? backupSettings(read)
            : internationalSettings(read)
    ) as unknown as Record<string, unknown>;
    if (JSON.stringify(next[msg.key]) === JSON.stringify(msg.value)) void config().update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    return true;
  }
  if (msg.type === "settingsRestore") {
    // Backup's Restore Defaults leaves the history folder and the mirror alone: they are where your history is, not preferences.
    const keys: string[] = msg.tab === "document" ? DOCUMENT_KEYS : msg.tab === "international" ? INTERNATIONAL_KEYS : msg.tab === "backup" ? BACKUP_KEYS : GENERAL_KEYS;
    void (async () => {
      for (const k of keys) await config().update(k, undefined, vscode.ConfigurationTarget.Global);
    })();
    return true;
  }
  if (msg.type === "backupAction") {
    const command = BACKUP_COMMANDS[msg.action];
    if (command) void vscode.commands.executeCommand(command);
    return true;
  }
  return false;
}

/** Settings…: the Settings window in the Highwater Editor; with none in front, VS Code's Settings for the extension. */
export function registerSettings(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.openSettings", async () => {
      const view = activeView();
      if (view) return postTo(view.panel, { type: "showSettings", tab: "general" });
      await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:eugenefischer.highwater-too");
    }),
    // The Writing History panel's gear: Settings → Backup.
    vscode.commands.registerCommand("highwater.manageWritingHistory", async () => {
      const view = activeView();
      if (view) return postTo(view.panel, { type: "showSettings", tab: "backup" });
      await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:eugenefischer.highwater-too history");
    }),
  );
}
