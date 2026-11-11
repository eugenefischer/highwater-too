import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { HIGHLAND_KEY } from "@highwater/bundle";

/**
 * A plain .fountain or .md file's extras: what a .highland file would hold besides the text. A
 * plain file has nowhere to keep them, so they live in a folder of their own in the writing history
 * folder (`<history>/extras/<document ID>/`): `bin/0.txt`…, `scratchpad.txt`, and in `document/`
 * the rest of the .highland file (info.json and so on: everything a .highland file it came from had,
 * or just an info.json holding its print template). Each save commits them with the text, at the
 * same paths as in a .highland file. `local.json` holds what only this computer needs (the name of
 * the images folder) and is not committed. No VS Code dependency, so it is unit-tested.
 *
 * Images are different: the text refers to them by path, so they go in a visible folder next to
 * the file (`<name> assets`), made only when the first one is added.
 */
export interface ExtrasSettings {
  /** The print template chosen in the preview, as a .highland file's templateName. */
  templateName?: string;
  /** The images folder next to the file, by name (kept, so renaming the file does not lose it). */
  assetsFolder?: string;
  /** Highland's print options (title page, synopses…), as a .highland file's printOptions. */
  printOptions?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface ExtrasFiles {
  bin: string[];
  scratchpad?: string;
  /** The rest of the .highland file (info.json and so on), by path inside it; no images. */
  document?: { path: string; data: Uint8Array }[];
}

export class ExtrasFolder {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  get exists(): boolean {
    return existsSync(this.dir);
  }

  get scratchpadPath(): string {
    return join(this.dir, "scratchpad.txt");
  }

  binPath(index: number): string {
    return join(this.dir, "bin", `${index}.txt`);
  }

