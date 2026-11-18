import type { Form } from "./history.ts";

/**
 * The catalog on `main`: what every computer may know about every work without holding its
 * writing. One folder per work, so two computers changing it at once rarely touch the same files,
 * and fixed rules for when they do, so merging never needs a person:
 *
 *   works/<name>-<id8>/info.json   ID, branch, title (and when it was set), form, file name, last save, latest text hash
 *   works/<name>-<id8>/texts       the text hash of every save, one per line, sorted (union on merge)
 *   deleted/<name>-<id8>.json      a deletion record (union on merge; removes the work's folder)
 *   README.md                      written from the catalog, never merged as text
 */
export interface CatalogInfo {
  id: string;
  branch: string;
  title: string;
  /**
   * ISO time the title was set: the work's first save, or its latest rename. The title with the
   * later time wins whatever the other fields do (an ordinary save made on a computer that has not
   * heard of a rename yet keeps the rename's title). Absent on works recorded before titles were
   * kept (their title is the branch's name).
   */
  titleAt?: string;
  form: Form | null;
  file: string | null;
  /** ISO time of the latest save. */
  lastSave: string | null;
  /** The text hash of the latest save. */
  latestText: string | null;
}

export interface CatalogEntry extends CatalogInfo {
  texts: string[];
}

export interface DeletedEntry {
  id: string;
  branch: string;
  deleted: string;
}

/** main's files, by path, as text. */
export type MainFiles = Map<string, string>;

export const slugOf = (branch: string): string => branch.replace(/^works\//, "");

export function readCatalog(files: MainFiles): { works: CatalogEntry[]; deleted: DeletedEntry[] } {
  const works: CatalogEntry[] = [];
  const deleted: DeletedEntry[] = [];
  for (const [path, text] of files) {
    let m = /^works\/([^/]+)\/info\.json$/.exec(path);
    if (m) {
      const info = parse<CatalogInfo>(text);
      if (!info?.id || !info.branch) continue;
      works.push({ ...info, texts: lines(files.get(`works/${m[1]}/texts`) ?? "") });
      continue;
    }
    m = /^deleted\/([^/]+)\.json$/.exec(path);
    if (m) {
      const d = parse<DeletedEntry>(text);
      if (d?.branch) deleted.push(d);
    }
  }
  const gone = new Set(deleted.map((d) => d.branch));
  return { works: works.filter((w) => !gone.has(w.branch)), deleted };
}

/**
 * `base` with the title of whichever of `a` and `b` was set later (`a`'s when neither says, or
 * both say the same time).
 */
export function withTitle<T extends CatalogInfo>(base: T, a: CatalogInfo, b: CatalogInfo): T {
  const from = (b.titleAt ?? "") > (a.titleAt ?? "") ? b : a;
  const out: T = { ...base, title: from.title };
  if (from.titleAt) out.titleAt = from.titleAt;
  else delete out.titleAt;
  return out;
}

/** Adds a save to a work's entry (or creates it). */
export function addSave(files: MainFiles, info: CatalogInfo, textHash: string): void {
  const slug = slugOf(info.branch);
  const old = parse<CatalogInfo>(files.get(`works/${slug}/info.json`) ?? "");
  const newer = !old?.lastSave || !info.lastSave || info.lastSave >= old.lastSave;
  const chosen = newer ? info : old!;
  // An ordinary save carries no title time: the title already recorded stays.
  files.set(`works/${slug}/info.json`, stringify(old ? withTitle(chosen, old, info) : chosen));
  files.set(`works/${slug}/texts`, joinLines([...lines(files.get(`works/${slug}/texts`) ?? ""), textHash]));
}

/** Records a deletion: the work's folder goes, the record stays. */
export function addDeletion(files: MainFiles, entry: DeletedEntry): void {
  const slug = slugOf(entry.branch);
  files.set(`deleted/${slug}.json`, stringify(entry));
  for (const p of [...files.keys()]) if (p.startsWith(`works/${slug}/`)) files.delete(p);
}

/** Merges two computers' main files by the catalog's rules (the README is left to the caller). */
export function mergeMain(mine: MainFiles, theirs: MainFiles): MainFiles {
  const out: MainFiles = new Map(mine);
  for (const [path, text] of theirs) {
    const here = out.get(path);
    if (here === undefined) out.set(path, text);
    else if (here === text) continue;
    else if (/^works\/[^/]+\/texts$/.test(path)) out.set(path, joinLines([...lines(here), ...lines(text)]));
    else if (/^works\/[^/]+\/info\.json$/.test(path)) {
      const a = parse<CatalogInfo>(here);
      const b = parse<CatalogInfo>(text);
      if (!a) out.set(path, text);
      else if (b) {
        const theirsNewer = (b.lastSave ?? "") > (a.lastSave ?? "");
        const winner = theirsNewer ? b : a;
        const titled = withTitle(winner, a, b);
        // The newer entry as written, unless the other one's title is the later one.
        if (titled.title === winner.title && titled.titleAt === winner.titleAt) out.set(path, theirsNewer ? text : here);
        else out.set(path, stringify(titled));
      }
    }
    // deleted/ records are kept as either computer wrote them; anything else stays this computer's.
  }
  // A deletion record removes the work's folder.
  for (const path of [...out.keys()]) {
    const m = /^deleted\/([^/]+)\.json$/.exec(path);
    if (m) for (const p of [...out.keys()]) if (p.startsWith(`works/${m[1]}/`)) out.delete(p);
  }
  return out;
}

function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function joinLines(items: string[]): string {
  return `${[...new Set(items)].sort().join("\n")}\n`;
}

function parse<T>(text: string): T | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
