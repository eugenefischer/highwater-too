import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { DocumentFiles, History } from "@highwater/history";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
import { assetsFolderName, ExtrasFolder, listAssets, noteId, sameExtras, type ExtrasFiles } from "./extras-folder.ts";

/**
 * Bin, Scratchpad, assets and settings for plain .fountain and .md files (see ExtrasFolder). The
 * Bin items and Scratchpad open through the highwater-extras: scheme, which maps to the files in
 * the extras folder, so that the panels can tell open editors when items are renumbered.
 */
export const EXTRAS_SCHEME = "highwater-extras";
const NOTICE_KEY = "highwater.plainExtrasNoticeShown";

export interface ExtrasHost {
  /** The writing history, or null when it is turned off. */
  history(): History | null;
  historyRoot(): string;
}

let instance: PlainExtras | undefined;

/** The extras service, once the extension has started. */
export function plainExtras(): PlainExtras {
  if (!instance) throw new Error("Highwater Too has not started yet");
  return instance;
}

export function startPlainExtras(context: vscode.ExtensionContext, host: ExtrasHost): PlainExtras {
  instance = new PlainExtras(context, host);
  const fs = new ExtrasFileSystem(instance);
  context.subscriptions.push(instance, vscode.workspace.registerFileSystemProvider(EXTRAS_SCHEME, fs, { isCaseSensitive: true }));
  return instance;
}

export class PlainExtras implements vscode.Disposable {
  readonly #context: vscode.ExtensionContext;
  readonly #host: ExtrasHost;
  /** Plain file path → its extras folder (null: it has none yet). */
  #cache = new Map<string, ExtrasFolder | null>();
  /** Bumped whenever folders are made or forgotten (see folder()). */
  #gen = 0;
  /** Extras folder → the plain file it belongs to. */
  readonly #owners = new Map<string, string>();
  readonly #fileChanges = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  /** Fires with a plain file's path when its extras change. */
  readonly #changed = new vscode.EventEmitter<string>();
  readonly onDidChangeFile = this.#fileChanges.event;
  readonly onDidChange = this.#changed.event;

  constructor(context: vscode.ExtensionContext, host: ExtrasHost) {
    this.#context = context;
    this.#host = host;
  }

  /** A plain .fountain, .md or .txt file shown as a Highwater document. */
  isPlain(doc: vscode.TextDocument | undefined): boolean {
    return !!doc && doc.uri.scheme === "file" && doc.languageId.startsWith("highland-");
  }

