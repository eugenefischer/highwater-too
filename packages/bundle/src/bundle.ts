import { unzipSync, zipSync, type Zippable } from "fflate";

/** Text file names Highland uses inside the bundle, by document mode. */
export const TEXT_FILES = { fountain: "text.fountain", markdown: "text.md", plain: "text.txt" } as const;
export type DocumentMode = keyof typeof TEXT_FILES;

/** info.json `type` values (UTIs) Highland writes for each mode. */
export const MODE_UTI: Record<DocumentMode, string> = {
  fountain: "com.quoteunquoteapps.fountain",
  markdown: "net.daringfireball.markdown",
  plain: "public.plain.text",
};

export const HIGHLAND_KEY = "com.quoteunquoteapps.highland2";
const REVISION_CACHE = "revisions/current.json";
const SUFFIX = ".textbundle";

export class BundleError extends Error {
  override name = "BundleError";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

/**
 * A .highland file: a ZIP holding one `<Name>.textbundle/` folder.
 *
 * Entries are kept as raw bytes in their original order; only entries that are explicitly
 * changed are re-encoded, so everything the extension does not understand round-trips untouched.
 */
export class HighlandBundle {
  /** Folder name inside the ZIP as read, e.g. "Untitled.textbundle". */
  readonly originalFolder: string;
  readonly #entries: Map<string, Uint8Array>;
  #textChanged = false;

  private constructor(folder: string, entries: Map<string, Uint8Array>) {
    this.originalFolder = folder;
    this.#entries = entries;
  }

  /** Parses .highland (ZIP) bytes. Tolerates directory entries, `__MACOSX/` and `.DS_Store` from Finder re-zips. */
  static fromZip(bytes: Uint8Array): HighlandBundle {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch (cause) {
      throw new BundleError("Not a readable ZIP archive", { cause });
    }
    const roots = new Set<string>();
    for (const name of Object.keys(files)) {
      const top = name.split("/")[0] ?? "";
      if (top.endsWith(SUFFIX)) roots.add(top);
    }
    if (roots.size !== 1) {
      throw new BundleError(roots.size === 0 ? "No .textbundle folder in the archive" : `Several .textbundle folders: ${[...roots].join(", ")}`);
    }
    const folder = [...roots][0]!;
    const entries = new Map<string, Uint8Array>();
    for (const [name, data] of Object.entries(files)) {
      if (!name.startsWith(`${folder}/`) || name.endsWith("/")) continue;
      const path = name.slice(folder.length + 1);
      if (path === "" || path.split("/").includes(".DS_Store")) continue;
      entries.set(path, data);
    }
    return new HighlandBundle(folder, entries);
  }

  /** Builds a bundle from entries (paths relative to the .textbundle folder). */
  static fromEntries(folder: string, entries: Iterable<[string, Uint8Array | string]>): HighlandBundle {
    const map = new Map<string, Uint8Array>();
    for (const [path, data] of entries) map.set(path, typeof data === "string" ? encoder.encode(data) : data);
    return new HighlandBundle(folder.endsWith(SUFFIX) ? folder : folder + SUFFIX, map);
  }

  /** Entry paths in order. */
  get paths(): string[] {
    return [...this.#entries.keys()];
  }

  has(path: string): boolean {
    return this.#entries.has(path);
  }

  get(path: string): Uint8Array | undefined {
    return this.#entries.get(path);
  }

  getText(path: string): string | undefined {
    const data = this.#entries.get(path);
    return data === undefined ? undefined : decoder.decode(data);
  }

  /** Sets an entry; new paths are appended after existing ones. Setting the script text goes through `text`. */
  set(path: string, data: Uint8Array | string): void {
    if (path === this.textPath) {
      this.text = typeof data === "string" ? data : decoder.decode(data);
      return;
    }
    this.#entries.set(path, typeof data === "string" ? encoder.encode(data) : data);
  }

  delete(path: string): boolean {
    return this.#entries.delete(path);
  }

  /** The script's file name: text.fountain, text.md or text.txt. */
  get textPath(): string {
    const found = Object.values(TEXT_FILES).find((name) => this.#entries.has(name));
    if (found) return found;
    const loose = this.paths.find((p) => /^text\.[^/]+$/.test(p));
    if (loose) return loose;
    throw new BundleError("No text file in the bundle");
  }

  get mode(): DocumentMode {
    const name = this.textPath;
    if (name.endsWith(".fountain")) return "fountain";
    if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
    return "plain";
  }

  /** The script text exactly as stored: line endings and inline {{REVISION}} tags are kept. */
  get text(): string {
    return this.getText(this.textPath) ?? "";
  }

  set text(value: string) {
    const path = this.textPath;
    const next = encoder.encode(value);
    const prev = this.#entries.get(path);
    if (prev && bytesEqual(prev, next)) return;
    this.#entries.set(path, next);
    this.#textChanged = true;
  }

  /** True once the script text differs from what was read. */
  get textChanged(): boolean {
    return this.#textChanged;
  }

  /** Parsed info.json; unknown keys are kept. Returns a copy: change it and pass it to `setInfo`. */
  get info(): Record<string, unknown> {
    const raw = this.getText("info.json");
    if (raw === undefined) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (cause) {
      throw new BundleError("info.json is not valid JSON", { cause });
    }
  }

  /** Writes info.json compactly (as Highland does), only if its content changed. */
  setInfo(info: Record<string, unknown>): void {
    if (JSON.stringify(info) === JSON.stringify(this.info)) return;
    this.#entries.set("info.json", encoder.encode(JSON.stringify(info)));
  }

  /** Highland's own settings block from info.json. */
  get highlandSettings(): Record<string, unknown> {
    const block = this.info[HIGHLAND_KEY];
    return block && typeof block === "object" ? { ...(block as Record<string, unknown>) } : {};
  }

  setHighlandSettings(settings: Record<string, unknown>): void {
    this.setInfo({ ...this.info, [HIGHLAND_KEY]: settings });
  }

  /** Bin items in display order (bin/0.txt, bin/1.txt, …). */
  get binItems(): string[] {
    return this.paths
      .map((p) => /^bin\/(\d+)\.txt$/.exec(p))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => this.getText(m[0]) ?? "");
  }

  /** Replaces all Bin items, renumbering from 0. */
  setBinItems(items: string[]): void {
    for (const p of this.paths) if (/^bin\/\d+\.txt$/.test(p)) this.#entries.delete(p);
    items.forEach((text, i) => this.#entries.set(`bin/${i}.txt`, encoder.encode(text)));
  }

  get scratchpad(): string | undefined {
    return this.getText("scratchpad.txt");
  }

  set scratchpad(value: string) {
    this.#entries.set("scratchpad.txt", encoder.encode(value));
  }

  /**
   * Serializes to .highland bytes.
   * - The folder is named after `documentName` (Highland renames it on save too).
   * - `revisions/current.json` is dropped if the text changed (Highland rebuilds revisions from the inline tags).
   * - Deflate, no directory entries, original entry order.
   */
  toZip(documentName: string, options: { mtime?: Date } = {}): Uint8Array {
    const folder = `${stripHighlandExtension(documentName)}${SUFFIX}`;
    const mtime = options.mtime ?? new Date();
    const files: Zippable = {};
    for (const [path, data] of this.#entries) {
      if (this.#textChanged && path === REVISION_CACHE) continue;
      files[`${folder}/${path}`] = [data, { level: 6, mtime }];
    }
    return zipSync(files);
  }
}

/** "My Script.highland" -> "My Script"; also accepts a path. */
export function stripHighlandExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.highland$/i, "");
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
