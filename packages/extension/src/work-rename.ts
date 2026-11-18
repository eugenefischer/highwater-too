import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
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

/**
 * Rename…: the title from the Rename window and, when the writer ticked "Also change file name?",
 * the file's new name. Returns why it couldn't be done, or null once renamed.
 */
export async function renameWork(host: WorksHost, work: { id: string | null; title: string; local: boolean }, here: string | undefined, typed: string, newFile?: string): Promise<string | null> {
  const title = typed.replace(/\s+/g, " ").trim();
  if (!work.id || !work.local) return "Only a work whose history is on this computer can be renamed.";
  if (!title) return "Type a title.";
  let file: string | undefined;
  if (here && newFile !== undefined) {
    const ext = extname(here);
    file = withExtension(newFile.trim(), ext);
    if (!file.slice(0, file.length - ext.length).trim()) return "Type a file name.";
    if (/[/\\:]/.test(file)) return "A file name can’t contain / \\ or :.";
    if (file === basename(here)) file = undefined;
    else if (existsSync(join(dirname(here), file))) return `${file} is already in that folder.`;
  }
  if (title === work.title && !file) return null;
  const h = host.history();
  if (here && file) {
    const moved = await renameWorkFile(host, here, file, work.id);
    if (!moved) return `${basename(here)} could not be renamed.`;
  }
  await h.rename(work.id, title, file ? { file } : {});
  await recorded(host);
  return null;
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
