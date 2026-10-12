import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { git, gitBytes } from "./git.ts";
import { addDeletion, addSave, mergeMain, readCatalog, type CatalogEntry, type MainFiles } from "./catalog.ts";

/**
 * The writing history (M7): one git repository in the history folder, with one branch per
 * document ("works/<name>-<id>"). Each commit holds exactly what is inside the .highland file,
 * unpacked: the text (revision tags kept), Bin items, Scratchpad and the rest (info.json, images, …);
 * a plain file's commit holds the same, with only what it has. Branches are independent (no shared ancestry), so one work's history can be shared
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
   * The rest of the .highland file (info.json, assets/…, characters.json, …), by path inside it,
   * stored at those same paths, so a commit's files are the .highland file unpacked. A plain file
   * has an info.json only for its settings, and its images under assets/.
   */
  others?: { path: string; data: Uint8Array }[];
}

/** What a work is kept as: a .highland file, or a plain file of one of these kinds. */
export type Form = "highland" | "fountain" | "md" | "txt";

/** The kind of file and its name, recorded with every save. */
export interface SaveMeta {
  form: Form;
  /** The file's name (not its path, which differs from computer to computer). */
  file: string;
}

/** A work in the history: indexed on this computer, or pulled from another one. */
export interface WorkInfo {
  /** The document ID: from the index or the catalog; null if unknown. */
  id: string | null;
  branch: string;
  title: string;
  /** Its latest save, when its history is on this computer. */
  latest: CommitInfo | null;
  /** From the catalog: when it was last saved, and as what. */
  lastSave: Date | null;
  form: Form | null;
  file: string | null;
  /** Its history is on this computer (else only in the catalog: on the mirror). */
  local: boolean;
  /** Paths it was saved at on this computer (none for works not used here). */
  paths: string[];
}

/** How a file not tracked on this computer relates to a work in the catalog. */
export interface Recognition {
  entry: CatalogEntry;
  /** What found it: its ID, its text's hash, or (a guess) its file name. */
  by: "id" | "hash" | "name";
  /** Its text is the latest save, an older one, edited since a known save (.highland), or none. */
  match: "latest" | "older" | "edited" | "none";
  /** The save it matches or was last saved from (older, edited). */
  text: string | null;
  /** The work's history is already on this computer. */
  local: boolean;
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
  /** IDs of works whose history was deleted: a file still naming one starts a new history. */
  deleted?: string[];
  /** Branches deleted here only: never fetched back or offered for this computer's files. */
  excluded?: string[];
  /** Pairs ("a|b", branches) the writer chose not to join. */
  notJoined?: string[];
}

/** A local work whose history started from a save of another work (a copy worked on offline). */
export interface CopyCandidate {
  /** This computer's work. */
  id: string;
  branch: string;
  /** The work it was copied from. */
  other: CatalogEntry;
}

/**
 * "convert": the work moved to another kind of file; "revert": an older save was brought back;
 * "restore": the work was written out on a computer that did not have it. These three are recorded
 * even when no file changed.
 */
export type SaveKind = "save" | "autosave" | "close" | "convert" | "revert" | "restore";

const ALWAYS_RECORDED: SaveKind[] = ["convert", "revert", "restore"];

export interface CommitInfo {
  hash: string;
  date: Date;
  message: string;
  /** From the commit's Highwater-Form and Highwater-File lines (absent on older commits). */
  form?: Form;
  file?: string;
}

