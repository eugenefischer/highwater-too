import { setScriptTerms } from "@highwater/parser";
import * as vscode from "vscode";
import { internationalSettings, scriptTermsOf, type InternationalSettings } from "./highland-editor/international-settings.ts";

/** The International settings' keys (`highwater.<key>`). */
export const INTERNATIONAL_KEYS: (keyof InternationalSettings)[] = ["useCustomTerms", "customLocations", "customTimes", "customTransitions", "customMore", "customContd"];

/** The International settings as they stand. */
export function currentInternational(): InternationalSettings {
  const c = vscode.workspace.getConfiguration("highwater");
  return internationalSettings((key) => c.get(key));
}

export function affectsInternational(e: vscode.ConfigurationChangeEvent): boolean {
  return INTERNATIONAL_KEYS.some((k) => e.affectsConfiguration(`highwater.${k}`));
}

/** Gives the parser the custom terms (or Fountain's), so every parse here recognizes the same headings and transitions. */
export function applyScriptTerms(): void {
  setScriptTerms(scriptTermsOf(currentInternational()));
}
