import * as vscode from "vscode";
import { GENERAL_DEFAULTS, generalSettings, type GeneralSettings } from "./general-settings.ts";
import { DOCUMENT_DEFAULTS, documentSettings, type DocumentSettings } from "./document-settings.ts";
import { postTo, type FromPage, type ToPage } from "./messages.ts";
import { activeView } from "../surface.ts";

/**
 * The Settings window's settings, kept as VS Code settings (`highwater.<key>`, for every document)
 * so Settings Sync carries them and they can be set in VS Code's Settings too.
 */
const GENERAL_KEYS = Object.keys(GENERAL_DEFAULTS) as (keyof GeneralSettings)[];
const DOCUMENT_KEYS = Object.keys(DOCUMENT_DEFAULTS) as (keyof DocumentSettings)[];
const KEYS: string[] = [...GENERAL_KEYS, ...DOCUMENT_KEYS];
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

export function settingsMessage(): ToPage {
  return { type: "settings", general: currentGeneral(), document: currentDocument() };
}

/** Whether a configuration change touches the Settings window's settings. */
export function affectsSettings(e: vscode.ConfigurationChangeEvent): boolean {
  return KEYS.some((k) => e.affectsConfiguration(`highwater.${k}`));
}

/** A setting changed in the Settings window, or a tab's Restore Defaults. True if it was one of these. */
export function handleSettingsMessage(msg: FromPage): boolean {
  if (msg.type === "settingSet") {
    // Only a value the setting can take (the page can't store anything else).
    const general = GENERAL_KEYS.includes(msg.key as keyof GeneralSettings);
    if (!KEYS.includes(msg.key)) return true;
    const next = (general ? generalSettings((k) => (k === msg.key ? msg.value : undefined)) : documentSettings((k) => (k === msg.key ? msg.value : undefined))) as unknown as Record<string, unknown>;
    if (next[msg.key] === msg.value) void config().update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
    return true;
  }
  if (msg.type === "settingsRestore") {
    const keys: string[] = msg.tab === "document" ? DOCUMENT_KEYS : GENERAL_KEYS;
    void (async () => {
      for (const k of keys) await config().update(k, undefined, vscode.ConfigurationTarget.Global);
    })();
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
  );
}
