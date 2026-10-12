import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { writeBundle } from "@highwater/bundle";
import * as vscode from "vscode";
import { EXTRAS_SCHEME, plainExtras } from "./extras.ts";
import { assetsFolderName } from "./extras-folder.ts";
import { SCHEME } from "./fs-provider.ts";
import { currentHistory } from "./history.ts";
import { LANGUAGES } from "./language.ts";
import { openHighland } from "./open.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { stripRevisionTags } from "./syntax/edits.ts";
import { toBundle, toPlain } from "./to-bundle.ts";

/**
 * Converting a work between a .highland file and a plain .fountain, .md or .txt file. A conversion
 * moves the work: its writing history, Bin, Scratchpad, images and settings go with it, and the
 * file it came from is no longer tracked (the writer is offered to move it to the Trash).
 *
 * Exporting is different: an export is always a new file, outside the writing history.
 */
/** In the end-to-end tests: targets are passed in, and nobody is asked about the Trash. */
let testing = false;

type Options = { target?: vscode.Uri };

export function registerConversions(context: vscode.ExtensionContext, store: BundleStore): void {
  testing = context.extensionMode === vscode.ExtensionMode.Test;
  // Menus pass a URI; only the tests pass a target.
  const toPlainFile = (_uri?: unknown, options?: Options) => convertToPlain(store, options?.target);
  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.convertToHighland", (uri?: unknown, options?: Options) => convertToHighland(uri instanceof vscode.Uri ? uri : undefined, options?.target)),
    vscode.commands.registerCommand("highwater.convertToFountain", toPlainFile),
    vscode.commands.registerCommand("highwater.convertToMarkdown", toPlainFile),
    vscode.commands.registerCommand("highwater.convertToText", toPlainFile),
    vscode.commands.registerCommand("highwater.export", () => exportText()),
  );
}

const PLAIN_EXT: Record<string, string> = { [LANGUAGES.fountain]: "fountain", [LANGUAGES.markdown]: "md", [LANGUAGES.plain]: "txt" };

/** A plain file (the given one, else the active editor's) becomes a .highland file. */
async function convertToHighland(uri?: vscode.Uri, chosen?: vscode.Uri): Promise<void> {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!source || source.scheme !== "file") {
    void vscode.window.showInformationMessage("Open or select a .fountain or .md file to convert it to a .highland file.");
    return;
  }
  const path = source.fsPath;
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === source.toString());
  if (open?.isDirty && !(await open.save())) return;
  const target =
    chosen ??
    (await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(join(dirname(path), `${basename(path, extname(path))}.highland`)),
      filters: { ".highland files": ["highland"] },
      title: "Convert to .highland File",
    }));
  if (!target || target.fsPath === path) return;
  if (!(await freeForWork(target.fsPath))) return;
  await vscode.commands.executeCommand("highwater.history.settle", path);

  const extras = plainExtras();
  const history = currentHistory();
  const ext = extname(path).toLowerCase();
  const scriptName = ext === ".fountain" || ext === ".spmd" ? "text.fountain" : ext === ".md" || ext === ".markdown" ? "text.md" : "text.txt";
  const text = await readFile(path, "utf8");
  const id = (history && (await extras.documentId(path))) || randomUUID();
  const folder = await extras.folder(path);
  const images = (await extras.assets(path)).length ? (await extras.assetsFolder(path)).dir : null;
  await writeBundle(target.fsPath, toBundle({ scriptName, script: text, ...(await extras.historyFiles(path)) }, id));

  // The work moves to the .highland file: its history, and everything that was kept outside the file.
  if (history) {
    await history.attach(id, target.fsPath);
    await history.retire(path);
  }
  await closeTabs((u) => u.toString() === source.toString() || (!!folder && u.scheme === EXTRAS_SCHEME && u.fsPath.startsWith(folder.dir)));
  await folder?.remove();
  extras.forget();
  extras.changed(path);
  await vscode.commands.executeCommand("highwater.history.converted", target.fsPath, `to ${basename(target.fsPath)}`);
  await openHighland(target);
  await offerTrash(source, images, history !== null);
}

