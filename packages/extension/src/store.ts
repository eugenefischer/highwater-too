import { watch, type FSWatcher } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { HighlandBundle, readBundle, stripHighlandExtension, unchangedSince, writeBundle, type DiskFingerprint } from "@highwater/bundle";

/**
 * Open .highland bundles, shared by every editor tab showing one of their entries (the script,
 * later Bin items and the Scratchpad). No VS Code dependency, so it is unit-tested on real files.
 *
 * Entry "" is the script text (text.fountain, text.md or text.txt); other entries are paths inside
 * the .textbundle folder, e.g. "bin/0.txt".
 */
export class BundleStore {
  readonly #open = new Map<string, OpenBundle>();
  readonly #listeners = new Set<(path: string, entries: string[]) => void>();
  readonly #options: Required<StoreOptions>;

  constructor(options: StoreOptions) {
    this.#options = { keepBackups: 10, now: () => new Date(), debounceMs: 200, ...options };
  }

  /**
   * Called when another program changed a bundle that is open here, with the entries whose content
   * changed ("" for the script). The cache is already reloaded.
   */
  onExternalChange(listener: (path: string, entries: string[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async read(path: string, entry = ""): Promise<Uint8Array> {
    const { bundle } = await this.#current(path);
    const data = bundle.get(entry === "" ? bundle.textPath : entry);
    if (!data) throw new EntryNotFoundError(`${basename(path)} has no ${entry || "text"}`);
    return data;
  }

  /**
   * `mtime` is when this entry's content last changed, not the bundle file's time: Highland
   * rewrites the whole file when only its settings change, which must not look like an edit.
   */
  async stat(path: string, entry = ""): Promise<{ mtime: number; size: number; isDirectory: boolean }> {
    const { bundle, fingerprint, times } = await this.#current(path);
    const key = entry === "" ? bundle.textPath : entry;
    if (!bundle.has(key)) {
      if (bundle.paths.some((p) => p.startsWith(`${entry}/`))) return { mtime: fingerprint.mtimeMs, size: 0, isDirectory: true };
      throw new EntryNotFoundError(`${basename(path)} has no ${entry}`);
    }
    return { mtime: times.get(key) ?? fingerprint.mtimeMs, size: bundle.get(key)!.byteLength, isDirectory: false };
  }

  /** Entry paths directly inside `folder` ("" for the bundle's top level). */
  async list(path: string, folder = ""): Promise<{ name: string; isDirectory: boolean }[]> {
    const { bundle } = await this.#current(path);
    const prefix = folder === "" ? "" : `${folder}/`;
    const seen = new Map<string, boolean>();
    for (const p of bundle.paths) {
      if (!p.startsWith(prefix)) continue;
      const [name, ...rest] = p.slice(prefix.length).split("/");
      if (name) seen.set(name, seen.get(name) === true || rest.length > 0);
    }
    return [...seen].map(([name, isDirectory]) => ({ name, isDirectory }));
  }

  /** Highland's settings block from info.json (print options and so on). */
  async highlandSettings(path: string): Promise<Record<string, unknown>> {
    return (await this.#current(path)).bundle.highlandSettings;
  }

  /** Fountain, Markdown or plain text, from the bundle's text file. */
  async mode(path: string): Promise<"fountain" | "markdown" | "plain"> {
    return (await this.#current(path)).bundle.mode;
  }

  /** Text of the file as it is on disk now, ignoring the cache (for Compare). */
  async readFromDisk(path: string, entry = ""): Promise<Uint8Array> {
    const { bundle } = await readBundle(path);
    return bundle.get(entry === "" ? bundle.textPath : entry) ?? new Uint8Array();
  }

  /**
   * Saves one entry. Writes are queued per bundle. If the file changed on disk since it was read
   * (VS Code has already asked the user, or the change was elsewhere in the bundle), the entry is
   * applied on top of the disk version, so other programs' changes to other entries survive.
   * Before the first save of a bundle in this session, the original file is backed up.
   */
  write(path: string, entry: string, data: Uint8Array): Promise<void> {
    const state = this.#state(path);
    const run = state.queue.then(async () => {
      state.writing = true;
      try {
        let current = await this.#current(path);
        if (!(await unchangedSince(path, current.fingerprint).catch(() => false))) current = await this.#load(path);
        if (!state.backedUp) {
          await this.#backup(path);
          state.backedUp = true;
        }
        const { bundle } = current;
        const key = entry === "" ? bundle.textPath : entry;
        bundle.set(key, data);
        try {
          await writeBundle(path, bundle, { expected: current.fingerprint });
          const saved = await this.#load(path, current);
          saved.times.set(key, saved.fingerprint.mtimeMs);
        } catch (error) {
          state.loaded = undefined; // the cached bundle holds unsaved data now; reload on next read
          throw error;
        }
      } finally {
        state.writing = false;
      }
    });
    state.queue = run.catch(() => {});
    return run;
  }

  /** Writes the bundle as it is in memory, with `entry` replaced, to a new file (Save As). */
  async writeCopy(path: string, entry: string, data: Uint8Array, target: string): Promise<void> {
    const copy = HighlandBundle.fromZip((await this.#current(path)).bundle.toZip(basename(path)));
    copy.set(entry === "" ? copy.textPath : entry, data);
    await writeBundle(target, copy);
  }

  /**
   * Starts watching a bundle for changes by other programs. Watches the folder, because Highland
   * (like this extension) saves by renaming a new file over the old one.
   */
  watch(path: string): () => void {
    const state = this.#state(path);
    state.watchers++;
    if (!state.watcher) {
      let timer: NodeJS.Timeout | undefined;
      try {
        state.watcher = watch(dirname(path), (_event, name) => {
          if (name !== null && name.toString() !== basename(path)) return;
          clearTimeout(timer);
          timer = setTimeout(() => void this.#checkDisk(path), this.#options.debounceMs);
        });
      } catch {
        // Folder unavailable (e.g. an unmounted drive): saves still check the disk first.
      }
    }
    return () => {
      if (--state.watchers > 0) return;
      state.watcher?.close();
      state.watcher = undefined;
      this.#open.delete(path);
    };
  }

  /** Re-checks the disk now (also used by tests instead of waiting for the watcher). */
  async #checkDisk(path: string): Promise<void> {
    const state = this.#open.get(path);
    if (!state?.loaded || state.writing) return;
    const before = state.loaded;
    const unchanged = await unchangedSince(path, before.fingerprint).catch(() => false);
    if (unchanged || state.writing) return;
    let after: Loaded;
    try {
      after = await this.#load(path);
    } catch {
      return; // mid-write by the other program, or deleted; the next event or read will tell
    }
    const text = after.bundle.textPath;
    const changed = after.bundle.paths.filter((p) => after.times.get(p) !== before.times.get(p)).map((p) => (p === text ? "" : p));
    for (const listener of this.#listeners) listener(path, changed);
  }

  checkDisk(path: string): Promise<void> {
    return this.#checkDisk(path);
  }

  dispose(): void {
    for (const state of this.#open.values()) state.watcher?.close();
    this.#open.clear();
  }

  #state(path: string): OpenBundle {
    let state = this.#open.get(path);
    if (!state) {
      state = { queue: Promise.resolve(), backedUp: false, writing: false, watchers: 0 };
      this.#open.set(path, state);
    }
    return state;
  }

  async #current(path: string): Promise<Loaded> {
    const state = this.#state(path);
    if (state.loaded && (state.writing || (await unchangedSince(path, state.loaded.fingerprint).catch(() => false)))) return state.loaded;
    return this.#load(path);
  }

  /**
   * Reads the bundle from disk (fresh, so `textChanged` and revision handling start over after a
   * save). Entries whose bytes match `previous` keep their change time.
   */
  async #load(path: string, previous = this.#open.get(path)?.loaded): Promise<Loaded> {
    const { bundle, fingerprint } = await readBundle(path);
    const times = new Map<string, number>();
    for (const p of bundle.paths) {
      const old = previous?.bundle.get(p);
      const same = old !== undefined && bytesEqual(old, bundle.get(p)!);
      times.set(p, same ? (previous!.times.get(p) ?? fingerprint.mtimeMs) : fingerprint.mtimeMs);
    }
    const loaded = { bundle, fingerprint, times };
    this.#state(path).loaded = loaded;
    return loaded;
  }

  async #backup(path: string): Promise<void> {
    const dir = join(await this.#options.backupFolder(), stripHighlandExtension(path));
    await mkdir(dir, { recursive: true });
    const stamp = this.#options.now().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
    await copyFile(path, join(dir, `${stamp}.highland`));
    const old = (await readdir(dir)).filter((f) => f.endsWith(".highland")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - this.#options.keepBackups))) await rm(join(dir, f), { force: true });
  }
}

export interface StoreOptions {
  /** Where session backups go: `<folder>/<document name>/<date-time>.highland`. */
  backupFolder: () => string | Promise<string>;
  keepBackups?: number;
  now?: () => Date;
  debounceMs?: number;
}

export class EntryNotFoundError extends Error {
  override name = "EntryNotFoundError";
}

interface Loaded {
  bundle: HighlandBundle;
  fingerprint: DiskFingerprint;
  /** Per entry: when its content last changed (ms). */
  times: Map<string, number>;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface OpenBundle {
  loaded?: Loaded | undefined;
  queue: Promise<void>;
  backedUp: boolean;
  writing: boolean;
  watchers: number;
  watcher?: FSWatcher | undefined;
}

/** Splits a highland: URI path into the .highland file and the entry inside it. */
export function splitBundlePath(uriPath: string): { bundle: string; entry: string } | null {
  const m = /^(.*?\.highland)(?:\/(.*))?$/i.exec(uriPath);
  if (!m) return null;
  return { bundle: m[1]!, entry: (m[2] ?? "").replace(/\/$/, "") };
}
