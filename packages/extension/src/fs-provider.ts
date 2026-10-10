import { stat } from "node:fs/promises";
import { ExternalChangeError } from "@highwater/bundle";
import * as vscode from "vscode";
import { BundleStore, EntryNotFoundError, splitBundlePath } from "./store.ts";

export const SCHEME = "highland";

/**
 * Exposes the inside of .highland files as editable files. `highland:/path/Script.highland` is the
 * script text; `highland:/path/Script.highland/bin/0.txt` and the like are other entries. The
 * .highland file itself stays the real copy: every save rewrites it in place (see BundleStore).
 */
export class HighlandFileSystem implements vscode.FileSystemProvider {
  readonly #changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.#changes.event;

  constructor(readonly store: BundleStore) {}

  /** Tells VS Code that entries changed on disk, so unmodified editors reload. */
  fireChanged(bundle: string, entries: string[]): void {
    this.#changes.fire(entries.map((entry) => ({ type: vscode.FileChangeType.Changed, uri: toHighlandUri(bundle, entry) })));
  }

  watch(uri: vscode.Uri): vscode.Disposable {
    const parts = splitBundlePath(uri.path);
    if (!parts) return new vscode.Disposable(() => {});
    return new vscode.Disposable(this.store.watch(parts.bundle));
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { bundle, entry } = parts(uri);
    const s = await guard(uri, () => this.store.stat(bundle, entry));
    const ctime = await stat(bundle).then((i) => i.birthtimeMs, () => s.mtime);
    return { type: s.isDirectory ? vscode.FileType.Directory : vscode.FileType.File, ctime, mtime: s.mtime, size: s.size };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { bundle, entry } = parts(uri);
    const list = await guard(uri, () => this.store.list(bundle, entry));
    return list.map((e) => [e.name, e.isDirectory ? vscode.FileType.Directory : vscode.FileType.File]);
  }

  readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { bundle, entry } = parts(uri);
    return guard(uri, () => this.store.read(bundle, entry));
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const { bundle, entry } = parts(uri);
    await guard(uri, () => this.store.write(bundle, entry, content));
    this.#changes.fire([{ type: vscode.FileChangeType.Changed, uri }]);
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

export function toHighlandUri(bundle: string, entry = ""): vscode.Uri {
  return vscode.Uri.file(entry === "" ? bundle : `${bundle}/${entry}`).with({ scheme: SCHEME });
}

function parts(uri: vscode.Uri): { bundle: string; entry: string } {
  const p = splitBundlePath(uri.fsPath);
  if (!p) throw vscode.FileSystemError.FileNotFound(uri);
  return p;
}

async function guard<T>(uri: vscode.Uri, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof EntryNotFoundError || (error as NodeJS.ErrnoException).code === "ENOENT") throw vscode.FileSystemError.FileNotFound(uri);
    if ((error as NodeJS.ErrnoException).code === "EACCES" || (error as NodeJS.ErrnoException).code === "EPERM") throw vscode.FileSystemError.NoPermissions(uri);
    if (error instanceof ExternalChangeError) throw vscode.FileSystemError.Unavailable(`${error.message}. Try saving again.`);
    throw error;
  }
}
