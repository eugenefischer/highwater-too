import * as vscode from "vscode";
import { TEMPLATE_INFO, templateSlug } from "./template-info.ts";

export { TEMPLATE_INFO, templateSlug, type TemplateInfo, type TemplateOption } from "./template-info.ts";

/**
 * The Template Options are app-wide in Highland (a new document picks up the last choice), so
 * here they are settings: highwater.templates.<template>.<option>.
 */
export const SETTINGS_PREFIX = "highwater.templates";

/** The option values in effect for a template (settings, else Highland's defaults). */
export function templateOptions(name: string): Record<string, string | boolean> {
  const info = TEMPLATE_INFO.find((t) => t.name === name);
  const config = vscode.workspace.getConfiguration(`${SETTINGS_PREFIX}.${templateSlug(name)}`);
  const out: Record<string, string | boolean> = {};
  for (const o of info?.options ?? []) {
    const v = config.get<string | boolean>(o.key);
    out[o.key] = typeof v === typeof o.default && (o.kind !== "font" || o.choices!.includes(v as string)) ? v! : o.default;
  }
  return out;
}

/** Changes an option (in the user's settings, as Highland keeps them app-wide). */
export async function setTemplateOption(name: string, key: string, value: string | boolean): Promise<void> {
  const info = TEMPLATE_INFO.find((t) => t.name === name);
  const o = info?.options.find((x) => x.key === key);
  if (!o || typeof value !== typeof o.default || (o.kind === "font" && !o.choices!.includes(value as string))) return;
  await vscode.workspace.getConfiguration(`${SETTINGS_PREFIX}.${templateSlug(name)}`).update(key, value === o.default ? undefined : value, vscode.ConfigurationTarget.Global);
}
