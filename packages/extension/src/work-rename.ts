import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import * as vscode from "vscode";
import { ask, askText } from "./ask.ts";
import { EXTRAS_SCHEME, plainExtras } from "./extras.ts";
import { SCHEME } from "./fs-provider.ts";
import { splitBundlePath } from "./store.ts";
import type { WorksHost } from "./works.ts";

/**
 * Renaming a work (EJ, 2026-11-18; claude/work-rename-design.md): a new title is an entry in the
 * work's history, and the writer may give its file a new name too (the two needn't match). Only a
 * work whose history is on this computer can be renamed. Another computer is asked whether to
 * rename its file as well, when it next opens it.
 */

/** Rename…: the title the writer typed on the Works card, then the file's name if they want. */
export async function renameWork(host: WorksHost, work: { id: string | null; title: string; local: boolean }, here: string | undefined, typed: string): Promise<boolean> {
  const title = typed.replace(/\s+/g, " ").trim();
  if (!work.id || !work.local || !title || title === work.title) return false;
  let file: string | undefined;
  if (here) {
    const name = basename(here);
    const choice = await ask(
      "info",
      `Rename the file too?`,
      { modal: true, detail: `“${title}” is kept in ${name}. A file's name doesn't have to match its work's title.` },
      "Rename File…",
      "Keep File Name",
    );
    if (!choice) return false;
    if (choice === "Rename File…") {
      const chosen = await askFileName(here, title);
      if (chosen === undefined) return false;
      if (chosen !== name) file = chosen;
    }
  }
  const h = host.history();
  if (here && file) {
    const moved = await renameWorkFile(host, here, file, work.id);
    if (!moved) return false;
  }
  await h.rename(work.id, title, file ? { file } : {});
  await recorded(host);
  return true;
}

/**
 * When the document comes into focus: a rename made on another computer gave the work's file a
 * new name; offer the same name here (once).
 */
export async function offerFileRename(host: WorksHost, key: string, id: string): Promise<void> {
  const h = host.history();
  const offer = await h.fileRename(id, basename(key));
  if (!offer) return;
  if (existsSync(join(dirname(key), offer.file))) {
    await h.answerFileRename(id, offer.hash);
    return;
  }
  const choice = await ask(
    "info",
    `This work was renamed to “${offer.title}” on another computer, with its file renamed to ${offer.file}. Rename this file too?`,
    { detail: `It is ${basename(key)} on this computer.` },
    "Rename File",
    "Keep This Name",
  );
  if (!choice) return; // asked again next time
  await h.answerFileRename(id, offer.hash);
  if (choice === "Rename File") {
    await renameWorkFile(host, key, offer.file, id);
    host.changed();
  }
}

/** The file's new name, in the same folder and with the same extension; undefined if cancelled. */
async function askFileName(path: string, title: string): Promise<string | undefined> {
  const ext = extname(path);
  const suggested = `${title.replace(/[/\\:*?"<>|]+/g, "-").replace(/^\.+/, "").trim() || "Untitled"}${ext}`;
  const answer = await askText({
    title: "Rename the File",
    prompt: `The new name for ${basename(path)} (in the same folder)`,
    value: suggested,
    valueSelection: [0, suggested.length - ext.length],
    validateInput: (value) => {
      const name = withExtension(value.trim(), ext);
      if (!value.trim() || name === ext) return "Type a name.";
      if (/[/\\:]/.test(name)) return "A file name can't contain / \\ or :.";
      if (name !== basename(path) && existsSync(join(dirname(path), name))) return `${name} is already in this folder.`;
      return null;
    },
  });
  if (answer === undefined) return undefined;
  const name = withExtension(answer.trim(), ext);
  if (!answer.trim() || /[/\\:]/.test(name) || (name !== basename(path) && existsSync(join(dirname(path), name)))) return undefined;
  return name;
}

const withExtension = (name: string, ext: string) => (name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`);

/**
 * Gives a work's file a new name in its folder: unsaved changes are saved (and recorded) first, its
 * tabs close, the file is renamed, the history follows it there, and it opens again if it was open.
 * A plain file's images folder keeps its name (the text's image links point into it). Returns the
 * new path, or null if it could not be done.
 */
export async function renameWorkFile(host: WorksHost, path: string, name: string, id: string): Promise<string | null> {
  const target = join(dirname(path), name);
  if (existsSync(target)) {
    void vscode.window.showErrorMessage(`${name} is already in that folder, so ${basename(path)} was not renamed.`);
    return null;
  }
  const plain = !path.toLowerCase().endsWith(".highland");
  const extras = plainExtras();
  const belongs = (uri: vscode.Uri) =>
    (uri.scheme === "file" && uri.fsPath === path) ||
    (uri.scheme === SCHEME && splitBundlePath(uri.fsPath)?.bundle === path) ||
    (plain && uri.scheme === EXTRAS_SCHEME && extras.ownerOf(uri) === path);
  for (const doc of vscode.workspace.textDocuments.filter((d) => belongs(d.uri) && d.isDirty)) {
    if (!(await doc.save())) {
      void vscode.window.showErrorMessage(`${basename(path)} has unsaved changes that could not be saved, so it was not renamed.`);
      return null;
    }
  }
  await host.settle(path);
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => {
    const input = t.input;
    return (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) && belongs(input.uri);
  });
  const wasOpen = tabs.some((t) => {
    const uri = (t.input as vscode.TabInputText | vscode.TabInputCustom).uri;
    return uri.scheme !== EXTRAS_SCHEME && !(uri.scheme === SCHEME && splitBundlePath(uri.fsPath)?.entry);
  });
  if (tabs.length && !(await vscode.window.tabGroups.close(tabs))) {
    void vscode.window.showErrorMessage(`${basename(path)} could not be closed, so it was not renamed.`);
    return null;
  }
  if (plain) {
    // Pinned by name, so the images stay found after the file's name changes.
    const images = await extras.assetsFolder(path);
    if (existsSync(images.dir)) await (await extras.folder(path, true))?.updateSettings({ assetsFolder: images.name });
  }
  try {
    await vscode.workspace.fs.rename(vscode.Uri.file(path), vscode.Uri.file(target), { overwrite: false });
  } catch (error) {
    void vscode.window.showErrorMessage(`${basename(path)} could not be renamed: ${(error as Error).message}`);
    if (wasOpen) await host.openFile(path);
    return null;
  }
  await host.history().attach(id, target);
  extras.forget();
  host.connector.forget([path, target]);
  if (wasOpen) await host.openFile(target);
  return target;
}

/** A rename is in the history: the catalog goes to main with the next push; with no mirror, now. */
async function recorded(host: WorksHost): Promise<void> {
  if (host.mirror.url) host.mirror.afterSave();
  else await host.history().flushCatalog();
  host.changed();
}