  /** Where extras are kept while the writing history is off (moved into the history when it is on). */
  #standIn(path: string): ExtrasFolder {
    const key = createHash("sha1").update(path).digest("hex").slice(0, 16);
    return new ExtrasFolder(join(this.#context.globalStorageUri.fsPath, "extras", key));
  }

  #inHistory(id: string): ExtrasFolder {
    return new ExtrasFolder(join(this.#host.historyRoot(), "extras", id));
  }

  /** Folders extras may be in (the file system provider serves nothing else). */
  roots(): string[] {
    return [join(this.#host.historyRoot(), "extras"), join(this.#context.globalStorageUri.fsPath, "extras")];
  }

  async #text(path: string): Promise<string> {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && d.uri.fsPath === path);
    return open ? open.getText() : readFile(path, "utf8").catch(() => "");
  }

  /**
   * The plain file's extras folder: null if it has none and `create` is false. Creating one also
   * gives the file its place in the writing history, which names the folder.
   */
  async folder(path: string, create = false, fresh = false): Promise<ExtrasFolder | null> {
    const cached = this.#cache.get(path);
    if (!fresh && cached !== undefined && (cached !== null || !create)) return cached;
    // A lookup that started before a folder was made, or before forget(), must not overwrite
    // what is known now: only the latest generation is cached.
    const gen = this.#gen;
    const h = this.#host.history();
    const standIn = this.#standIn(path);
    let folder: ExtrasFolder | null = null;
    if (!h) folder = standIn.exists || create ? standIn : null;
    else {
      const text = await this.#text(path);
      const doc = { id: noteId(text), path, text };
      const found = create || standIn.exists ? await h.resolve(doc) : await h.find(doc);
      if (found) {
        folder = this.#inHistory(found.id);
        if (standIn.exists && !folder.exists) folder = await standIn.moveTo(folder.dir);
        if (!folder.exists && !create) folder = null;
      }
    }
    if (folder) this.#owners.set(folder.dir, path);
    if (create) this.#gen++;
    if (create || gen === this.#gen) this.#cache.set(path, folder);
    return folder;
  }

  /**
   * Where a plain file's extras go when it is made from a .highland file (converted or restored):
   * in the history under its document ID, or the stand-in place when the history is off.
   */
  prepare(path: string, id: string | null): ExtrasFolder {
    const folder = this.#host.history() && id ? this.#inHistory(id) : this.#standIn(path);
    this.#owners.set(folder.dir, path);
    this.#cache.delete(path);
    this.#gen++;
    return folder;
  }

  /**
   * A work's history is going (deleted): its plain file keeps its Bin, Scratchpad and settings,
   * moved to the stand-in place, from which its new history's first save takes them.
   */
  async keepForNewHistory(path: string, id: string): Promise<void> {
    const folder = this.#inHistory(id);
    if (!folder.exists) return;
    const standIn = this.#standIn(path);
    if (standIn.exists) await standIn.remove();
    await folder.moveTo(standIn.dir);
    this.forget();
  }

  /** The extras of a work joined into another move to the other's ID (this computer's win). */
  async moveTo(fromId: string, toId: string): Promise<void> {
    const from = this.#inHistory(fromId);
    if (!from.exists) return;
    const to = this.#inHistory(toId);
    if (to.exists) await to.remove();
    await from.moveTo(to.dir);
    this.forget();
  }

  /** Removes a work's extras from this computer (its history was removed here; the mirror has them). */
  async removeFor(id: string): Promise<void> {
    await this.#inHistory(id).remove();
    this.forget();
  }

  /** The plain file's ID in the writing history (giving it one if needed); null when history is off. */
  async documentId(path: string): Promise<string | null> {
    const h = this.#host.history();
    if (!h) return null;
    await this.folder(path, true);
    const text = await this.#text(path);
    return (await h.resolve({ id: noteId(text), path, text })).id;
  }

  /** The plain file an extras file (a Bin item or the Scratchpad) belongs to, if known. */
  ownerOf(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== EXTRAS_SCHEME) return undefined;
    for (const [dir, path] of this.#owners) if (uri.fsPath.startsWith(dir + sep)) return path;
    return undefined;
  }

  /** Forget cached lookups (the history folder changed, or saves came in from another computer). */
  forget(): void {
    this.#cache = new Map();
    this.#gen++;
  }

  uri(file: string): vscode.Uri {
    return vscode.Uri.file(file).with({ scheme: EXTRAS_SCHEME });
  }

  fireChanged(files: string[]): void {
    this.#fileChanges.fire(files.map((f) => ({ type: vscode.FileChangeType.Changed, uri: this.uri(f) })));
  }

  changed(path: string): void {
    this.#changed.fire(path);
  }

  // -------------------------------------------------------------------------------------------
  // Assets: a visible folder next to the file, made when the first image is added.

  async assetsFolder(path: string): Promise<{ name: string; dir: string }> {
    const settings = (await (await this.folder(path))?.settings()) ?? {};
    const name = typeof settings.assetsFolder === "string" && settings.assetsFolder ? settings.assetsFolder : assetsFolderName(path);
    return { name, dir: join(dirname(path), name) };
  }

  async assets(path: string): Promise<string[]> {
    return listAssets((await this.assetsFolder(path)).dir);
  }

  /** Copies images into the assets folder (making it), under names not already taken. */
  async addAssets(path: string, files: { name: string; data: Uint8Array }[], unique: (name: string, taken: string[]) => string): Promise<string[]> {
    const folder = await this.folder(path, true);
    const { name, dir } = await this.assetsFolder(path);
    await mkdir(dir, { recursive: true });
    if (folder) await folder.updateSettings({ assetsFolder: name });
    const taken = await listAssets(dir);
    const added: string[] = [];
    for (const f of files) {
      const n = unique(f.name, taken);
      taken.push(n);
      await writeFile(join(dir, n), f.data, { flag: "wx" });
      added.push(n);
    }
    this.changed(path);
    return added;
  }

  // -------------------------------------------------------------------------------------------
  // The writing history.

  /** What a save of a plain file records besides its text. */
  async historyFiles(path: string): Promise<Pick<DocumentFiles, "bin" | "scratchpad" | "others">> {
    // Looked up afresh: a save must record what is there now, never a stale "none yet".
    const folder = await this.folder(path, false, true);
    const out: Pick<DocumentFiles, "bin" | "scratchpad" | "others"> = {};
    if (folder) {
      const files = await folder.files();
      if (files.bin.length) out.bin = files.bin;
      if (files.scratchpad !== undefined) out.scratchpad = files.scratchpad;
      if (files.document) out.others = files.document;
    }
    const { dir } = await this.assetsFolder(path);
    const names = await listAssets(dir);
    const images = await Promise.all(names.map(async (n) => ({ path: `assets/${n}`, data: new Uint8Array(await readFile(join(dir, n))) })));
    if (images.length) out.others = [...(out.others ?? []), ...images];
    return out;
  }

  /** After a save was recorded: these extras match that save. */
  async recorded(path: string, hash: string | null): Promise<void> {
    const folder = await this.folder(path);
    if (!folder) return;
    const h = this.#host.history();
    const head = hash ?? (h ? await this.#head(h, path) : null);
    if (head) await folder.setBase(head);
  }

  async #head(h: History, path: string): Promise<string | null> {
    const text = await this.#text(path);
    const found = await h.find({ id: noteId(text), path, text });
    return found ? ((await h.log(found.id, 1))[0]?.hash ?? null) : null;
  }

  /**
   * Brings in the Bin, Scratchpad and settings saved on another computer, when they have not been
   * changed here since this computer last saved or brought them in. Changes here win otherwise,
   * as the text does.
   */
  async bringIn(path: string): Promise<boolean> {
    const h = this.#host.history();
    if (!h) return false;
    const text = await this.#text(path);
    const found = await h.find({ id: noteId(text), path, text });
    if (!found) return false;
    const head = (await h.log(found.id, 1))[0];
    if (!head) return false;
    const folder = this.#inHistory(found.id);
    const base = await folder.base();
    if (base === head.hash) return false;
    const theirs = toExtras(await h.filesAt(head.hash));
    const local: ExtrasFiles = folder.exists ? await folder.files() : { bin: [] };
    if (sameExtras(local, theirs)) {
      await folder.setBase(head.hash);
      return false;
    }
    const before: ExtrasFiles = base ? toExtras(await h.filesAt(base).catch(() => ({ scriptName: "", script: "" }))) : { bin: [] };
    if (!sameExtras(local, before)) return false;
    const count = folder.exists ? (await folder.binItems()).length : 0;
    await folder.replace(theirs);
    await folder.setBase(head.hash);
    this.#owners.set(folder.dir, path);
    this.#cache.set(path, folder);
    this.fireChanged([folder.scratchpadPath, ...Array.from({ length: Math.max(count, theirs.bin.length) }, (_, i) => folder.binPath(i))]);
    this.changed(path);
    return true;
  }

  // -------------------------------------------------------------------------------------------

  /**
   * Once ever, before the first Bin item, Scratchpad or image of a plain file: says these are not
   * part of the file. Returns false to stop (the writer cancelled, or chose to save as .highland).
   */
  async confirm(path: string): Promise<boolean> {
    if (this.#context.globalState.get<boolean>(NOTICE_KEY)) return true;
    const kind = extname(path) || "text";
    const where = this.#host.history()
      ? "Highwater Too saves them with your writing history instead"
      : "Highwater Too keeps them on this computer instead (the writing history is off, so they are not recorded with it)";
    const choice = await ask(
      "warning",
      `${basename(path)} is a plain ${kind} file, which can’t hold a Bin or Scratchpad.`,
      {
        modal: true,
        detail:
          `${where}. They are not part of the file itself: only Highwater Too shows them, and they don’t travel with the file when you copy or send it. ` +
          `Images go in a “${assetsFolderName(path)}” folder next to the file.\n\n` +
          "To keep everything in one file, convert it to a .highland file. This message is shown once.",
      },
      "Continue",
      "Convert to .highland File…",
    );
    if (!choice) return false;
    await this.#context.globalState.update(NOTICE_KEY, true);
    if (choice === "Continue") return true;
    await vscode.commands.executeCommand("highwater.convertToHighland", vscode.Uri.file(path));
    return false;
  }

  dispose(): void {
    this.#fileChanges.dispose();
    this.#changed.dispose();
  }
}

/** The extras part of a recorded save. */
export function toExtras(files: DocumentFiles): ExtrasFiles {
  const out: ExtrasFiles = { bin: files.bin ?? [] };
  if (files.scratchpad !== undefined) out.scratchpad = files.scratchpad;
  const document = (files.others ?? []).filter((o) => !/^assets\/[^/]+$/.test(o.path));
  if (document.length) out.document = document;
  return out;
}

/** Serves Bin items and Scratchpads of plain files from their extras folders. */
class ExtrasFileSystem implements vscode.FileSystemProvider {
  readonly #extras: PlainExtras;
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]>;

  constructor(extras: PlainExtras) {
    this.#extras = extras;
    this.onDidChangeFile = extras.onDidChangeFile;
  }

  #path(uri: vscode.Uri): string {
    const p = uri.fsPath;
    if (!this.#extras.roots().some((r) => !relative(r, p).startsWith("..") && relative(r, p) !== "")) throw vscode.FileSystemError.NoPermissions(uri);
    return p;
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    try {
      const s = await stat(this.#path(uri));
      return { type: s.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File, ctime: s.birthtimeMs, mtime: s.mtimeMs, size: s.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
      throw error;
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const entries = await readdir(this.#path(uri), { withFileTypes: true });
    return entries.map((e) => [e.name, e.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.#path(uri)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
      throw error;
    }
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const p = this.#path(uri);
    if (!existsSync(dirname(p))) throw vscode.FileSystemError.FileNotFound(uri);
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, content);
    await rename(tmp, p);
    this.#extras.fireChanged([p]);
    const owner = this.#extras.ownerOf(uri);
    if (owner) this.#extras.changed(owner);
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}
