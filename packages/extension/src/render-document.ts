import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { LANGUAGES } from "./language.ts";
import { exportManuscript, exportScreenplay, loadImages } from "./pdf-export.ts";
import { BundleStore, splitBundlePath } from "./store.ts";

/** Highland templates we can print. Highland stores the chosen one as templateName in info.json. */
export const TEMPLATES = ["Screenplay", "Manuscript"] as const;
export type Template = (typeof TEMPLATES)[number];

export interface Rendered {
  pdf: Uint8Array;
  pages: number;
  problems: string[];
  template: Template;
}

/** The .highland file a document belongs to, if any. */
export function bundleOf(doc: vscode.TextDocument): string | undefined {
  return doc.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath)?.bundle : undefined;
}

/** The document's template: the one chosen in the preview (info.json for .highland files), else by its language. */
export async function templateOf(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument): Promise<Template | null> {
  const bundle = bundleOf(doc);
  let chosen: unknown;
  if (bundle) chosen = (await store.highlandSettings(bundle).catch(() => ({}) as Record<string, unknown>)).templateName;
  else chosen = context.workspaceState.get(`template:${doc.uri.toString()}`);
  if (TEMPLATES.includes(chosen as Template)) return chosen as Template;
  if (doc.languageId === LANGUAGES.fountain) return "Screenplay";
  if (doc.languageId === LANGUAGES.markdown) return "Manuscript";
  return null;
}

/** Saves the template choice: in info.json for .highland files (as Highland does), else in the workspace. */
export async function setTemplate(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument, template: Template): Promise<void> {
  const bundle = bundleOf(doc);
  if (!bundle) {
    await context.workspaceState.update(`template:${doc.uri.toString()}`, template);
    return;
  }
  await store.update(bundle, (b) => {
    const settings = b.highlandSettings;
    if (settings.templateName === template) return [];
    b.setHighlandSettings({ ...settings, templateName: template });
    return ["info.json"];
  });
}

/** Lays out and renders the editor's text (unsaved edits included) with the document's template. */
export async function renderDocument(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument, template?: Template): Promise<Rendered | null> {
  const chosen = template ?? (await templateOf(context, store, doc));
  if (!chosen) return null;
  const bundle = bundleOf(doc);
  const path = bundle ?? doc.uri.fsPath;
  let titlePage = true;
  if (bundle) {
    const settings = (await store.highlandSettings(bundle)) as { printOptions?: { printTitlePage?: boolean } };
    titlePage = settings.printOptions?.printTitlePage !== false;
  }
  const base = { text: doc.getText(), path, fontDir: join(context.extensionPath, "dist", "fonts"), titlePage };
  if (chosen === "Screenplay") return { ...(await exportScreenplay(base)), template: chosen };
  // Images: the bundle's assets, or files next to a Markdown file.
  const read = async (src: string): Promise<Uint8Array | null> => {
    const name = safeDecode(src);
    if (bundle) return store.read(bundle, name).catch(() => null);
    return readFile(resolve(dirname(path), name)).catch(() => null);
  };
  return { ...(await exportManuscript({ ...base, image: await loadImages(base.text, read) })), template: chosen };
}

function safeDecode(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}