  async binItems(): Promise<string[]> {
    const names = await readdir(join(this.dir, "bin")).catch(() => [] as string[]);
    const numbered = names
      .map((n) => /^(\d+)\.txt$/.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]));
    return Promise.all(numbered.map((m) => readFile(join(this.dir, "bin", m[0]), "utf8")));
  }

  /** Writes the Bin as `items`, renumbered from 0; returns how many item files there were before. */
  async setBinItems(items: string[]): Promise<number> {
    const folder = join(this.dir, "bin");
    await mkdir(folder, { recursive: true });
    const before = (await readdir(folder)).filter((n) => /^\d+\.txt$/.test(n));
    for (const [i, text] of items.entries()) await writeAtomic(this.binPath(i), text);
    for (const n of before) if (Number(n.slice(0, -4)) >= items.length) await rm(join(folder, n), { force: true });
    return before.length;
  }

  async scratchpad(): Promise<string | undefined> {
    return readFile(this.scratchpadPath, "utf8").catch(() => undefined);
  }

  async ensureScratchpad(): Promise<string> {
    if (!existsSync(this.scratchpadPath)) {
      await mkdir(this.dir, { recursive: true });
      await writeFile(this.scratchpadPath, "");
    }
    return this.scratchpadPath;
  }

  /** The print template (from info.json, as a .highland file keeps it) and the images folder's name (local). */
  async settings(): Promise<ExtrasSettings> {
    const out: ExtrasSettings = {};
    const info = await readJson(join(this.dir, "document", "info.json"));
    const template = (info?.[HIGHLAND_KEY] as { templateName?: unknown } | undefined)?.templateName;
    if (typeof template === "string" && template) out.templateName = template;
    const print = (info?.[HIGHLAND_KEY] as { printOptions?: unknown } | undefined)?.printOptions;
    if (print && typeof print === "object") out.printOptions = print as Record<string, boolean>;
    const local = await readJson(join(this.dir, "local.json"));
    if (typeof local?.assetsFolder === "string" && local.assetsFolder) out.assetsFolder = local.assetsFolder;
    return out;
  }

  async updateSettings(change: { templateName?: string | undefined; assetsFolder?: string | undefined; printOptions?: Record<string, boolean> }): Promise<ExtrasSettings> {
    await mkdir(this.dir, { recursive: true });
    if ("templateName" in change || "printOptions" in change) {
      const path = join(this.dir, "document", "info.json");
      const info = (await readJson(path)) ?? {};
      const block = { ...((info[HIGHLAND_KEY] as Record<string, unknown> | undefined) ?? {}) };
      if ("templateName" in change) {
        if (change.templateName === undefined) delete block.templateName;
        else block.templateName = change.templateName;
      }
      if (change.printOptions) block.printOptions = { ...((block.printOptions as object | undefined) ?? {}), ...change.printOptions };
      info[HIGHLAND_KEY] = block;
      await mkdir(dirname(path), { recursive: true });
      await writeAtomic(path, JSON.stringify(info));
    }
    if ("assetsFolder" in change) {
      const path = join(this.dir, "local.json");
      const local = (await readJson(path)) ?? {};
      if (change.assetsFolder === undefined) delete local.assetsFolder;
      else local.assetsFolder = change.assetsFolder;
      await writeAtomic(path, `${JSON.stringify(local, null, 2)}\n`);
    }
    return this.settings();
  }

  /** The rest of the .highland file it was converted from (none for a file that never was one). */
  async document(): Promise<{ path: string; data: Uint8Array }[]> {
    const root = join(this.dir, "document");
    const out: { path: string; data: Uint8Array }[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) out.push({ path: relative(root, p).split(sep).join("/"), data: new Uint8Array(await readFile(p)) });
      }
    };
    await walk(root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async setDocument(files: { path: string; data: Uint8Array }[]): Promise<void> {
    const root = join(this.dir, "document");
    await rm(root, { recursive: true, force: true });
    for (const f of files) {
      if (f.path.split("/").some((part) => part === ".." || part === "")) continue;
      const p = join(root, ...f.path.split("/"));
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, f.data);
    }
  }

  /** What the history records. */
  async files(): Promise<ExtrasFiles> {
    const out: ExtrasFiles = { bin: await this.binItems() };
    const scratchpad = await this.scratchpad();
    if (scratchpad !== undefined) out.scratchpad = scratchpad;
    const document = await this.document();
    if (document.length) out.document = document;
    return out;
  }

  /** Replaces everything with `files` (a save brought in from the history). */
  async replace(files: ExtrasFiles): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.setBinItems(files.bin);
    if (files.scratchpad !== undefined) await writeAtomic(this.scratchpadPath, files.scratchpad);
    else await rm(this.scratchpadPath, { force: true });
    await this.setDocument(files.document ?? []);
  }

  /** The save these extras last matched (made here, or brought in from another computer). */
  async base(): Promise<string | null> {
    return (await readFile(join(this.dir, ".base"), "utf8").catch(() => "")).trim() || null;
  }

  async setBase(hash: string): Promise<void> {
    if (!this.exists) return;
    await writeFile(join(this.dir, ".base"), `${hash}\n`);
  }

  /** Moves the folder (from the stand-in place used while the writing history was off). */
  async moveTo(dir: string): Promise<ExtrasFolder> {
    await mkdir(join(dir, ".."), { recursive: true });
    await rename(this.dir, dir);
    return new ExtrasFolder(dir);
  }

  async remove(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

/** True when two sets of extras hold the same Bin, Scratchpad and the rest of the file. */
export function sameExtras(a: ExtrasFiles, b: ExtrasFiles): boolean {
  return (
    a.bin.length === b.bin.length &&
    a.bin.every((t, i) => t === b.bin[i]) &&
    (a.scratchpad ?? "") === (b.scratchpad ?? "") &&
    sameFiles(a.document ?? [], b.document ?? [])
  );
}

function sameFiles(a: { path: string; data: Uint8Array }[], b: { path: string; data: Uint8Array }[]): boolean {
  if (a.length !== b.length) return false;
  const byPath = new Map(b.map((f) => [f.path, f.data]));
  return a.every((f) => {
    const other = byPath.get(f.path);
    return other !== undefined && other.length === f.data.length && other.every((x, i) => x === f.data[i]);
  });
}

/** "Script.fountain" → "Script assets". */
export function assetsFolderName(scriptPath: string): string {
  return `${basename(scriptPath, extname(scriptPath))} assets`;
}

/** Image files in a plain file's assets folder (none if it does not exist). */
export async function listAssets(folder: string): Promise<string[]> {
  const names = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return names
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/** A folder name as it appears in a Markdown image path ("My assets" → "My%20assets"). */
export function encodePathPart(name: string): string {
  return name.replace(/[ ()]/g, (c) => ({ " ": "%20", "(": "%28", ")": "%29" })[c]!);
}

/**
 * Points image references at another folder: `![a](Script%20assets/x.png)` → `![a](assets/x.png)`.
 * Only references that start with the old folder change.
 */
export function relinkAssets(text: string, from: string, to: string): string {
  if (from === to) return text;
  const forms = [...new Set([encodePathPart(from), from])].sort((a, b) => b.length - a.length);
  const prefix = forms.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(!\\[[^\\]\\n]*\\]\\(<?)(?:${prefix})/`, "g");
  return text.replace(re, (_m, open: string) => `${open}${encodePathPart(to)}/`);
}

/** The optional line tying a plain file to its writing history: a note, which never prints. */
export const ID_NOTE = /\[\[highwater:\s*([0-9A-Za-z-]{8,})\s*\]\]/;

export function idNote(id: string): string {
  return `[[highwater: ${id}]]`;
}

export function noteId(text: string): string | null {
  return ID_NOTE.exec(text)?.[1] ?? null;
}

/**
 * The text without the ID note. A note on a line of its own goes with its line, and, at the end of
 * the text, with the blank lines before it; one inside a line goes with a space beside it.
 */
export function withoutIdNote(text: string): string {
  const m = ID_NOTE.exec(text);
  if (!m) return text;
  const start = m.index;
  const end = start + m[0].length;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  const lineEnd = nl < 0 ? text.length : nl;
  if (text.slice(lineStart, start).trim() !== "" || text.slice(end, lineEnd).trim() !== "") {
    const before = text.slice(0, start);
    const after = text.slice(end);
    return before.endsWith(" ") ? before.slice(0, -1) + after : after.startsWith(" ") ? before + after.slice(1) : before + after;
  }
  const before = text.slice(0, lineStart);
  const after = nl < 0 ? "" : text.slice(nl + 1);
  if (after.trim() !== "") return before + after;
  // The note ended the text: drop the blank lines before it too, keeping the final line break.
  const trimmed = before.replace(/\s+$/, "");
  return trimmed + (text.endsWith("\n") || before.endsWith("\n") ? "\n" : "");
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The folder a text's images are in, judged from the text: the folder most image references use
 * for one of `names`. Null if none refers to them.
 */
export function detectAssetsFolder(text: string, names: string[]): string | null {
  const wanted = new Set(names);
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/!\[[^\]\n]*\]\(<?([^)>\n]+?)>?\)/g)) {
    let path = m[1]!.trim();
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep it as written
    }
    const slash = path.lastIndexOf("/");
    if (slash <= 0 || !wanted.has(path.slice(slash + 1))) continue;
    const folder = path.slice(0, slash);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [folder, n] of counts) if (best === null || n > counts.get(best)!) best = folder;
  return best;
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}
