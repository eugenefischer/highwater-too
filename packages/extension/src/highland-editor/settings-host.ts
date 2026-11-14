import * as vscode from "vscode";
import { GENERAL_DEFAULTS, generalSettings, type GeneralSettings } from "./general-settings.ts";
import { postTo, type FromPage, type ToPage } from "./messages.ts";
import { activeView } from "../surface.ts";

/**
 * The Settings window's settings, kept as VS Code settings (`highwater.<key>`, for every document)
 * so Settings Sync carries them and they can be set in VS Code's Settings too.
 */
const KEYS = Object.keys(GENERAL_DEFAULTS) as (keyof GeneralSettings)[];
const config = () => vscode.workspace.getConfiguration("highwater");

/** The General settings as they stand. */
export function currentGeneral(): GeneralSettings {
  const c = config();
  return generalSettings((key) => c.get(key));
}

export function generalMessage(): ToPage {
  return { type: "settings", general: currentGeneral() };
}

/** Whether a configuration change touches the General settings. */
export function affectsGeneral(e: vscode.ConfigurationChangeEvent): boolean {
  return KEYS.some((k) => e.affectsConfiguration(`highwater.${k}`));
}

/** A setting changed in the Settings window, or a tab's Restore Defaults. True if it was one of these. */
export function handleSettingsMessage(msg: FromPage): boolean {
  if (msg.type === "settingSet") {
    const key = msg.key as keyof GeneralSettings;
    if (!KEYS.includes(key)) return true;
    // Only a value the setting can take (the page can't store anything else).
    const next = generalSettings((k) => (k === key ? msg.value : undefined));
    if (next[key] === msg.value) void config().update(key, msg.value, vscode.ConfigurationTarget.Global);
    return true;
  }
  if (msg.type === "settingsRestore") {
    void (async () => {
      for (const k of KEYS) await config().update(k, undefined, vscode.ConfigurationTarget.Global);
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
