import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

/**
 * A plain .fountain or .md file's extras — Bin, Scratchpad and settings — which a .highland file
 * keeps inside itself. A plain file has nowhere to keep them, so they live in a folder of their
 * own in the writing history folder (`<history>/extras/<document ID>/`), laid out as inside a
 * .highland file: `bin/0.txt`…, `scratchpad.txt`, plus `settings.json`. Each save commits them
 * with the text. No VS Code dependency, so it is unit-tested on real folders.
 *
 * Images are different: the text refers to them by path, so they go in a visible folder next to
 * the file (`<name> assets/`), made only when the first one is added.
 */
export interface ExtrasSettings {
  /** The print template chosen in the preview, as a .highland file's templateName. */
  templateName?: string;
  /** The images folder next to the file, by name (kept, so renaming the file does not lose it). */
  assetsFolder?: string;
  [key: string]: unknown;
}

export interface ExtrasFiles {
  bin: string[];
  scratchpad?: string;
  settings?: ExtrasSettings;
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

  async settings(): Promise<ExtrasSettings> {
    try {
      const data = JSON.parse(await readFile(join(this.dir, "settings.json"), "utf8")) as unknown;
      return data && typeof data === "object" && !Array.isArray(data) ? (data as ExtrasSettings) : {};
    } catch {
      return {};
    }
  }

  async updateSettings(change: Partial<ExtrasSettings>): Promise<ExtrasSettings> {
    const next = { ...(await this.settings()), ...change };
    for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
    await mkdir(this.dir, { recursive: true });
    await writeAtomic(join(this.dir, "settings.json"), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  /** What the history records. */
  async files(): Promise<ExtrasFiles> {
    const out: ExtrasFiles = { bin: await this.binItems() };
    const scratchpad = await this.scratchpad();
    if (scratchpad !== undefined) out.scratchpad = scratchpad;
    const settings = await this.settings();
    if (Object.keys(settings).length) out.settings = settings;
    return out;
  }

  /** Replaces everything with `files` (a save brought in from the history). */
  async replace(files: ExtrasFiles): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.setBinItems(files.bin);
    if (files.scratchpad !== undefined) await writeAtomic(this.scratchpadPath, files.scratchpad);
    else await rm(this.scratchpadPath, { force: true });
    if (files.settings && Object.keys(files.settings).length) await writeAtomic(join(this.dir, "settings.json"), `${JSON.stringify(files.settings, null, 2)}\n`);
    else await rm(join(this.dir, "settings.json"), { force: true });
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

/** True when two sets of extras hold the same Bin, Scratchpad and settings. */
export function sameExtras(a: ExtrasFiles, b: ExtrasFiles): boolean {
  return (
    a.bin.length === b.bin.length &&
    a.bin.every((t, i) => t === b.bin[i]) &&
    (a.scratchpad ?? "") === (b.scratchpad ?? "") &&
    JSON.stringify(sortKeys(a.settings ?? {})) === JSON.stringify(sortKeys(b.settings ?? {}))
  );
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
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

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}
