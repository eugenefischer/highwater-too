import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git.ts";

/**
 * The writing history (M7): one git repository in the history folder, with one branch per
 * document ("works/<name>-<id>"), holding the script text (revision tags kept), Bin items and
 * Scratchpad. Branches are independent (no shared ancestry), so one work's history can be shared
 * or deleted on its own without rewriting anything, while the whole history needs only one remote.
 * Commits are made with git's plumbing commands: nothing is ever checked out.
 *
 * An index (index.json, beside the repository) maps document IDs to branches and remembers each
 * document's paths, so a moved or renamed file finds its history again even when Highland has
 * dropped the ID from info.json.
 */

export interface DocumentFiles {
  /** File name for the script, e.g. "text.fountain" (as inside the .highland file). */
  scriptName: string;
  script: string;
  bin?: string[];
  scratchpad?: string;
}

export interface IndexEntry {
  /** The document's branch, e.g. "works/Astounding-1a2b3c4d". Never renamed. */
  branch: string;
  /** The file name it was first saved under (for people reading the repository). */
  title: string;
  /** Every path the document has been saved at, most recent last. */
  paths: string[];
  /** History turned off for this document. */
  paused?: boolean;
}

interface Index {
  version: 2;
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

/** The repository's folder name inside the history folder. */
export const REPO_NAME = "history.git";

const README = `# Writing history

Kept by Highwater Too. Each work has its own branch under \`works/\`, named after the file it was
first saved as; every commit is one save of the script text (revision tags kept), its Bin items
(\`bin/\`) and Scratchpad. The branches share no history, so one work can be shared without the
others:

    git push <remote> works/<name>          # just that work
    git bundle create work.bundle works/<name>

\`index.json\`, beside this repository, lists each work's branch and the paths it was saved at.
`;

export class History {
  #index: Index | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #ready = false;
  readonly repo: string;
  readonly folder: string;

  constructor(folder: string) {
    this.folder = folder;
    this.repo = join(folder, REPO_NAME);
  }

