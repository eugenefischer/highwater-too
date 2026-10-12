import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git, gitBytes } from "./git.ts";

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
  /**
   * The rest of a .highland file (info.json, assets, characters.json, …), by path inside it, so a
   * document can be rebuilt whole from its history. Stored under "document/".
   */
  others?: { path: string; data: Uint8Array }[];
  /**
   * A plain .fountain or .md file's own settings (print template, assets folder), which a .highland
   * file keeps in info.json. Stored as "settings.json".
   */
  settings?: Record<string, unknown>;
}

/** A work in the history: indexed on this computer, or pulled from another one. */
export interface WorkInfo {
  /** The document ID: from the index, or named by the branch's latest commit; null if unknown. */
  id: string | null;
  branch: string;
  title: string;
  /** Its latest save. */
  latest: CommitInfo | null;
  /** Paths it was saved at on this computer (none for works only pulled). */
  paths: string[];
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
  /**
   * Paths that belong to no history: files a document was converted from (a plain file that became
   * a .highland file, or back), and exports. Saved, they start a new history instead of joining one.
   */
  retired?: string[];
}

/** "convert": the document became another kind of file (a plain file a .highland file, or back). */
export type SaveKind = "save" | "autosave" | "close" | "convert";

export interface CommitInfo {
  hash: string;
  date: Date;
  message: string;
}

/** Below this similarity a document with no ID and an unknown path starts a new history. */
export const MATCH_THRESHOLD = 0.6;

/** The repository's folder name inside the history folder. */
export const REPO_NAME = "history.git";