/** This computer's saves not yet in the catalog on main. */
const PENDING = "catalog-pending.json";

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
\`Save 2026-10-11 14:03, +120 words (4,567)\`. \`Autosave\` and \`Close\` mark automatic saves; \`Convert\` marks a work
moving between a \`.highland\` file and a plain \`.fountain\`, \`.md\` or \`.txt\` file; \`Revert\` marks an older save
brought back; \`Restore\` marks the work written out on a computer that did not have it.

A commit's files are exactly what is inside the \`.highland\` file, unpacked (zipped, they are that file):

| File | Contents |
|---|---|
| \`text.fountain\`, \`text.md\` or \`text.txt\` | The script or manuscript text, exactly as saved (revision marks included) |
| \`bin/0.txt\`, \`bin/1.txt\`, … | The document's Bin items, in order |
| \`scratchpad.txt\` | The Scratchpad |
| \`info.json\` | Settings, such as the print template |
| \`assets/…\` | Images |
| \`characters.json\`, \`navigatorFilters.json\`, … | The rest of the file, as Highland 2 writes it |

A work kept as a plain \`.fountain\`, \`.md\` or \`.txt\` file has the same files, as far as it has them: its Bin and
Scratchpad (kept by Highwater Too, not in the file), an \`info.json\` for its settings, and its images from the folder
beside it.

Each commit message ends with lines naming the work's ID (\`Highwater-Document:\`), the kind of file it was kept in
(\`Highwater-Form:\` \`highland\`, \`fountain\`, \`md\` or \`txt\`) and the file's name (\`Highwater-File:\`). They are how
Highwater Too on another computer knows which document a branch belongs to. A commit titled *Join the history saved on another computer*
joins saves made on two computers; its text is the later computer's.

## Getting a work back

- **In Highwater Too:** *Open Work from History…* (in the Writing History panel) lists every work here and, on a
  computer that does not have it, writes its latest save out as it was kept (a \`.highland\` or plain file), continuing
  the same history.
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
   * Finds the document's history on this computer: by ID, then by path. Starts a new one if nothing
   * matches (a file another computer's history may know is recognised first, with recognise). Returns the ID to store in the document.
   */
  resolve(doc: { id: string | null; path: string; text: string }): Promise<{ id: string; branch: string; created: boolean; paused: boolean }> {
    return this.#serial(async () => {
      await this.#init();
      const index = await this.#load();
      let id = await this.#match(index, doc);
      let created = false;
      if (!id) {
        id = doc.id && !index.documents[doc.id] && !index.retired?.includes(doc.path) && !index.deleted?.includes(doc.id) ? doc.id : randomUUID();
        const title = fileTitle(doc.path);
        index.documents[id] = { branch: branchName(title, id, index), title, paths: [] };
        created = true;
      }
      const entry = index.documents[id]!;
      if (entry.paths.at(-1) !== doc.path) entry.paths = [...entry.paths.filter((p) => p !== doc.path), doc.path];
      if (index.retired?.includes(doc.path)) index.retired = index.retired.filter((p) => p !== doc.path);
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
  commit(id: string, files: DocumentFiles, kind: SaveKind, date = new Date(), note?: string, meta?: SaveMeta): Promise<CommitInfo | null> {
    return this.#serial(async () => {
      await this.#init();
      const entry = (await this.#load()).documents[id];
      if (!entry) throw new Error(`No history for document ${id}`);
      const ref = `refs/heads/${entry.branch}`;
      const parent = await this.#revParse(ref);
      const tree = await this.#tree(files);
      if (parent && !ALWAYS_RECORDED.includes(kind) && (await this.#revParse(`${parent}^{tree}`)) === tree) return null;
      const before = parent ? await this.#read(parent, files.scriptName) : "";
      const message = commitMessage(kind, date, before, files.script, note);
      // The document's ID, form and file name ride along as trailers, so another computer can tell
      // which document a branch belongs to and what kind of file it is kept in.
      const trailers = [`${ID_TRAILER}: ${id}`, ...(meta ? [`${FORM_TRAILER}: ${meta.form}`, `${FILE_TRAILER}: ${meta.file}`] : [])];
      const hash = await this.#commitTree(tree, parent, `${message}\n\n${trailers.join("\n")}`, date);
      // Compare-and-swap: fails rather than losing a commit if the branch moved meanwhile.
      await git(this.repo, ["update-ref", ref, hash, parent ?? "0".repeat(40)]);
      if (meta) {
        const text = textHash(files.script);
        await this.#pend({ id, branch: entry.branch, title: branchTitle(entry.branch), form: meta.form, file: meta.file, lastSave: date.toISOString(), latestText: text }, text);
      }
      return { hash, date, message, ...(meta ?? {}) };
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
    const format = `%H%x00%aI%x00%s%x00%(trailers:key=${FORM_TRAILER},valueonly,separator=)%x00%(trailers:key=${FILE_TRAILER},valueonly,separator=)%x1e`;
    const out = await git(this.repo, ["log", `-${limit}`, `--format=${format}`, `refs/heads/${branch}`, "--"]).catch(() => "");
    return out
      .split("\x1e")
      .map((l) => l.replace(/^\n/, ""))
      .filter(Boolean)
      .map((l) => {
        const [hash, date, message, form, file] = l.split("\0").map((x) => x.trim());
        const info: CommitInfo = { hash: hash!, date: new Date(date!), message: message! };
        if (form && isForm(form)) info.form = form;
        if (file) info.file = file;
        return info;
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

  /** Every work: those on this computer, and those only in the catalog; most recently saved first. */
  works(): Promise<WorkInfo[]> {
    return this.#serial(async () => {
      if (!existsSync(this.repo)) return [];
      const index = await this.#load();
      const catalog = new Map((await this.#catalog()).map((e) => [e.branch, e]));
      const out: WorkInfo[] = [];
      const seen = new Set<string>();
      const add = (id: string | null, branch: string, paths: string[]) => {
        if (seen.has(branch)) return;
        seen.add(branch);
        const c = catalog.get(branch);
        out.push({ id: id ?? c?.id ?? null, branch, title: branchTitle(branch), latest: null, lastSave: c?.lastSave ? new Date(c.lastSave) : null, form: c?.form ?? null, file: c?.file ?? null, local: false, paths });
      };
      for (const [id, e] of Object.entries(index.documents)) add(id, e.branch, e.paths);
      for (const o of await this.#unindexed(index)) add(o.id, o.branch, []);
      for (const c of catalog.values()) add(c.id, c.branch, []);
      for (const w of out) {
        w.latest = (await this.#branchLog(w.branch, 1))[0] ?? null;
        w.local = w.latest !== null;
        if (w.latest) {
          w.lastSave = w.latest.date;
          w.form = w.latest.form ?? w.form;
          w.file = w.latest.file ?? w.file;
        }
      }
      return out.filter((w) => w.lastSave).sort((a, b) => b.lastSave!.getTime() - a.lastSave!.getTime());
    });
  }

  /** The catalog: every work any computer has recorded (with this computer's saves not yet on main). */
  catalog(): Promise<CatalogEntry[]> {
    return this.#serial(() => this.#catalog());
  }

  /**
   * Which work a file not tracked on this computer belongs to, from the catalog: by its ID, then by
   * its text's hash (texts shorter than `minWords` are skipped), then by its file name. Several works
   * matching the hash or name are all returned, for the writer to choose.
   */
  recognise(doc: { id: string | null; path: string; text: string; savedText?: string | null }, minWords = 50): Promise<Recognition[]> {
    return this.#serial(async () => {
      const index = await this.#load();
      if (index.retired?.includes(doc.path)) return [];
      const excluded = new Set(index.excluded ?? []);
      const entries = (await this.#catalog()).filter((e) => !excluded.has(e.branch) && !index.deleted?.includes(e.id));
      const hash = textHash(doc.text);
      const local = new Set(Object.values(index.documents).map((e) => e.branch));
      for (const o of await this.#unindexed(index)) local.add(o.branch);
      const describe = (entry: CatalogEntry, by: Recognition["by"]): Recognition => {
        const texts = new Set(entry.texts);
        let match: Recognition["match"] = "none";
        let text: string | null = null;
        if (hash === entry.latestText) match = "latest";
        else if (texts.has(hash)) [match, text] = ["older", hash];
        else if (doc.savedText && doc.savedText === entry.latestText) match = "latest";
        else if (doc.savedText && texts.has(doc.savedText)) [match, text] = ["edited", doc.savedText];
        return { entry, by, match, text, local: local.has(entry.branch) };
      };
      if (doc.id) {
        const short = shortId(doc.id);
        const byId = entries.find((e) => e.id === doc.id) ?? entries.find((e) => branchShortId(e.branch) === short);
        if (byId) return [describe(byId, "id")];
      }
      if (wordCount(doc.text) >= minWords) {
        const byHash = entries.filter((e) => e.texts.includes(hash));
        if (byHash.length) return byHash.map((e) => describe(e, "hash"));
      }
      const name = doc.path.split(/[\\/]/).pop()!;
      return entries.filter((e) => e.file === name).map((e) => describe(e, "name"));
    });
  }

  /** The latest save whose text has this hash (for "the save of <date>"). */
  async saveWithText(branch: string, hash: string): Promise<CommitInfo | null> {
    for (const c of await this.#branchLog(branch, 10_000)) if (textHash(await this.scriptAt(c.hash)) === hash) return c;
    return null;
  }

  /** Puts this computer's recorded saves into the catalog on main, in one commit. */
  flushCatalog(): Promise<boolean> {
    return this.#serial(() => this.#flushCatalog());
  }

  /**
   * The same operations for code already running inside exclusive() (the mirror), which would
   * otherwise wait for itself.
   */
  get inside(): { flushCatalog: () => Promise<boolean>; joinMain: (rev: string) => Promise<boolean> } {
    return { flushCatalog: () => this.#flushCatalog(), joinMain: (rev) => this.#joinMain(rev) };
  }

  async #flushCatalog(): Promise<boolean> {
    {
      await this.#init();
      const pending = await this.#pending();
      const parent = await this.#revParse("refs/heads/main");
      const files = parent ? await this.#mainFiles(parent) : new Map<string, string>();
      for (const p of Object.values(pending)) for (const t of p.texts) addSave(files, p.info, t);
      files.set("README.md", readme(readCatalog(files).works.map((w) => ({ title: w.title, branch: w.branch }))));
      const changed = await this.#commitMain(files, parent ? [parent] : [], "Update the catalog");
      await rm(join(this.folder, PENDING), { force: true });
      return changed;
    }
  }

  /**
   * Brings another computer's main (fetched as `rev`) into this one: ahead or behind, it moves;
   * when both changed, the catalogs are merged by their rules in a commit with both as parents.
   * Returns true when main changed here.
   */
  joinMain(rev: string): Promise<boolean> {
    return this.#serial(() => this.#joinMain(rev));
  }

  async #joinMain(rev: string): Promise<boolean> {
    {
      await this.#init();
      const remote = (await git(this.repo, ["rev-parse", rev])).trim();
      const local = await this.#revParse("refs/heads/main");
      if (!local) {
        await git(this.repo, ["update-ref", "refs/heads/main", remote, "0".repeat(40)]);
        return true;
      }
      if (local === remote) return false;
      const base = (await git(this.repo, ["merge-base", local, remote]).catch(() => "")).trim();
      if (base === remote) return false;
      if (base === local) {
        await git(this.repo, ["update-ref", "refs/heads/main", remote, local]);
        return true;
      }
      const files = mergeMain(await this.#mainFiles(local), await this.#mainFiles(remote));
      files.set("README.md", readme(readCatalog(files).works.map((w) => ({ title: w.title, branch: w.branch }))));
      await this.#commitMain(files, [local, remote], "Join the catalog saved on another computer", true);
      return true;
    }
  }

  /** A work's saves by branch, newest first (for works not yet in the index). */
  branchLog(branch: string, limit = 200): Promise<CommitInfo[]> {
    return this.#branchLog(branch, limit);
  }

  /** Everything a save recorded: the script, Bin, Scratchpad and the rest of the file. */
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
    const others = names.filter((n) => n !== scriptName && n !== "scratchpad.txt" && !/^bin\/\d+\.txt$/.test(n));
    if (others.length) files.others = await Promise.all(others.map(async (n) => ({ path: n, data: await gitBytes(this.repo, ["cat-file", "blob", `${hash}:${n}`]) })));
    return files;
  }

  /**
   * Takes a work as this computer's document at `path` (after restoring it there): records the
   * path, adds a pulled work to the index, and returns the ID to store in the document.
   */
  claim(work: { id: string | null; branch: string }, path: string): Promise<string> {
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

  /**
   * Removes a work's history from this computer: its branch, index entry and unsent catalog notes,
   * then prunes the repository so its data is gone, not just unlisted. `exclude`: never fetch it
   * back here (a deletion made on this computer only). Returns the paths it was saved at.
   */
  remove(id: string, options: { exclude?: boolean } = {}): Promise<string[]> {
    return this.#serial(async () => {
      const paths = await this.#removeLocal(id, options.exclude === true);
      await this.#prune();
      return paths;
    });
  }

  /** Keeps a work this computer does not have from ever being fetched or offered here. */
  exclude(work: { id: string; branch: string }): Promise<void> {
    return this.#serial(async () => {
      const index = await this.#load();
      index.excluded = [...new Set([...(index.excluded ?? []), work.branch])];
      index.deleted = [...new Set([...(index.deleted ?? []), work.id])];
      await this.#save(index);
    });
  }

  /**
   * Deletes a work's history: removed here, and a deletion record added to the catalog on main,
   * so every computer that pulls removes its copy (the mirror's branch is deleted by the mirror).
   */
  deleteWork(work: { id: string; branch: string }): Promise<{ branch: string; paths: string[] }> {
    return this.#serial(async () => {
      await this.#init();
      const index = await this.#load();
      const { id, branch } = work;
      const parent = await this.#revParse("refs/heads/main");
      const files = parent ? await this.#mainFiles(parent) : new Map<string, string>();
      addDeletion(files, { id, branch, deleted: new Date().toISOString() });
      files.set("README.md", readme(readCatalog(files).works.map((w) => ({ title: w.title, branch: w.branch }))));
      await this.#commitMain(files, parent ? [parent] : [], `Delete the history of ${branchTitle(branch)}`);
      const paths = index.documents[id] ? await this.#removeLocal(id, false) : [];
      index.deleted = [...new Set([...(index.deleted ?? []), id])];
      await this.#save(index);
      await this.#prune();
      return { branch, paths };
    });
  }

  /** After main came in: removes works another computer deleted. Returns those removed here. */
  applyDeletions(): Promise<{ id: string; paths: string[] }[]> {
    return this.#serial(() => this.#applyDeletions());
  }

  async #applyDeletions(): Promise<{ id: string; paths: string[] }[]> {
    const main = await this.#revParse("refs/heads/main");
    if (!main) return [];
    const { deleted } = readCatalog(await this.#mainFiles(main));
    const index = await this.#load();
    const removed: { id: string; paths: string[] }[] = [];
    for (const d of deleted) {
      for (const [id, e] of Object.entries(index.documents)) {
        if (e.branch !== d.branch) continue;
        removed.push({ id, paths: await this.#removeLocal(id, false) });
      }
      if (await this.#revParse(`refs/heads/${d.branch}`)) {
        await git(this.repo, ["update-ref", "-d", `refs/heads/${d.branch}`]);
        if (!removed.some((r) => r.id === d.id)) removed.push({ id: d.id, paths: [] });
      }
      await git(this.repo, ["update-ref", "-d", `refs/mirror/${d.branch}`]).catch(() => "");
      await git(this.repo, ["update-ref", "-d", `refs/remotes/mirror/${d.branch}`]).catch(() => "");
      if (!index.deleted?.includes(d.id)) index.deleted = [...(index.deleted ?? []), d.id];
    }
    await this.#save(index);
    if (removed.length) await this.#prune();
    return removed;
  }

  async #removeLocal(id: string, exclude: boolean): Promise<string[]> {
    const index = await this.#load();
    const entry = index.documents[id];
    if (!entry) return [];
    await git(this.repo, ["update-ref", "-d", `refs/heads/${entry.branch}`]).catch(() => "");
    await git(this.repo, ["update-ref", "-d", `refs/mirror/${entry.branch}`]).catch(() => "");
    await git(this.repo, ["update-ref", "-d", `refs/remotes/mirror/${entry.branch}`]).catch(() => "");
    delete index.documents[id];
    if (exclude) {
      index.excluded = [...new Set([...(index.excluded ?? []), entry.branch])];
      index.deleted = [...new Set([...(index.deleted ?? []), id])];
    }
    await this.#save(index);
    const pending = await this.#pending();
    if (pending[entry.branch]) {
      delete pending[entry.branch];
      await writeFile(join(this.folder, PENDING), JSON.stringify(pending));
    }
    return entry.paths;
  }

  /** Makes removed objects really gone from this repository. */
  async #prune(): Promise<void> {
    // FETCH_HEAD would keep the last fetched work alive.
    for (const f of ["FETCH_HEAD", "ORIG_HEAD"]) await rm(join(this.repo, f), { force: true });
    await git(this.repo, ["reflog", "expire", "--expire=now", "--all"]).catch(() => "");
    await git(this.repo, ["gc", "-q", "--prune=now"]);
  }

  /**
   * Local works whose first save matches a save of another work in the catalog (proof they started
   * from a copy of it), or whose ID names another branch: candidates for joining. Pairs the writer
   * declined are left out.
   */
  copyCandidates(): Promise<CopyCandidate[]> {
    return this.#serial(async () => {
      const index = await this.#load();
      const catalog = await this.#catalog();
      const out: CopyCandidate[] = [];
      for (const [id, e] of Object.entries(index.documents)) {
        const root = (await git(this.repo, ["rev-list", "--max-parents=0", `refs/heads/${e.branch}`]).catch(() => "")).trim().split("\n").at(-1);
        if (!root) continue;
        const first = textHash(await this.scriptAt(root));
        const other = catalog.find((c) => c.branch !== e.branch && (c.id === id || c.texts.includes(first)) && !index.notJoined?.includes(pairKey(e.branch, c.branch)) && !index.excluded?.includes(c.branch));
        if (other) out.push({ id, branch: e.branch, other });
      }
      return out;
    });
  }

  /** The writer chose not to join these two. */
  notJoin(a: string, b: string): Promise<void> {
    return this.#serial(async () => {
      const index = await this.#load();
      index.notJoined = [...new Set([...(index.notJoined ?? []), pairKey(a, b)])];
      await this.#save(index);
    });
  }

  /**
   * Joins this computer's work into the one it was copied from (fetched already): a merge commit
   * on the other's branch with both histories as parents, keeping this computer's files. The local
   * branch goes (its saves are in the merge), its paths move to the other work, and a deletion
   * record tells other computers to drop the merged branch. Returns the other work's ID.
   */
  join(localId: string, other: CatalogEntry, meta: SaveMeta): Promise<string> {
    return this.#serial(async () => {
      await this.#init();
      const index = await this.#load();
      const entry = index.documents[localId];
      if (!entry) throw new Error("This work has no history on this computer.");
      const mine = await this.#revParse(`refs/heads/${entry.branch}`);
      const theirs = await this.#revParse(`refs/heads/${other.branch}`);
      if (!mine || !theirs) throw new Error("Both histories must be on this computer to join them.");
      const tree = (await git(this.repo, ["rev-parse", `${mine}^{tree}`])).trim();
      const kind = meta.form === other.form ? "Join" : "Convert";
      const message = `${kind} ${new Date().toISOString().slice(0, 16).replace("T", " ")}, the history of ${meta.file} saved on another computer\n\n${ID_TRAILER}: ${other.id}\n${FORM_TRAILER}: ${meta.form}\n${FILE_TRAILER}: ${meta.file}`;
      const stamp = new Date().toISOString();
      const merge = (await git(this.repo, ["commit-tree", tree, "-p", theirs, "-p", mine, "-m", message], { env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } })).trim();
      await git(this.repo, ["update-ref", `refs/heads/${other.branch}`, merge, theirs]);
      // The other work takes this computer's paths and saves; the copy's own branch goes.
      const target = index.documents[other.id] ?? { branch: other.branch, title: branchTitle(other.branch), paths: [] };
      target.paths = [...new Set([...target.paths, ...entry.paths])];
      index.documents[other.id] = target;
      delete index.documents[localId];
      await this.#save(index);
      const texts = new Set<string>();
      for (const c of await this.#branchLog(entry.branch, 10_000)) texts.add(textHash(await this.scriptAt(c.hash)));
      const latest = textHash(await this.scriptAt(merge));
      for (const t of [...texts, latest]) await this.#pend({ id: other.id, branch: other.branch, title: branchTitle(other.branch), form: meta.form, file: meta.file, lastSave: stamp, latestText: latest }, t);
      const parent = await this.#revParse("refs/heads/main");
      const files = parent ? await this.#mainFiles(parent) : new Map<string, string>();
      addDeletion(files, { id: localId, branch: entry.branch, deleted: stamp });
      await this.#commitMain(files, parent ? [parent] : [], `Join the history of ${branchTitle(entry.branch)} into ${branchTitle(other.branch)}`);
      await git(this.repo, ["update-ref", "-d", `refs/heads/${entry.branch}`]);
      const pending = await this.#pending();
      delete pending[entry.branch];
      await writeFile(join(this.folder, PENDING), JSON.stringify(pending));
      return other.id;
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
    // Not found: the catalog (recognise) may know it; that asks the writer first.
    return null;
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
    this.#ready = true;
  }

  /** Rewrites main's README when its text (or the list of works) changed: one commit on main. */
  async #catalog(): Promise<CatalogEntry[]> {
    if (!existsSync(this.repo)) return [];
    const main = await this.#revParse("refs/heads/main");
    const files = main ? await this.#mainFiles(main) : new Map<string, string>();
    for (const p of Object.values(await this.#pending())) for (const t of p.texts) addSave(files, p.info, t);
    return readCatalog(files).works;
  }

  async #pending(): Promise<Record<string, { info: Omit<CatalogEntry, "texts">; texts: string[] }>> {
    try {
      return JSON.parse(await readFile(join(this.folder, PENDING), "utf8"));
    } catch {
      return {};
    }
  }

  /** Notes a save for the catalog; flushCatalog puts it on main. */
  async #pend(info: Omit<CatalogEntry, "texts">, text: string): Promise<void> {
    const pending = await this.#pending();
    const old = pending[info.branch];
    pending[info.branch] = { info, texts: [...new Set([...(old?.texts ?? []), text])] };
    await writeFile(join(this.folder, PENDING), JSON.stringify(pending));
  }

  async #mainFiles(rev: string): Promise<MainFiles> {
    const names = (await git(this.repo, ["ls-tree", "-r", "-z", "--name-only", rev])).split("\0").filter(Boolean);
    const files: MainFiles = new Map();
    for (const n of names) files.set(n, await this.#read(rev, n));
    return files;
  }

  /** Commits main's files; false when nothing changed (and it was not a merge). */
  async #commitMain(files: MainFiles, parents: string[], message: string, always = false): Promise<boolean> {
    const tree = await this.#folder([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => ({ path, data })));
    const parent = parents[0] ?? null;
    if (!always && parent && (await this.#revParse(`${parent}^{tree}`)) === tree) return false;
    const args = ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", message];
    const stamp = new Date().toISOString();
    const hash = (await git(this.repo, args, { env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } })).trim();
    await git(this.repo, ["update-ref", "refs/heads/main", hash, parent ?? "0".repeat(40)]);
    return true;
  }

  /** 0.0.15–0.0.16 kept one repository per document: bring each in as a branch, commits unchanged. */
  async #tree(files: DocumentFiles): Promise<string> {
    const all: { path: string; data: Uint8Array | string }[] = [{ path: files.scriptName, data: files.script }];
    for (const [i, t] of (files.bin ?? []).entries()) all.push({ path: `bin/${i}.txt`, data: t });
    if (files.scratchpad) all.push({ path: "scratchpad.txt", data: files.scratchpad });
    for (const o of files.others ?? []) if (o.path !== files.scriptName && o.path !== "scratchpad.txt" && !o.path.startsWith("bin/")) all.push(o);
    return this.#folder(all);
  }

  /** A tree of files by path ("assets/a.png"), with a subtree per folder. */
  async #folder(files: { path: string; data: Uint8Array | string }[]): Promise<string> {
    const here: [string, string, string, string][] = [];
    const folders = new Map<string, { path: string; data: Uint8Array | string }[]>();
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

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function fileTitle(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  return name.replace(/\.(highland|fountain|spmd|md|markdown|txt)$/i, "") || "Untitled";
}

/** The commit trailer naming the document a work branch belongs to. */
export const ID_TRAILER = "Highwater-Document";
/** The commit trailers naming the kind of file the work was kept in, and its name, at that save. */
export const FORM_TRAILER = "Highwater-Form";
export const FILE_TRAILER = "Highwater-File";

const FORMS: Form[] = ["highland", "fountain", "md", "txt"];
export function isForm(value: string): value is Form {
  return (FORMS as string[]).includes(value);
}

/** The form of a file, by its name: a .highland file, or a plain file's kind. */
export function formOf(path: string): Form {
  const ext = (/\.([^.\\/]+)$/.exec(path)?.[1] ?? "").toLowerCase();
  if (ext === "highland") return "highland";
  if (ext === "fountain" || ext === "spmd") return "fountain";
  if (ext === "md" || ext === "markdown") return "md";
  return "txt";
}

/** The name of the computer, for Restore saves. */
export function computerName(): string {
  return hostname().replace(/\.local$/i, "") || "this computer";
}

/**
 * A text's hash as the catalog lists it: git's object ID of the text with its line endings made
 * LF, so a copy that went through Windows still matches.
 */
export function textHash(text: string): string {
  const data = Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
  return createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
}

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
  const label = { save: "Save", autosave: "Autosave", close: "Close", convert: "Convert", revert: "Revert", restore: "Restore" }[kind];
  return `${label} ${when}, ${note ? `${note}, ` : ""}${delta >= 0 ? "+" : "−"}${Math.abs(delta).toLocaleString("en-US")} words (${words.toLocaleString("en-US")})`;
}