  /**
   * Finds the document's history: by ID, then by path, then by text similarity to each work's
   * latest script. Starts a new one if nothing matches. Returns the ID to store in the document.
   */
  resolve(doc: { id: string | null; path: string; text: string }): Promise<{ id: string; branch: string; created: boolean; paused: boolean }> {
    return this.#serial(async () => {
      await this.#init();
      const index = await this.#load();
      let id = await this.#match(index, doc);
      let created = false;
      if (!id) {
        id = doc.id ?? randomUUID();
        const title = fileTitle(doc.path);
        index.documents[id] = { branch: branchName(title, id, index), title, paths: [] };
        created = true;
      }
      const entry = index.documents[id]!;
      if (entry.paths.at(-1) !== doc.path) entry.paths = [...entry.paths.filter((p) => p !== doc.path), doc.path];
      await this.#save(index);
      return { id, branch: entry.branch, created, paused: entry.paused === true };
    });
  }

  /** Like `resolve`, but only looks: creates nothing and writes nothing. */
  find(doc: { id: string | null; path: string; text: string }): Promise<{ id: string; branch: string; paused: boolean } | null> {
    return this.#serial(async () => {
      if (!existsSync(this.repo)) return null;
      const index = await this.#load();
      const id = await this.#match(index, doc);
      const entry = id ? index.documents[id] : undefined;
      return id && entry ? { id, branch: entry.branch, paused: entry.paused === true } : null;
    });
  }

  /** Commits the document's files to its branch; returns null when nothing changed. */
  commit(id: string, files: DocumentFiles, kind: SaveKind, date = new Date()): Promise<CommitInfo | null> {
    return this.#serial(async () => {
      await this.#init();
      const entry = (await this.#load()).documents[id];
      if (!entry) throw new Error(`No history for document ${id}`);
      const ref = `refs/heads/${entry.branch}`;
      const parent = await this.#revParse(ref);
      const tree = await this.#tree(files);
      if (parent && (await this.#revParse(`${parent}^{tree}`)) === tree) return null;
      const before = parent ? await this.#read(parent, files.scriptName) : "";
      const message = commitMessage(kind, date, before, files.script);
      const hash = await this.#commitTree(tree, parent, message, date);
      // Compare-and-swap: fails rather than losing a commit if the branch moved meanwhile.
      await git(this.repo, ["update-ref", ref, hash, parent ?? "0".repeat(40)]);
      return { hash, date, message };
    });
  }

  /** A document's commits, newest first. */
  async log(id: string, limit = 200): Promise<CommitInfo[]> {
    const entry = existsSync(this.repo) ? (await this.#load()).documents[id] : undefined;
    if (!entry) return [];
    const out = await git(this.repo, ["log", `-${limit}`, "--format=%H%x00%aI%x00%s", `refs/heads/${entry.branch}`, "--"]).catch(() => "");
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, date, message] = l.split("\0");
        return { hash: hash!, date: new Date(date!), message: message! };
      });
  }

  /** The script as it was at a commit (whichever text.* file it held). */
  async scriptAt(hash: string): Promise<string> {
    const name = await this.#scriptName(hash);
    return name ? this.#read(hash, name) : "";
  }

  /** A file as it was at a commit. */
  show(hash: string, file: string): Promise<string> {
    return git(this.repo, ["show", `${hash}:${file}`]);
  }

  /** Runs `work` after everything queued so far, and before anything queued later. */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.#serial(async () => {
      await this.#init();
      return work();
    });
  }

  /** Writes one work's history (its branch) to a git bundle file anyone can clone. */
  bundle(id: string, file: string): Promise<void> {
    return this.#serial(async () => {
      const entry = (await this.#load()).documents[id];
      if (!entry) throw new Error("This document has no history yet.");
      await git(this.repo, ["bundle", "create", "-q", file, `refs/heads/${entry.branch}`]);
    });
  }

  /** Resolves when the work queued so far (resolves, commits) is done. */
  idle(): Promise<void> {
    return this.#serial(async () => {});
  }

  /** Turns history off (or back on) for one document. */
  setPaused(id: string, paused: boolean): Promise<void> {
    return this.#serial(async () => {
      const index = await this.#load();
      const entry = index.documents[id];
      if (!entry) return;
      if (paused) entry.paused = true;
      else delete entry.paused;
      await this.#save(index);
    });
  }

  // ---------------------------------------------------------------------------------------------

  async #match(index: Index, doc: { id: string | null; path: string; text: string }): Promise<string | null> {
    if (doc.id && index.documents[doc.id]) return doc.id;
    const entries = Object.entries(index.documents);
    const byPath = entries.find(([, e]) => e.paths.at(-1) === doc.path) ?? entries.find(([, e]) => e.paths.includes(doc.path));
    if (byPath) return byPath[0];
    let best: { id: string; score: number } | null = null;
    for (const [id, e] of entries) {
      const head = await this.#revParse(`refs/heads/${e.branch}`);
      if (!head) continue;
      const score = similarity(doc.text, await this.scriptAt(head));
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { id, score };
    }
    return best?.id ?? null;
  }

  /** Creates the repository (with a README on main) and moves any per-document repos into it. */
  async #init(): Promise<void> {
    if (this.#ready) return;
    if (!existsSync(join(this.repo, "HEAD"))) {
      await mkdir(this.repo, { recursive: true });
      await git(this.repo, ["init", "-q", "--bare"]);
      await git(this.repo, ["symbolic-ref", "HEAD", "refs/heads/main"]);
      const email = (await git(this.repo, ["config", "user.email"]).catch(() => "")).trim();
      if (!email) {
        // Commits need an author: the user's git identity, or a local one if none is set.
        const user = process.env.USER || process.env.USERNAME || "writer";
        await git(this.repo, ["config", "user.name", user]);
        await git(this.repo, ["config", "user.email", `${user}@localhost`]);
      }
      const tree = await this.#mktree([["100644", "blob", await this.#blob(README), "README.md"]]);
      const hash = await this.#commitTree(tree, null, "Writing history kept by Highwater Too", new Date());
      await git(this.repo, ["update-ref", "refs/heads/main", hash, "0".repeat(40)]);
    }
    await this.#migrate();
    this.#ready = true;
  }

  /** 0.0.15–0.0.16 kept one repository per document: bring each in as a branch, commits unchanged. */
  async #migrate(): Promise<void> {
    let raw: { version?: number; documents?: Record<string, { repo?: string; paths?: string[]; paused?: boolean }> };
    try {
      raw = JSON.parse(await readFile(join(this.folder, "index.json"), "utf8"));
    } catch {
      return;
    }
    if (raw.version !== 1 || !raw.documents) return;
    const index: Index = { version: 2, documents: {} };
    for (const [id, old] of Object.entries(raw.documents)) {
      const title = old.repo ?? fileTitle(old.paths?.at(-1) ?? "Untitled");
      const branch = branchName(title, id, index);
      const dir = old.repo ? join(this.folder, old.repo) : null;
      if (dir && existsSync(join(dir, ".git"))) {
        const head = (await git(dir, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => "")).trim();
        if (head) await git(this.repo, ["fetch", "-q", dir, `+${head}:refs/heads/${branch}`]);
      }
      index.documents[id] = { branch, title, paths: old.paths ?? [], ...(old.paused ? { paused: true } : {}) };
    }
    await this.#save(index);
    this.#index = index;
    // The old repositories are now branches; keep them aside rather than delete.
    const aside = join(this.folder, "old-repositories");
    for (const old of Object.values(raw.documents)) {
      if (!old.repo || !existsSync(join(this.folder, old.repo))) continue;
      await mkdir(aside, { recursive: true });
      await rename(join(this.folder, old.repo), join(aside, old.repo));
    }
  }

  async #tree(files: DocumentFiles): Promise<string> {
    const entries: [string, string, string, string][] = [["100644", "blob", await this.#blob(files.script), files.scriptName]];
    if (files.bin?.length) {
      const items = await Promise.all(files.bin.map(async (t, i): Promise<[string, string, string, string]> => ["100644", "blob", await this.#blob(t), `${i}.txt`]));
      entries.push(["040000", "tree", await this.#mktree(items), "bin"]);
    }
    if (files.scratchpad) entries.push(["100644", "blob", await this.#blob(files.scratchpad), "scratchpad.txt"]);
    return this.#mktree(entries);
  }

  async #blob(text: string): Promise<string> {
    return (await git(this.repo, ["hash-object", "-w", "--stdin"], { input: text })).trim();
  }

  async #mktree(entries: [string, string, string, string][]): Promise<string> {
    const sorted = entries.slice().sort((a, b) => (a[3] < b[3] ? -1 : 1));
    return (await git(this.repo, ["mktree"], { input: sorted.map(([mode, type, hash, name]) => `${mode} ${type} ${hash}\t${name}\n`).join("") })).trim();
  }

  async #commitTree(tree: string, parent: string | null, message: string, date: Date): Promise<string> {
    const stamp = date.toISOString();
    // commit-tree ignores commit.gpgSign (it is plumbing): honour the user's choice ourselves.
    const sign = (await git(this.repo, ["config", "--bool", "commit.gpgsign"]).catch(() => "")).trim() === "true";
    const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : []), ...(sign ? ["-S"] : []), "-m", message];
    return (await git(this.repo, args, { env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } })).trim();
  }

  async #revParse(rev: string): Promise<string | null> {
    const out = await git(this.repo, ["rev-parse", "--verify", "-q", rev]).catch(() => "");
    return out.trim() || null;
  }

  async #scriptName(rev: string): Promise<string | null> {
    const names = await git(this.repo, ["ls-tree", "--name-only", rev]).catch(() => "");
    return names.split("\n").find((n) => /^text\.[^/]+$/.test(n)) ?? null;
  }

  async #read(rev: string, file: string): Promise<string> {
    return git(this.repo, ["show", `${rev}:${file}`]).catch(() => "");
  }

  async #load(): Promise<Index> {
    if (this.#index) return this.#index;
    try {
      const data = JSON.parse(await readFile(join(this.folder, "index.json"), "utf8")) as Index;
      this.#index = data.version === 2 && data.documents ? data : { version: 2, documents: {} };
    } catch {
      this.#index = { version: 2, documents: {} };
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

function fileTitle(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  return name.replace(/\.(highland|fountain|spmd|md|markdown|txt)$/i, "") || "Untitled";
}

/** "works/<name>-<first 8 of the ID>": readable, unique, and never renamed afterwards. */
function branchName(title: string, id: string, index: Index): string {
  const slug =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "untitled";
  const short = id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "doc";
  const taken = new Set(Object.values(index.documents).map((e) => e.branch));
  let name = `works/${slug}-${short}`;
  for (let n = 2; taken.has(name); n++) name = `works/${slug}-${short}-${n}`;
  return name;
}

/**
 * Moves a history folder (repository, index and backups) to `to`, which must be empty or missing:
 * copies everything, then removes the original. Nothing is removed if the copy fails.
 */
export async function moveHistory(from: string, to: string): Promise<void> {
  if (existsSync(to) && (await readdir(to)).length > 0) throw new Error(`${to} is not empty`);
  if (!existsSync(from)) {
    await mkdir(to, { recursive: true });
    return;
  }
  await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  await rm(from, { recursive: true, force: true });
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
