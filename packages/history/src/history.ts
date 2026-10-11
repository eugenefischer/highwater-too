import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { git } from "./git.ts";

/**
 * The writing history (M7): one git repo per document in a central history folder, holding the
 * script text (revision tags kept), Bin items and Scratchpad. An index maps document IDs to repos
 * and remembers each document's paths, so a moved or renamed file finds its history again even
 * when Highland has dropped the ID from info.json.
 */

export interface DocumentFiles {
  /** File name for the script, e.g. "text.fountain" (as inside the .highland file). */
  scriptName: string;
  script: string;
  bin?: string[];
  scratchpad?: string;
}

export interface IndexEntry {
  /** Repo folder name inside the history folder. */
  repo: string;
  /** Every path the document has been saved at, most recent last. */
  paths: string[];
}

interface Index {
  version: 1;
  documents: Record<string, IndexEntry>;
}

export type SaveKind = "save" | "autosave" | "close";

export interface CommitInfo {
  hash: string;
  date: Date;
  message: string;
}

/** Below this similarity a document with no ID and an unknown path starts a new history. */
export const MATCH_THRESHOLD = 0.6;

export class History {
  #index: Index | null = null;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(readonly folder: string) {}

  /**
   * Finds the document's history: by ID, then by path, then by text similarity to each repo's
   * latest script. Creates a new one if nothing matches. Returns the ID to store in the document.
   */
  resolve(doc: { id: string | null; path: string; text: string }): Promise<{ id: string; repo: string; created: boolean }> {
    return this.#serial(async () => {
      const index = await this.#load();
      let id = doc.id && index.documents[doc.id] ? doc.id : null;
      id ??= Object.entries(index.documents).find(([, e]) => e.paths.at(-1) === doc.path)?.[0] ?? null;
      id ??= Object.entries(index.documents).find(([, e]) => e.paths.includes(doc.path))?.[0] ?? null;
      if (!id) id = await this.#bestMatch(index, doc.text);
      let created = false;
      if (!id) {
        id = doc.id ?? randomUUID();
        index.documents[id] = { repo: await this.#repoName(index, doc.path), paths: [] };
        created = true;
      }
      const entry = index.documents[id]!;
      if (entry.paths.at(-1) !== doc.path) entry.paths = [...entry.paths.filter((p) => p !== doc.path), doc.path];
      await this.#save(index);
      const repo = join(this.folder, entry.repo);
      if (!existsSync(join(repo, ".git"))) await initRepo(repo);
      return { id, repo, created };
    });
  }

  /** Writes the document's files into its repo and commits them; returns null when nothing changed. */
  commit(repo: string, files: DocumentFiles, kind: SaveKind, date = new Date()): Promise<CommitInfo | null> {
    return this.#serial(async () => {
      const before = await readFile(join(repo, files.scriptName), "utf8").catch(() => "");
      await writeFiles(repo, files);
      await git(repo, ["add", "-A"]);
      const status = await git(repo, ["status", "--porcelain"]);
      if (!status.trim()) return null;
      const message = commitMessage(kind, date, before, files.script);
      const stamp = date.toISOString();
      await git(repo, ["-c", "core.quotepath=false", "commit", "-q", "-m", message, "--date", stamp]);
      const hash = (await git(repo, ["rev-parse", "HEAD"])).trim();
      return { hash, date, message };
    });
  }

  /** The repo's commits, newest first. */
  async log(repo: string, limit = 200): Promise<CommitInfo[]> {
    if (!existsSync(join(repo, ".git"))) return [];
    const out = await git(repo, ["log", `-${limit}`, "--format=%H%x00%aI%x00%s"]).catch(() => "");
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, date, message] = l.split("\0");
        return { hash: hash!, date: new Date(date!), message: message! };
      });
  }

  /** A file as it was at a commit. */
  show(repo: string, hash: string, file: string): Promise<string> {
    return git(repo, ["show", `${hash}:${file}`]);
  }

  async #bestMatch(index: Index, text: string): Promise<string | null> {
    let best: { id: string; score: number } | null = null;
    for (const [id, e] of Object.entries(index.documents)) {
      const repo = join(this.folder, e.repo);
      const names = await readdir(repo).catch(() => [] as string[]);
      const script = names.find((n) => /^text\.[^/]+$/.test(n));
      if (!script) continue;
      const score = similarity(text, await readFile(join(repo, script), "utf8"));
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { id, score };
    }
    return best?.id ?? null;
  }

  async #repoName(index: Index, path: string): Promise<string> {
    const stem = basename(path).replace(/\.(highland|fountain|spmd|md|markdown|txt)$/i, "").replace(/[^\p{L}\p{N} ._-]+/gu, "_").trim() || "Untitled";
    const taken = new Set(Object.values(index.documents).map((e) => e.repo));
    let name = stem;
    for (let n = 2; taken.has(name) || existsSync(join(this.folder, name)); n++) name = `${stem} ${n}`;
    return name;
  }

  async #load(): Promise<Index> {
    if (this.#index) return this.#index;
    try {
      const data = JSON.parse(await readFile(join(this.folder, "index.json"), "utf8")) as Index;
      this.#index = data.version === 1 && data.documents ? data : { version: 1, documents: {} };
    } catch {
      this.#index = { version: 1, documents: {} };
    }
    return this.#index;
  }

  async #save(index: Index): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const tmp = join(this.folder, `.index.json.${process.pid}.tmp`);
    await writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`);
    await rename(tmp, join(this.folder, "index.json"));
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => {});
    return next;
  }
}

async function initRepo(repo: string): Promise<void> {
  await mkdir(repo, { recursive: true });
  await git(repo, ["init", "-q"]);
  await git(repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  // Commits need an author: use the user's git identity, or a local one if none is set.
  const email = (await git(repo, ["config", "user.email"]).catch(() => "")).trim();
  if (!email) {
    const user = process.env.USER || process.env.USERNAME || "writer";
    await git(repo, ["config", "user.name", user]);
    await git(repo, ["config", "user.email", `${user}@localhost`]);
  }
  await writeFile(join(repo, "README.md"), "Writing history kept by Highwater Too: the script text, Bin items and Scratchpad, committed on each save.\n");
}

async function writeFiles(repo: string, files: DocumentFiles): Promise<void> {
  // One script file: remove others (the document may have changed mode).
  for (const n of await readdir(repo)) if (/^text\.[^/]+$/.test(n) && n !== files.scriptName) await rm(join(repo, n));
  await writeFile(join(repo, files.scriptName), files.script);
  const binDir = join(repo, "bin");
  await rm(binDir, { recursive: true, force: true });
  if (files.bin?.length) {
    await mkdir(binDir, { recursive: true });
    await Promise.all(files.bin.map((t, i) => writeFile(join(binDir, `${i}.txt`), t)));
  }
  const pad = join(repo, "scratchpad.txt");
  if (files.scratchpad !== undefined && files.scratchpad !== "") await writeFile(pad, files.scratchpad);
  else await rm(pad, { force: true });
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** "Save 2026-10-11 14:03, +120 words (4,567)" */
export function commitMessage(kind: SaveKind, date: Date, before: string, after: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const words = wordCount(after);
  const delta = words - wordCount(before);
  const label = kind === "save" ? "Save" : kind === "autosave" ? "Autosave" : "Close";
  return `${label} ${when}, ${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en-US")} words (${words.toLocaleString("en-US")})`;
}

/** Share of distinct lines in common (Dice coefficient over non-empty trimmed lines). */
export function similarity(a: string, b: string): number {
  const lines = (t: string) => new Set(t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const x = lines(a);
  const y = lines(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const l of x) if (y.has(l)) common++;
  return (2 * common) / (x.size + y.size);
}