/** main's README.md: what this repository is and how to use it, with a list of its works. */
export function readme(works: { title: string; branch: string }[]): string {
  const list = works.length
    ? works
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((w) => `| ${w.title.replace(/\|/g, "\\|")} | \`${w.branch}\` |`)
        .join("\n")
    : "| (none yet) | |";
  return `# Writing history

This repository is a writing history kept by Highwater Too, a
VS Code extension for screenplays and manuscripts. Every time a document is saved, Highwater Too records it here as
a git commit, so the history shows how each work was written, save by save. Nothing is ever deleted or rewritten:
commits are only added.

## Where the works are

This \`main\` branch holds only this README. **Each work has its own branch** under \`works/\`, named after the file it
was first saved as, followed by part of the work's ID (the name never changes, even if the file is renamed). To see a
work, switch to its branch (in a web interface, use the branch menu).

| Work | Branch |
|---|---|
${list}

The branches share no history with each other, so one work can be shared, archived or deleted without touching the
others.

## What each commit holds

One commit is one save. Its message says when, and how the word count changed, e.g.
\`Save 2026-10-11 14:03, +120 words (4,567)\` (\`Autosave\` and \`Close\` mark automatic saves; \`Convert\` marks a work changing between a \`.highland\` file and a plain
\`.fountain\` or \`.md\` file, e.g. \`Convert 2026-10-12 09:30, to Script.fountain, +0 words (4,567)\`). Its files:

| File | Contents |
|---|---|
| \`text.fountain\`, \`text.md\` or \`text.txt\` | The script or manuscript text, exactly as saved (revision marks included) |
| \`bin/0.txt\`, \`bin/1.txt\`, … | The document's Bin items, in order |
| \`scratchpad.txt\` | The Scratchpad |
| \`document/…\` | Everything else in the \`.highland\` file: settings (\`info.json\`), images (\`assets/\`) and so on; for a plain \`.fountain\` or \`.md\` file, its images (\`assets/\`) |
| \`settings.json\` | A plain \`.fountain\` or \`.md\` file's settings, such as its print template |

Commits also carry a \`Highwater-Document:\` line naming the document's ID, which is how Highwater Too on another
computer knows which document a branch belongs to. A commit titled *Join the history saved on another computer*
joins saves made on two computers; its text is the later computer's.

## Getting a work back

- **In Highwater Too:** *Open Work from History…* (in the Writing History panel) lists every work here and writes any
  save out as a \`.highland\` or plain text file that continues the same history.
- **With git:** \`git clone <this repository's address>\`, then for example
  \`git log works/<name>\` to list a work's saves and \`git show <commit>:text.fountain > script.fountain\` to get the text
  of one save.

## Sharing one work

    git clone --single-branch --branch works/<name> <this repository's address>
    git bundle create work.bundle works/<name>      # one file anyone can clone

## Where this repository lives

Highwater Too keeps the working copy on each computer, in its application-data folder (on a Mac,
\`~/Library/Application Support/Highwater Too/History\`), and pushes it to this mirror after saves; other computers set
up with the same mirror pull from it. Each computer also keeps a small \`index.json\` next to its copy, recording where
each work's files are on that computer. It is not part of this repository, because those paths differ from computer to
computer.
`;
}

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
        id = doc.id && !index.documents[doc.id] && !index.retired?.includes(doc.path) ? doc.id : randomUUID();
        const title = fileTitle(doc.path);
        index.documents[id] = { branch: branchName(title, id, index), title, paths: [] };
        created = true;
      }
      const entry = index.documents[id]!;
      if (entry.paths.at(-1) !== doc.path) entry.paths = [...entry.paths.filter((p) => p !== doc.path), doc.path];
      if (index.retired?.includes(doc.path)) index.retired = index.retired.filter((p) => p !== doc.path);
      await this.#save(index);
      if (created) await this.#updateReadme();
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
  commit(id: string, files: DocumentFiles, kind: SaveKind, date = new Date(), note?: string): Promise<CommitInfo | null> {
    return this.#serial(async () => {
      await this.#init();
      const entry = (await this.#load()).documents[id];
      if (!entry) throw new Error(`No history for document ${id}`);
      const ref = `refs/heads/${entry.branch}`;
      const parent = await this.#revParse(ref);
      const tree = await this.#tree(files);
      if (parent && (await this.#revParse(`${parent}^{tree}`)) === tree) return null;
      const before = parent ? await this.#read(parent, files.scriptName) : "";
      const message = commitMessage(kind, date, before, files.script, note);
      // The document's ID rides along as a trailer, so another computer that pulls this branch
      // can tell which document it belongs to.
      const hash = await this.#commitTree(tree, parent, `${message}\n\n${ID_TRAILER}: ${id}`, date);
      // Compare-and-swap: fails rather than losing a commit if the branch moved meanwhile.
      await git(this.repo, ["update-ref", ref, hash, parent ?? "0".repeat(40)]);
      return { hash, date, message };
    });
  }

  /** A document's commits, newest first. */
  async log(id: string, limit = 200): Promise<CommitInfo[]> {
    const entry = existsSync(this.repo) ? (await this.#load()).documents[id] : undefined;
    if (!entry) return [];
    return this.#branchLog(entry.branch, limit);
  }

  async #branchLog(branch: string, limit: number): Promise<CommitInfo[]> {
    if (!existsSync(this.repo)) return [];
    const out = await git(this.repo, ["log", `-${limit}`, "--format=%H%x00%aI%x00%s", `refs/heads/${branch}`, "--"]).catch(() => "");
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

  /** Every work in the history, most recently saved first. */
  works(): Promise<WorkInfo[]> {
    return this.#serial(async () => {
      if (!existsSync(this.repo)) return [];
      const index = await this.#load();
      const out: WorkInfo[] = [];
      for (const [id, e] of Object.entries(index.documents)) out.push({ id, branch: e.branch, title: e.title, latest: null, paths: e.paths });
      for (const o of await this.#unindexed(index)) out.push({ id: o.id, branch: o.branch, title: branchTitle(o.branch), latest: null, paths: [] });
      for (const w of out) w.latest = (await this.#branchLog(w.branch, 1))[0] ?? null;
      return out.filter((w) => w.latest).sort((a, b) => b.latest!.date.getTime() - a.latest!.date.getTime());
    });
  }

  /** A work's saves by branch, newest first (for works not yet in the index). */
  branchLog(branch: string, limit = 200): Promise<CommitInfo[]> {
    return this.#branchLog(branch, limit);
  }

  /** Everything a save recorded: the script, Bin, Scratchpad, (from 0.1.3) the rest of the file and (from 0.1.5) a plain file's settings. */
  async filesAt(hash: string): Promise<DocumentFiles> {
    const scriptName = (await this.#scriptName(hash)) ?? "text.md";
    const listing = await git(this.repo, ["ls-tree", "-r", "-z", "--name-only", hash]);
    const names = listing.split("\0").filter(Boolean);
    const bin = names
      .map((n) => /^bin\/(\d+)\.txt$/.exec(n))
      .filter((m): m is RegExpExecArray => m !== null)
      .sort((a, b) => Number(a[1]) - Number(b[1]));
    const files: DocumentFiles = { scriptName, script: await this.#read(hash, scriptName), bin: await Promise.all(bin.map((m) => this.#read(hash, m[0]))) };
    if (names.includes("scratchpad.txt")) files.scratchpad = await this.#read(hash, "scratchpad.txt");
    if (names.includes("settings.json")) {
      try {
        const settings = JSON.parse(await this.#read(hash, "settings.json")) as unknown;
        if (settings && typeof settings === "object" && !Array.isArray(settings)) files.settings = settings as Record<string, unknown>;
      } catch {
        // unreadable settings: the rest of the save still comes back
      }
    }
    const others = names.filter((n) => n.startsWith("document/"));
    if (others.length) files.others = await Promise.all(others.map(async (n) => ({ path: n.slice("document/".length), data: await gitBytes(this.repo, ["cat-file", "blob", `${hash}:${n}`]) })));
    return files;
  }

  /**
   * Takes a work as this computer's document at `path` (after restoring it there): records the
   * path, adds a pulled work to the index, and returns the ID to store in the document.
   */
  claim(work: WorkInfo, path: string): Promise<string> {
    return this.#serial(async () => {
      const index = await this.#load();
      let id = Object.entries(index.documents).find(([, e]) => e.branch === work.branch)?.[0];
      if (!id) {
        id = work.id && !index.documents[work.id] ? work.id : randomUUID();
        index.documents[id] = { branch: work.branch, title: branchTitle(work.branch), paths: [] };
      }
      const entry = index.documents[id]!;
      entry.paths = [...entry.paths.filter((p) => p !== path), path];
      if (index.retired?.includes(path)) index.retired = index.retired.filter((p) => p !== path);
      await this.#save(index);
      return id;
    });
  }

  /**
   * The document now lives at `path` (converted to another kind of file there): records the path,
   * which also stops it being retired. Pair with `retire` for the file it was converted from.
   */
  attach(id: string, path: string): Promise<void> {
    return this.#serial(async () => {
      const index = await this.#load();
      const entry = index.documents[id];
      if (!entry) throw new Error(`No history for document ${id}`);
      entry.paths = [...entry.paths.filter((p) => p !== path), path];
      if (index.retired?.includes(path)) index.retired = index.retired.filter((p) => p !== path);
      await this.#save(index);
    });
  }

  /** True when a document's history follows the file at `path`. */
  tracks(path: string): Promise<boolean> {
    return this.#serial(async () => {
      if (!existsSync(this.repo) && !existsSync(join(this.folder, "index.json"))) return false;
      return Object.values((await this.#load()).documents).some((e) => e.paths.includes(path));
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

  /**
   * The file at `path` is not, or no longer, any document's history: a document converted to
   * another kind of file left it behind, or it is an export. If it is saved, it starts a history of
   * its own rather than joining one by its path or text.
   */
  retire(path: string): Promise<void> {
    return this.#serial(async () => {
      const index = await this.#load();
      for (const e of Object.values(index.documents)) e.paths = e.paths.filter((p) => p !== path);
      index.retired = [...(index.retired ?? []).filter((p) => p !== path), path];
      await this.#save(index);
    });
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
    if (index.retired?.includes(doc.path)) return null;
    if (doc.id && index.documents[doc.id]) return doc.id;
    const entries = Object.entries(index.documents);
    const byPath = entries.find(([, e]) => e.paths.at(-1) === doc.path) ?? entries.find(([, e]) => e.paths.includes(doc.path));
    if (byPath) return byPath[0];
    // Branches pulled from another computer, not yet in this computer's index.
    const others = await this.#unindexed(index);
    if (doc.id) {
      const short = shortId(doc.id);
      const mine = others.find((o) => o.id === doc.id) ?? others.find((o) => !o.id && branchShortId(o.branch) === short);
      if (mine) return adopt(index, doc.id, mine.branch);
    }
    let best: { id: string | null; branch: string | null; score: number } | null = null;
    for (const [id, e] of entries) {
      const head = await this.#revParse(`refs/heads/${e.branch}`);
      if (!head) continue;
      const score = similarity(doc.text, await this.scriptAt(head));
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { id, branch: null, score };
    }
    for (const o of others) {
      const score = similarity(doc.text, await this.scriptAt(`refs/heads/${o.branch}`));
      if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { id: null, branch: o.branch, score };
    }
    if (!best) return null;
    if (best.branch === null) return best.id;
    const pulled = others.find((o) => o.branch === best.branch)!;
    return adopt(index, pulled.id ?? doc.id ?? randomUUID(), best.branch);
  }

  /** Work branches with no index entry (pulled from a mirror), with the ID their latest commit names. */
  async #unindexed(index: Index): Promise<{ branch: string; id: string | null }[]> {
    if (!existsSync(this.repo)) return [];
    const known = new Set(Object.values(index.documents).map((e) => e.branch));
    const out = await git(this.repo, ["for-each-ref", `--format=%(refname)%00%(trailers:key=${ID_TRAILER},valueonly,separator=)`, "refs/heads/works/"]).catch(() => "");
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [branch, id] = l.split("\0");
        return { branch: branch!.replace(/^refs\/heads\//, ""), id: id?.trim() || null };
      })
      .filter((o) => !known.has(o.branch));
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
      const tree = await this.#mktree([["100644", "blob", await this.#blob(readme([])), "README.md"]]);
      const hash = await this.#commitTree(tree, null, "Writing history kept by Highwater Too", new Date());
      await git(this.repo, ["update-ref", "refs/heads/main", hash, "0".repeat(40)]);
    }
    await this.#migrate();
    this.#ready = true;
    await this.#updateReadme();
  }

  /** Rewrites main's README when its text (or the list of works) changed: one commit on main. */
  async #updateReadme(): Promise<void> {
    const index = await this.#load();
    // Titles from the branch names, so every computer writes the same README for the same works.
    const works = Object.values(index.documents).map((e) => ({ title: branchTitle(e.branch), branch: e.branch }));
    for (const o of await this.#unindexed(index)) works.push({ title: branchTitle(o.branch), branch: o.branch });
    const text = readme(works);
    const parent = await this.#revParse("refs/heads/main");
    if (parent && (await this.#read(parent, "README.md")) === text) return;
    const tree = await this.#mktree([["100644", "blob", await this.#blob(text), "README.md"]]);
    const hash = await this.#commitTree(tree, parent, "Update the README", new Date());
    await git(this.repo, ["update-ref", "refs/heads/main", hash, parent ?? "0".repeat(40)]);
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
    if (files.settings && Object.keys(files.settings).length) entries.push(["100644", "blob", await this.#blob(`${JSON.stringify(files.settings, null, 2)}\n`), "settings.json"]);
    if (files.others?.length) entries.push(["040000", "tree", await this.#folder(files.others), "document"]);
    return this.#mktree(entries);
  }

  /** A tree of files by path ("assets/a.png"), with a subtree per folder. */
  async #folder(files: { path: string; data: Uint8Array }[]): Promise<string> {
    const here: [string, string, string, string][] = [];
    const folders = new Map<string, { path: string; data: Uint8Array }[]>();
    for (const f of files) {
      const slash = f.path.indexOf("/");
      if (slash < 0) here.push(["100644", "blob", await this.#blob(f.data), f.path]);
      else {
        const name = f.path.slice(0, slash);
        folders.set(name, [...(folders.get(name) ?? []), { path: f.path.slice(slash + 1), data: f.data }]);
      }
    }
    for (const [name, inner] of folders) here.push(["040000", "tree", await this.#folder(inner), name]);
    return this.#mktree(here);
  }

  async #blob(text: string | Uint8Array): Promise<string> {
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
    const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : []), ...(sign ? ["-S"] : []), "-F", "-"];
    return (await git(this.repo, args, { input: message, env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } })).trim();
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

/** The commit trailer naming the document a work branch belongs to. */
export const ID_TRAILER = "Highwater-Document";

function shortId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "doc";
}

/** The ID part of "works/<name>-<id8>" or "works/<name>-<id8>-<n>". */
function branchShortId(branch: string): string | null {
  return /-([A-Za-z0-9]{8})(?:-\d+)?$/.exec(branch)?.[1] ?? null;
}

/** "works/The-Purity-Variations-1a2b3c4d" → "The Purity Variations". */
function branchTitle(branch: string): string {
  // The last part is always the ID (and a number, when two works shared a name).
  return branch.replace(/^works\//, "").replace(/-[A-Za-z0-9]+(?:-\d+)?$/, "").replace(/-/g, " ") || "Untitled";
}

/** Puts a pulled branch in the index under `id` (in memory; resolve saves it). */
function adopt(index: Index, id: string, branch: string): string {
  index.documents[id] = { branch, title: branchTitle(branch), paths: [] };
  return id;
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
  const short = shortId(id);
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
export function commitMessage(kind: SaveKind, date: Date, before: string, after: string, note?: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const words = wordCount(after);
  const delta = words - wordCount(before);
  const label = kind === "save" ? "Save" : kind === "autosave" ? "Autosave" : kind === "convert" ? "Convert" : "Close";
  return `${label} ${when}, ${note ? `${note}, ` : ""}${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en-US")} words (${words.toLocaleString("en-US")})`;
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