/** The active .highland document becomes a plain .fountain, .md or .txt file. */
async function convertToPlain(store: BundleStore, chosen?: vscode.Uri): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  const parts = doc?.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
  if (!doc || !parts || parts.entry !== "") {
    void vscode.window.showInformationMessage("Open a .highland document to convert it to a plain file.");
    return;
  }
  const bundle = parts.bundle;
  const ext = PLAIN_EXT[doc.languageId] ?? "txt";
  if (doc.isDirty && !(await doc.save())) return;
  const target =
    chosen ??
    (await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(join(dirname(bundle), `${basename(bundle, extname(bundle))}.${ext}`)),
      filters: { [ext === "fountain" ? "Fountain" : ext === "md" ? "Markdown" : "Plain text"]: [ext] },
      title: `Convert to .${ext} File`,
    }));
  if (!target) return;
  const path = target.fsPath;
  if (!(await freeForWork(path))) return;
  await vscode.commands.executeCommand("highwater.history.settle", bundle);

  const extras = plainExtras();
  const history = currentHistory();
  const b = await store.snapshot(bundle);
  const info = b.info.highwaterToo as { documentId?: unknown } | undefined;
  const stored = typeof info?.documentId === "string" ? info.documentId : null;
  const id = history ? (await history.resolve({ id: stored, path: bundle, text: b.text })).id : null;
  const folderName = await freeFolderName(dirname(path), assetsFolderName(path));
  const plain = toPlain(b, folderName);

  if (plain.assets.length) {
    const dir = join(dirname(path), folderName);
    await mkdir(dir, { recursive: true });
    for (const a of plain.assets) await writeFile(join(dir, a.name), a.data);
  }
  await writeFile(path, plain.text);
  const e = plain.extras;
  if (e.bin.length || e.scratchpad !== undefined || e.document || plain.assets.length) {
    const folder = extras.prepare(path, id);
    await folder.replace(e);
    if (plain.assets.length) await folder.updateSettings({ assetsFolder: folderName });
  }

  // The work moves to the plain file; the .highland file left behind no longer names it.
  if (history && id) {
    await history.attach(id, path);
    await history.retire(bundle);
  }
  await store.update(bundle, (old) => {
    const ours = { ...((old.info.highwaterToo as object | undefined) ?? {}) } as Record<string, unknown>;
    if (!("documentId" in ours)) return [];
    delete ours.documentId;
    old.setInfo({ ...old.info, highwaterToo: ours });
    return ["info.json"];
  });
  extras.forget();
  await vscode.commands.executeCommand("highwater.history.converted", path, `to ${basename(path)}`);
  await closeTabs((u) => u.scheme === SCHEME && (splitBundlePath(u.fsPath)?.bundle ?? "") === bundle);
  let opened = await vscode.workspace.openTextDocument(path);
  if (ext === "md" && opened.languageId !== LANGUAGES.markdown) opened = await vscode.languages.setTextDocumentLanguage(opened, LANGUAGES.markdown);
  if (ext === "txt" && opened.languageId !== LANGUAGES.plain) opened = await vscode.languages.setTextDocumentLanguage(opened, LANGUAGES.plain);
  await vscode.window.showTextDocument(opened, { preview: false });
  await offerTrash(vscode.Uri.file(bundle), null, history !== null);
}

/**
 * Export Text: the script as .fountain, .md or .txt without revision marks. An export is a new
 * file outside the writing history: if it is edited and saved, it starts a history of its own.
 */
async function exportText(): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  const parts = doc?.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
  const plain = doc && plainExtras().isPlain(doc) ? doc.uri.fsPath : null;
  if (!doc || (!plain && (!parts || parts.entry !== ""))) {
    void vscode.window.showInformationMessage("Open a document to export it.");
    return;
  }
  const from = plain ?? parts!.bundle;
  const ext = PLAIN_EXT[doc.languageId] ?? "txt";
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(join(dirname(from), `${basename(from, extname(from))}${plain ? " (export)" : ""}.${ext}`)),
    filters: { [ext === "fountain" ? "Fountain" : ext === "md" ? "Markdown" : "Plain text"]: [ext] },
    title: "Export Text",
  });
  if (!target) return;
  const history = currentHistory();
  if (history && (await history.tracks(target.fsPath))) {
    void vscode.window.showErrorMessage(`${basename(target.fsPath)} is a document with its own writing history. Export to a new file.`);
    return;
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(stripRevisionTags(doc.getText())));
  if (history) await history.retire(target.fsPath);
  void vscode.window.showInformationMessage(`Exported ${basename(target.fsPath)}. It is a separate copy, outside the writing history.`);
}

/** Refuses a target that is already another document's history (converting over it would mix two works). */
async function freeForWork(path: string): Promise<boolean> {
  const history = currentHistory();
  if (!history || !(await history.tracks(path))) return true;
  void vscode.window.showErrorMessage(`${basename(path)} is a document with its own writing history. Choose another name.`);
  return false;
}

/** `name`, or "name 2", "name 3"… if a non-empty folder of that name is already there. */
async function freeFolderName(dir: string, name: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name} ${n}`;
    const p = join(dir, candidate);
    if (!existsSync(p) || (await readdir(p)).length === 0) return candidate;
  }
}

async function closeTabs(match: (uri: vscode.Uri) => boolean): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputText && match(t.input.uri));
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

/** Asks whether to move the file the work was converted from (and its images folder) to the Trash. */
async function offerTrash(file: vscode.Uri, images: string | null, tracked: boolean): Promise<void> {
  if (testing) return;
  const name = basename(file.fsPath);
  const folder = images && existsSync(images) ? images : null;
  const what = folder ? `${name} and the “${basename(folder)}” folder` : name;
  const choice = await vscode.window.showInformationMessage(
    `Move ${what} to the Trash?`,
    {
      modal: true,
      detail: `${tracked ? `The writing history now follows the converted file, and ${name} is no longer tracked. ` : ""}Everything in it is in the converted file. If you keep it and edit it, it is a separate copy${tracked ? " with a history of its own" : ""}.`,
    },
    "Move to Trash",
  );
  if (choice !== "Move to Trash") return;
  await vscode.workspace.fs.delete(file, { useTrash: true });
  if (folder) await vscode.workspace.fs.delete(vscode.Uri.file(folder), { recursive: true, useTrash: true });
}

