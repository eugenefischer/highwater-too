import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as vscode from "vscode";
import { pick } from "./ask.ts";
import { SCHEME } from "./fs-provider.ts";
import { LANGUAGES } from "./language.ts";
import { exportManuscript, exportManuscriptDocx, exportPlainText, exportProse, exportScreenplay, loadImages, type ExportResult } from "./pdf-export.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { plainExtras } from "./extras.ts";
import { activeDocument, onDidChangeActiveSurface } from "./surface.ts";

/** Highland templates we can print. Highland stores the chosen one as templateName in info.json. */
export const TEMPLATES = ["Screenplay", "Multi-Cam", "Stage Play", "Graphic Novel", "Manuscript", "Novel", "Treatment", "Modern Standard", "Article", "Bulletin", "Speech", "MLA Report", "Wiki", "Plain Text"] as const;
/** Templates laid out as prose (Markdown). */
const PROSE = new Set<string>(["Novel", "Treatment", "Modern Standard", "Article", "Bulletin", "Speech", "MLA Report", "Wiki"]);
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
  if (doc.languageId === LANGUAGES.plain) return "Plain Text";
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
 * Highland 2's print options (its preview's bottom bar), kept where Highland keeps them: info.json's
 * `printOptions` for .highland files, with a plain file's Bin and Scratchpad for plain files.
 */
export const PRINT_OPTIONS = ["printRevisionColor", "printRevisionStars", "printParagraphNumbers", "printSynopses", "printInlineNotes", "printTitlePage"] as const;
export type PrintOption = (typeof PRINT_OPTIONS)[number];
export type PrintOptions = Record<PrintOption, boolean>;
/** Highland's defaults: only the title page is printed. */
const DEFAULT_PRINT: PrintOptions = { printRevisionColor: false, printRevisionStars: false, printParagraphNumbers: false, printSynopses: false, printInlineNotes: false, printTitlePage: true };

function readPrint(raw: unknown): PrintOptions {
  const out = { ...DEFAULT_PRINT };
  if (raw && typeof raw === "object") for (const k of PRINT_OPTIONS) if (typeof (raw as Record<string, unknown>)[k] === "boolean") out[k] = (raw as Record<string, boolean>)[k]!;
  return out;
}

export async function printOptionsOf(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument): Promise<PrintOptions> {
  const bundle = bundleOf(doc);
  if (bundle) return readPrint((await store.highlandSettings(bundle).catch(() => ({}) as Record<string, unknown>)).printOptions);
  let raw: unknown;
  if (doc.uri.scheme === "file") raw = (await (await plainExtras().folder(doc.uri.fsPath).catch(() => null))?.settings())?.printOptions;
  raw ??= context.workspaceState.get(`printOptions:${doc.uri.toString()}`);
  return readPrint(raw);
}

export async function setPrintOption(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument, key: PrintOption, value: boolean): Promise<void> {
  const next = { ...(await printOptionsOf(context, store, doc)), [key]: value };
  const bundle = bundleOf(doc);
  const folder = !bundle && doc.uri.scheme === "file" ? await plainExtras().folder(doc.uri.fsPath, true).catch(() => null) : null;
  if (folder) await folder.updateSettings({ printOptions: next });
  else if (!bundle) await context.workspaceState.update(`printOptions:${doc.uri.toString()}`, next);
  else
    await store.update(bundle, (b) => {
      const settings = b.highlandSettings;
      // Keep any option Highland stores that Highwater doesn't show (printRevisionsOnly).
      b.setHighlandSettings({ ...settings, printOptions: { ...((settings.printOptions as object | undefined) ?? {}), ...next } });
      return ["info.json"];
    });
  templateChanged.fire(doc); // the preview lays the document out again
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
    const doc = activeDocument();
    const template = doc && doc.languageId.startsWith("highland-") ? await templateOf(context, store, doc) : null;
    if (!doc || doc !== activeDocument()) return;
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
    onDidChangeActiveSurface(() => void update()),
    vscode.workspace.onDidOpenTextDocument(() => void update()),
    onDidChangeTemplate(() => void update()),
    vscode.commands.registerCommand("highwater.chooseTemplate", async () => {
      const doc = activeDocument();
      if (!doc || !doc.languageId.startsWith("highland-")) return;
      const current = await templateOf(context, store, doc);
      const picked = await pick(
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
  const o = await printOptionsOf(context, store, doc);
  const print = { notes: o.printInlineNotes, synopses: o.printSynopses, revisionColor: o.printRevisionColor, revisionStars: o.printRevisionStars, paragraphNumbers: o.printParagraphNumbers };
  const base = { text: doc.getText(), path, fontDir: join(context.extensionPath, "dist", "fonts"), titlePage: o.printTitlePage, print };
  // Images: the bundle's assets, or files next to a Markdown file.
  const read = async (src: string): Promise<Uint8Array | null> => {
    const name = safeDecode(src);
    if (bundle) return store.read(bundle, name).catch(() => null);
    return readFile(resolve(dirname(path), name)).catch(() => null);
  };
  return { base, read };
}

/** With `render` false, lays out only: for the exact page count, without drawing the PDF. */
export async function renderDocument(context: vscode.ExtensionContext, store: BundleStore, doc: vscode.TextDocument, template?: Template, render = true): Promise<Rendered | null> {
  const chosen = template ?? (await templateOf(context, store, doc));
  if (!chosen) return null;
  const sourced = await sources(context, store, doc);
  const read = sourced.read;
  const base = { ...sourced.base, render };
  if (chosen === "Plain Text") return { ...(await exportPlainText(base)), template: chosen };
  if (PROSE.has(chosen)) return { ...(await exportProse({ ...base, template: chosen, image: await loadImages(base.text, read) })), template: chosen };
  if (chosen !== "Manuscript") return { ...(await exportScreenplay({ ...base, template: chosen })), template: chosen };
  return { ...(await exportManuscript({ ...base, image: await loadImages(base.text, read) })), template: chosen };
}

function safeDecode(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}
