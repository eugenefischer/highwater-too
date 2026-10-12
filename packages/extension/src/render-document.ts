import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { LANGUAGES } from "./language.ts";
import { exportManuscript, exportManuscriptDocx, exportScreenplay, loadImages, type ExportResult } from "./pdf-export.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { plainExtras } from "./extras.ts";

/** Highland templates we can print. Highland stores the chosen one as templateName in info.json. */
export const TEMPLATES = ["Screenplay", "Manuscript"] as const;
export type Template = (typeof TEMPLATES)[number];

export interface Rendered extends ExportResult {
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
  else {
    // A plain file's choice is kept with its Bin and Scratchpad (earlier, in the workspace).
    if (doc.uri.scheme === "file") chosen = (await (await plainExtras().folder(doc.uri.fsPath).catch(() => null))?.settings())?.templateName;
    chosen ??= context.workspaceState.get(`template:${doc.uri.toString()}`);
  }
  if (TEMPLATES.includes(chosen as Template)) return chosen as Template;
  if (doc.languageId === LANGUAGES.fountain) return "Screenplay";
  if (doc.languageId === LANGUAGES.markdown) return "Manuscript";
  return null;
}

const templateChanged = new vscode.EventEmitter<vscode.TextDocument>();
/** Fires when a document's template is changed (from the preview or the status bar). */
export const onDidChangeTemplate = templateChanged.event;

/**
 * Saves the template choice: in info.json for .highland files (as Highland does), with a plain
 * file's Bin and Scratchpad for plain files, else in the workspace.
 */
export async function setTemplate(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument, template: Template): Promise<void> {
  const bundle = bundleOf(doc);
  const folder = !bundle && doc.uri.scheme === "file" ? await plainExtras().folder(doc.uri.fsPath, true).catch(() => null) : null;
  if (folder) {
    await folder.updateSettings({ templateName: template });
    await context.workspaceState.update(`template:${doc.uri.toString()}`, undefined);
  } else if (!bundle) await context.workspaceState.update(`template:${doc.uri.toString()}`, template);
  else
    await store.update(bundle, (b) => {
      const settings = b.highlandSettings;
      if (settings.templateName === template) return [];
      b.setHighlandSettings({ ...settings, templateName: template });
      return ["info.json"];
    });
  templateChanged.fire(doc);
}

/**
 * The active print template in the status bar (what Export PDF and the preview will use); click to
 * change it.
 */
export function registerTemplateStatus(context: vscode.ExtensionContext, store: BundleStore): void {
  const item = vscode.window.createStatusBarItem("highwater.template", vscode.StatusBarAlignment.Right, 99);
  item.name = "Highwater Too: print template";
  item.command = "highwater.chooseTemplate";
  const update = async (): Promise<void> => {
    const doc = vscode.window.activeTextEditor?.document;
    const template = doc && doc.languageId.startsWith("highland-") ? await templateOf(context, store, doc) : null;
    if (!doc || doc !== vscode.window.activeTextEditor?.document) return;
    if (!template) {
      item.hide();
      return;
    }
    item.text = `$(file-pdf) ${template}`;
    item.tooltip = `Print template: ${template}. Export PDF and the preview use it. Click to change.`;
    item.show();
  };
  context.subscriptions.push(
    item,
    vscode.window.onDidChangeActiveTextEditor(() => void update()),
    vscode.workspace.onDidOpenTextDocument(() => void update()),
    onDidChangeTemplate(() => void update()),
    vscode.commands.registerCommand("highwater.chooseTemplate", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || !doc.languageId.startsWith("highland-")) return;
      const current = await templateOf(context, store, doc);
      const picked = await vscode.window.showQuickPick(
        TEMPLATES.map((t) => ({ label: t, description: t === current ? "current" : "", picked: t === current })),
        { title: "Print template for Export PDF and the preview" },
      );
      if (picked && picked.label !== current) await setTemplate(context, store, doc, picked.label as Template);
    }),
  );
  void update();
}

/** Lays out and renders the editor's text (unsaved edits included) with the document's template. */
/** The manuscript as a Word document, laid out like its Manuscript-template PDF. */
export async function renderDocx(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument): Promise<{ docx: Uint8Array; problems: string[] }> {
  const { base, read } = await sources(context, store, doc);
  const font = vscode.workspace.getConfiguration("highwater").get<string>("docxFont") === "Courier Prime" ? "Courier Prime" : "Courier New";
  return exportManuscriptDocx({ ...base, image: await loadImages(base.text, read), font });
}

/** The text, its path, the title-page setting and an image reader, shared by the exports. */
async function sources(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument) {
  const bundle = bundleOf(doc);
  const path = bundle ?? doc.uri.fsPath;
  let titlePage = true;
  if (bundle) {
    const settings = (await store.highlandSettings(bundle)) as { printOptions?: { printTitlePage?: boolean } };
    titlePage = settings.printOptions?.printTitlePage !== false;
  }
  const base = { text: doc.getText(), path, fontDir: join(context.extensionPath, "dist", "fonts"), titlePage };
  // Images: the bundle's assets, or files next to a Markdown file.
  const read = async (src: string): Promise<Uint8Array | null> => {
    const name = safeDecode(src);
    if (bundle) return store.read(bundle, name).catch(() => null);
    return readFile(resolve(dirname(path), name)).catch(() => null);
  };
  return { base, read };
}

export async function renderDocument(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument, template?: Template): Promise<Rendered | null> {
  const chosen = template ?? (await templateOf(context, store, doc));
  if (!chosen) return null;
  const { base, read } = await sources(context, store, doc);
  if (chosen === "Screenplay") return { ...(await exportScreenplay(base)), template: chosen };
  return { ...(await exportManuscript({ ...base, image: await loadImages(base.text, read) })), template: chosen };
}

function safeDecode(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}
