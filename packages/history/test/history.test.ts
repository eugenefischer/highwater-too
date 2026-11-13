import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommitBatcher, commitMessage, formOf, History, mergeMain, moveHistory, textHash, wordCount } from "../src/index.ts";

const folder = () => mkdtemp(join(tmpdir(), "highwater-history-"));
const script = "INT. HOUSE - DAY\n\nShe enters.\n\nBOB\nHello there.\n";
const gitIn = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

describe("History: one repository, one branch per document", () => {
  it("commits a document's text, Bin and Scratchpad to its own branch, without a checkout", async () => {
    const dir = await folder();
    const h = new History(dir);
    const { id, branch, created } = await h.resolve({ id: null, path: "/w/My Script.highland", text: script });
    expect(created).toBe(true);
    expect(branch).toBe(`works/My-Script-${id.replace(/-/g, "").slice(0, 8)}`);
    const c1 = await h.commit(id, { scriptName: "text.fountain", script, bin: ["cut scene"], scratchpad: "ideas" }, "save", new Date(2026, 9, 11, 14, 3));
    expect(c1?.message).toBe("Save 2026-10-11 14:03, +8 words (8)");
    expect(gitIn(h.repo, "show", `${branch}:bin/0.txt`)).toBe("cut scene");
    expect(gitIn(h.repo, "ls-tree", "--name-only", branch).split("\n")).toEqual(["bin", "scratchpad.txt", "text.fountain"]);
    expect(await h.commit(id, { scriptName: "text.fountain", script, bin: ["cut scene"], scratchpad: "ideas" }, "save")).toBeNull();
    await h.commit(id, { scriptName: "text.fountain", script: `${script}\nShe leaves.\n` }, "autosave");
    expect(gitIn(h.repo, "ls-tree", "--name-only", branch).split("\n")).toEqual(["text.fountain"]);
    const log = await h.log(id);
    expect(log.map((c) => c.message.split(" ")[0])).toEqual(["Autosave", "Save"]);
    expect(await h.scriptAt(log[1]!.hash)).toBe(script);
    expect(gitIn(h.repo, "show", "main:README.md")).toContain("Writing history");
    expect(gitIn(h.repo, "rev-parse", "--is-bare-repository")).toBe("true");
  });

  it("shows the history without waiting for slow work on it (a mirror's pull)", async () => {
    const h = new History(await folder());
    const doc = { id: null, path: "/w/Slow.highland", text: script };
    const { id } = await h.resolve(doc);
    await h.commit(id, { scriptName: "text.fountain", script }, "save", new Date(), undefined, { form: "highland", file: "Slow.highland" });
    let release!: () => void;
    const busy = h.exclusive(() => new Promise<void>((r) => (release = r)));
    const found = await h.find(doc, { wait: false });
    expect(found?.id).toBe(id);
    expect((await h.works({ wait: false })).map((w) => w.title)).toEqual(["Slow"]);
    // The waiting kind still queues behind it.
    let waited = false;
    const queued = h.find(doc).then(() => (waited = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(waited).toBe(false);
    release();
    await busy;
    await queued;
    expect(waited).toBe(true);
  });

  it("keeps works on independent branches that share no history", async () => {
    const h = new History(await folder());
    const a = await h.resolve({ id: null, path: "/w/A.highland", text: script });
    const b = await h.resolve({ id: null, path: "/w/B.highland", text: "Another work entirely.\n\nNothing in common." });
    await h.commit(a.id, { scriptName: "text.fountain", script }, "save");
    await h.commit(b.id, { scriptName: "text.md", script: "Another work entirely.\n\nNothing in common." }, "save");
    expect(() => gitIn(h.repo, "merge-base", a.branch, b.branch)).toThrow();
    // One work can be bundled alone.
    gitIn(h.repo, "bundle", "create", join(h.folder, "a.bundle"), a.branch);
    expect(gitIn(h.repo, "bundle", "list-heads", join(h.folder, "a.bundle"))).toContain(a.branch);
  });

  it("finds a moved document by its ID or its path, never by guessing from its text", async () => {
    const dir = await folder();
    const h = new History(dir);
    const first = await h.resolve({ id: null, path: "/a/One.highland", text: script });
    await h.commit(first.id, { scriptName: "text.fountain", script }, "save");
    expect((await h.resolve({ id: first.id, path: "/b/Renamed.highland", text: "different" })).branch).toBe(first.branch);
    const fresh = new History(dir);
    expect(await fresh.find({ id: null, path: "/c/Again.highland", text: script })).toBeNull();
    const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
    expect(index.documents[first.id].paths).toEqual(["/a/One.highland", "/b/Renamed.highland"]);
  });

  it("looks a document up without creating a history", async () => {
    const dir = await folder();
    const h = new History(dir);
    expect(await h.find({ id: null, path: "/w/New.highland", text: script })).toBeNull();
    expect(existsSync(join(dir, "index.json"))).toBe(false);
    const made = await h.resolve({ id: null, path: "/w/New.highland", text: script });
    expect(await h.find({ id: null, path: "/w/New.highland", text: "" })).toEqual({ id: made.id, branch: made.branch, paused: false, copyOf: null });
  });

});

describe("moving and pausing", () => {
  it("moves a history folder and keeps working from the new place", async () => {
    const from = await folder();
    const h = new History(from);
    const { id } = await h.resolve({ id: null, path: "/w/A.highland", text: script });
    await h.commit(id, { scriptName: "text.fountain", script }, "save");
    const to = join(await folder(), "moved");
    await moveHistory(from, to);
    expect(existsSync(from)).toBe(false);
    const moved = new History(to);
    await moved.resolve({ id, path: "/w/A.highland", text: script });
    expect((await moved.log(id)).length).toBe(1);
    await moved.setPaused(id, true);
    expect((await new History(to).resolve({ id, path: "/w/A.highland", text: script })).paused).toBe(true);
    await expect(moveHistory(to, to)).rejects.toThrow(/not empty/);
  });
});

describe("helpers", () => {
  it("counts words and writes commit messages", () => {
    expect(wordCount("Don’t stop — it's 12 o'clock.")).toBe(5);
    expect(commitMessage("autosave", new Date(2026, 0, 2, 3, 4), "one two three", "one")).toBe("Autosave 2026-01-02 03:04, −2 words (1)");
  });

});

describe("CommitBatcher", () => {
  it("commits saves at once, autosaves at most every interval, and flushes on close", async () => {
    vi.useFakeTimers();
    let now = 0;
    const commits: string[] = [];
    const b = new CommitBatcher(async (_k, kind) => void commits.push(kind), 1000, () => now);
    await b.saved("doc", "autosave");
    b.saved("doc", "autosave");
    b.saved("doc", "autosave");
    expect(commits).toEqual(["autosave"]);
    now = 1000;
    vi.advanceTimersByTime(1000);
    expect(commits).toEqual(["autosave", "autosave"]);
    now = 1500;
    b.saved("doc", "autosave");
    await b.saved("doc", "close");
    expect(commits).toEqual(["autosave", "autosave", "close"]);
    expect(b.saved("doc", "close")).toBeNull();
    await b.saved("doc", "save");
    expect(commits.at(-1)).toBe("save");
    b.dispose();
    vi.useRealTimers();
  });
});

describe("the catalog on main", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i} of the story.`).join("\n") + "\n";
  const meta = (file: string) => ({ form: formOf(file), file });

  it("lists every work with its saves' text hashes, and writes the README from it", async () => {
    const h = new History(await folder());
    const doc = await h.resolve({ id: "1a2b3c4d-0000", path: "/w/The Purity Variations.highland", text: long });
    await h.commit(doc.id, { scriptName: "text.md", script: long }, "save", new Date(2026, 9, 12, 9, 0), undefined, meta("The Purity Variations.highland"));
    await h.commit(doc.id, { scriptName: "text.md", script: `${long}More.\n` }, "save", new Date(2026, 9, 12, 9, 5), undefined, meta("The Purity Variations.highland"));
    // Not on main until flushed, but the catalog already shows it.
    expect(gitIn(h.repo, "ls-tree", "-r", "--name-only", "main")).toBe("README.md");
    const [entry] = await h.catalog();
    expect(entry).toMatchObject({ id: doc.id, branch: doc.branch, title: "The Purity Variations", form: "highland", file: "The Purity Variations.highland", latestText: textHash(`${long}More.\n`) });
    expect(entry!.texts).toEqual([textHash(long), textHash(`${long}More.\n`)].sort());
    expect(await h.flushCatalog()).toBe(true);
    const slug = doc.branch.replace("works/", "");
    expect(gitIn(h.repo, "ls-tree", "-r", "--name-only", "main").split("\n")).toEqual(["README.md", `works/${slug}/info.json`, `works/${slug}/texts`]);
    expect(gitIn(h.repo, "show", "main:README.md")).toContain(`| The Purity Variations | \`${doc.branch}\` |`);
    // Nothing new: no new commit on main.
    expect(await h.flushCatalog()).toBe(false);
  });

  it("merges two computers' catalogs by fixed rules", () => {
    const info = (lastSave: string) => JSON.stringify({ id: "x", branch: "works/A-x", title: "A", form: "md", file: "A.md", lastSave, latestText: lastSave });
    const mine = new Map([
      ["README.md", "mine"],
      ["works/A-x/info.json", info("2026-10-12T09:00:00Z")],
      ["works/A-x/texts", "aa\ncc\n"],
      ["works/B-y/info.json", "{}"],
    ]);
    const theirs = new Map([
      ["README.md", "theirs"],
      ["works/A-x/info.json", info("2026-10-12T10:00:00Z")],
      ["works/A-x/texts", "bb\ncc\n"],
      ["deleted/B-y.json", JSON.stringify({ id: "y", branch: "works/B-y", deleted: "2026-10-12T11:00:00Z" })],
    ]);
    const merged = mergeMain(mine, theirs);
    expect(merged.get("works/A-x/texts")).toBe("aa\nbb\ncc\n");
    expect(merged.get("works/A-x/info.json")).toBe(info("2026-10-12T10:00:00Z"));
    expect(merged.has("works/B-y/info.json")).toBe(false);
    expect(merged.has("deleted/B-y.json")).toBe(true);
    expect(merged.get("README.md")).toBe("mine");
    expect(mergeMain(theirs, mine).get("works/A-x/texts")).toBe(merged.get("works/A-x/texts"));
  });

  it("recognises a file by its ID, its text's hash or its file name", async () => {
    const h = new History(await folder());
    const doc = await h.resolve({ id: "1a2b3c4d-1111", path: "/w/Novel.md", text: long });
    await h.commit(doc.id, { scriptName: "text.md", script: long }, "save", new Date(2026, 9, 1), undefined, meta("Novel.md"));
    await h.commit(doc.id, { scriptName: "text.md", script: `${long}Two.\n` }, "save", new Date(2026, 9, 2), undefined, meta("Novel.md"));
    const look = (doc: { id?: string; path: string; text: string; savedText?: string }, minWords = 50) => h.recognise({ id: doc.id ?? null, ...doc }, minWords);
    expect(await look({ id: "1a2b3c4d-1111", path: "/x/Other.highland", text: "anything" })).toMatchObject([{ by: "id", match: "none", local: true }]);
    expect(await look({ path: "/x/Copy.md", text: `${long}Two.\n` })).toMatchObject([{ by: "hash", match: "latest" }]);
    expect(await look({ path: "/x/Copy.md", text: long })).toMatchObject([{ by: "hash", match: "older", text: textHash(long) }]);
    expect((await h.saveWithText(doc.branch, textHash(long)))?.date).toEqual(new Date(2026, 9, 1));
    expect(await look({ id: "1a2b3c4d-1111", path: "/x/N.highland", text: "edited", savedText: textHash(long) })).toMatchObject([{ by: "id", match: "edited", text: textHash(long) }]);
    expect(await look({ path: "/x/Novel.md", text: "Rewritten." })).toMatchObject([{ by: "name", match: "none" }]);
    // Short texts never match by hash (empty files, templates).
    expect(await look({ path: "/x/Other.md", text: long }, 1000)).toEqual([]);
    expect(await look({ path: "/x/Other.md", text: "Nothing like it." })).toEqual([]);
  });
});

describe("plain files", () => {
  it("records a save as the .highland file unpacked, with the form and file name", async () => {
    const h = new History(await folder());
    const { id, branch } = await h.resolve({ id: null, path: "/w/Script.fountain", text: script });
    const info = new TextEncoder().encode('{"com.quoteunquoteapps.highland2":{"templateName":"Screenplay"}}');
    const files = { scriptName: "text.fountain", script, bin: ["b"], others: [{ path: "info.json", data: info }, { path: "assets/a.png", data: new Uint8Array([1, 2]) }] };
    const c = await h.commit(id, files, "save", new Date(2026, 9, 12, 9, 0), undefined, { form: "fountain", file: "Script.fountain" });
    expect(gitIn(h.repo, "ls-tree", "-r", "--name-only", branch).split("\n")).toEqual(["assets/a.png", "bin/0.txt", "info.json", "text.fountain"]);
    const back = await h.filesAt(c!.hash);
    expect(back.others?.map((o) => o.path)).toEqual(["assets/a.png", "info.json"]);
    expect(back.others?.find((o) => o.path === "info.json")?.data).toEqual(info);
    expect(gitIn(h.repo, "log", "-1", "--format=%B", branch)).toBe(`Save 2026-10-12 09:00, +8 words (8)\n\nHighwater-Document: ${id}\nHighwater-Form: fountain\nHighwater-File: Script.fountain`);
    const [latest] = await h.log(id, 1);
    expect(latest).toMatchObject({ form: "fountain", file: "Script.fountain" });
    // An unchanged save is not recorded; a Restore (like Convert and Revert) always is.
    expect(await h.commit(id, files, "save")).toBeNull();
    expect((await h.commit(id, files, "restore", new Date(2026, 9, 12, 9, 5), "on Desk", { form: "fountain", file: "Script.fountain" }))?.message).toBe("Restore 2026-10-12 09:05, on Desk, +0 words (8)");
  });

  it("hashes a text as git does, whatever its line endings", async () => {
    const dir = await folder();
    await writeFile(join(dir, "t.txt"), "One.\nTwo.\n");
    expect(textHash("One.\nTwo.\n")).toBe(gitIn(dir, "hash-object", "t.txt"));
    expect(textHash("One.\r\nTwo.\r\n")).toBe(textHash("One.\nTwo.\n"));
    expect(formOf("/w/A.highland")).toBe("highland");
    expect(formOf("/w/A.markdown")).toBe("md");
    expect(formOf("/w/A.spmd")).toBe("fountain");
  });

  it("retires a path whose work moved on: the file there starts a new history, even with the old ID", async () => {
    const h = new History(await folder());
    const plain = await h.resolve({ id: null, path: "/w/Script.fountain", text: script });
    await h.commit(plain.id, { scriptName: "text.fountain", script }, "save");
    const bundle = await h.resolve({ id: plain.id, path: "/w/Script.highland", text: script });
    expect(bundle.id).toBe(plain.id);
    await h.retire("/w/Script.fountain");
    expect(await h.find({ id: null, path: "/w/Script.fountain", text: script })).toBeNull();
    expect(await h.find({ id: plain.id, path: "/w/Script.fountain", text: script })).toBeNull();
    const again = await h.resolve({ id: plain.id, path: "/w/Script.fountain", text: script });
    expect(again.id).not.toBe(plain.id);
    expect(again.created).toBe(true);
    // Once it has a history of its own, it is found by its path again.
    expect((await h.find({ id: null, path: "/w/Script.fountain", text: script }))?.id).toBe(again.id);
    expect((await h.find({ id: plain.id, path: "/w/Script.highland", text: script }))?.id).toBe(plain.id);
  });
});

describe("converting between a .highland file and a plain file", () => {
  it("moves the history to the new file, leaves the old one out, and says so in the commit", async () => {
    const h = new History(await folder());
    const { id, branch } = await h.resolve({ id: null, path: "/w/Script.fountain", text: script });
    await h.commit(id, { scriptName: "text.fountain", script }, "save");
    expect(await h.tracks("/w/Script.fountain")).toBe(true);
    await h.attach(id, "/w/Script.highland");
    await h.retire("/w/Script.fountain");
    expect(await h.tracks("/w/Script.fountain")).toBe(false);
    const c = await h.commit(id, { scriptName: "text.fountain", script, others: [{ path: "info.json", data: new Uint8Array([123, 125]) }] }, "convert", new Date(2026, 9, 12, 9, 30), "to Script.highland");
    expect(c?.message).toBe("Convert 2026-10-12 09:30, to Script.highland, +0 words (8)");
    expect(gitIn(h.repo, "diff", "--name-status", `${branch}~1`, branch)).toBe("A\tinfo.json");
    // And back to the first path: it belongs to the history again.
    await h.attach(id, "/w/Script.fountain");
    await h.retire("/w/Script.highland");
    expect((await h.find({ id: null, path: "/w/Script.fountain", text: script }))?.id).toBe(id);
    expect(await h.find({ id, path: "/w/Script.highland", text: script })).toBeNull();
  });

  it("clears a retired path when a work is restored there", async () => {
    const h = new History(await folder());
    const r = await h.resolve({ id: null, path: "/w/A.fountain", text: script });
    await h.commit(r.id, { scriptName: "text.fountain", script }, "save");
    await h.retire("/w/A.fountain");
    const [work] = await h.works();
    expect(await h.claim(work!, "/w/A.fountain")).toBe(r.id);
    expect((await h.find({ id: null, path: "/w/A.fountain", text: script }))?.id).toBe(r.id);
  });
  it("connects a file that lost its ID and was renamed back to its work, joining its own history", async () => {
    const h = new History(await folder());
    const meta = (file: string) => ({ form: formOf(file), file });
    const work = await h.resolve({ id: null, path: "/w/Play copy.highland", text: script });
    await h.commit(work.id, { scriptName: "text.fountain", script }, "save", new Date(2026, 9, 13, 7, 29), undefined, meta("Play copy.highland"));
    // Highland 2 removed the ID, the file was edited and renamed: its next save started a new history.
    const edited = script.replace("She enters.", "She enters, slowly.");
    const stray = await h.resolve({ id: null, path: "/w/Play yoo hoo.highland", text: edited });
    expect(stray.branch).not.toBe(work.branch);
    await h.commit(stray.id, { scriptName: "text.fountain", script: edited }, "save", new Date(2026, 9, 13, 8, 37), undefined, meta("Play yoo hoo.highland"));
    // The writer connects it by hand.
    await h.retire("/w/Play copy.highland");
    const id = await h.join(stray.id, { id: work.id, branch: work.branch, form: "highland" }, meta("Play yoo hoo.highland"), "connected by hand");
    expect(id).toBe(work.id);
    const [merge] = await h.log(work.id, 1);
    expect(merge!.message).toMatch(/^Join .*, the history of Play yoo hoo\.highland connected by hand$/);
    expect(gitIn(h.repo, "rev-list", "--count", work.branch)).toBe("3");
    expect(await h.scriptAt(merge!.hash)).toBe(edited);
    expect(() => gitIn(h.repo, "rev-parse", "--verify", `refs/heads/${stray.branch}`)).toThrow();
    expect((await h.find({ id: null, path: "/w/Play yoo hoo.highland", text: edited }))?.id).toBe(work.id);
    // The old file, if it turns up again, is not the work.
    expect(await h.find({ id: null, path: "/w/Play copy.highland", text: script })).toBeNull();
    // Its separate history is recorded as deleted, so other computers drop it.
    expect((await h.works()).map((w) => w.branch)).not.toContain(stray.branch);
  });

  it("records a Connect even when nothing changed", async () => {
    const h = new History(await folder());
    const r = await h.resolve({ id: null, path: "/w/A.fountain", text: script });
    await h.commit(r.id, { scriptName: "text.fountain", script }, "save");
    const c = await h.commit(r.id, { scriptName: "text.fountain", script }, "connect", new Date(), "to B.fountain, connected by hand");
    expect(c?.message).toMatch(/^Connect .*, to B\.fountain, connected by hand, \+0 words/);
  });
});

describe("copies and moves", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i} of the story.`).join("\n") + "\n";
  const meta = (file: string) => ({ form: formOf(file), file });
  it("tells a copy (the work's file still there) from a move (it is gone), by ID", async () => {
    const dir = await folder();
    const h = new History(join(dir, "history"));
    const original = join(dir, "Script.highland");
    const copy = join(dir, "Script copy.highland");
    await writeFile(original, "x");
    const first = await h.resolve({ id: null, path: original, text: script });
    await h.commit(first.id, { scriptName: "text.fountain", script }, "save");
    // The original is still there: the duplicate is a copy, matched but not recorded as the work's file.
    expect(await h.find({ id: first.id, path: copy, text: script })).toMatchObject({ id: first.id, copyOf: original });
    expect(await h.resolve({ id: first.id, path: copy, text: script })).toMatchObject({ id: first.id, created: false, copyOf: original });
    expect((await h.find({ id: first.id, path: original, text: script }))?.copyOf).toBeNull();
    const index = () => readFile(join(h.folder, "index.json"), "utf8").then((t) => JSON.parse(t));
    expect((await index()).documents[first.id].paths).toEqual([original]);
    // Made the work's file: the original is now the one asked about.
    await h.claim({ id: first.id, branch: first.branch }, copy);
    await writeFile(copy, "x");
    expect((await h.find({ id: first.id, path: copy, text: script }))?.copyOf).toBeNull();
    expect((await h.find({ id: first.id, path: original, text: script }))?.copyOf).toBe(copy);
    // The work's file gone: a file with its ID is the work's file moved.
    const { rm } = await import("node:fs/promises");
    await rm(copy);
    const moved = join(dir, "Moved.highland");
    expect((await h.find({ id: first.id, path: moved, text: script }))?.copyOf).toBeNull();
    expect((await h.resolve({ id: first.id, path: moved, text: script })).copyOf).toBeNull();
    expect((await index()).documents[first.id].paths.at(-1)).toBe(moved);
  });

  it("asks the host whether the work's file is still the work's", async () => {
    const dir = await folder();
    const original = join(dir, "A.highland");
    await writeFile(original, "x");
    const h = new History(join(dir, "history"), { stillHas: async (path, id) => path === original && id === "keep" });
    const a = await h.resolve({ id: "keep", path: original, text: script });
    expect((await h.find({ id: a.id, path: join(dir, "B.highland"), text: script }))?.copyOf).toBe(original);
    const other = new History(join(dir, "history"), { stillHas: async () => false });
    expect((await other.find({ id: a.id, path: join(dir, "B.highland"), text: script }))?.copyOf).toBeNull();
  });

  it("matches only a work's current path: a new file where it used to be is not the work", async () => {
    const h = new History(await folder());
    const first = await h.resolve({ id: null, path: "/w/Old.fountain", text: script });
    await h.commit(first.id, { scriptName: "text.fountain", script }, "save");
    await h.resolve({ id: first.id, path: "/w/New.fountain", text: script });
    expect(await h.find({ id: null, path: "/w/Old.fountain", text: "A new script." })).toBeNull();
    expect((await h.find({ id: null, path: "/w/New.fountain", text: "anything" }))?.id).toBe(first.id);
    // At a work's current path, the file is that work's whatever ID it names.
    const other = await h.resolve({ id: null, path: "/w/Other.fountain", text: "Other." });
    expect((await h.find({ id: other.id, path: "/w/New.fountain", text: "x" }))?.id).toBe(first.id);
  });

  it("recognises a plain copy by its text, naming the work's file it copies", async () => {
    const dir = await folder();
    const h = new History(join(dir, "history"));
    const original = join(dir, "Novel.md");
    await writeFile(original, long);
    const doc = await h.resolve({ id: null, path: original, text: long });
    await h.commit(doc.id, { scriptName: "text.md", script: long }, "save", new Date(2026, 9, 1), undefined, meta("Novel.md"));
    const copy = join(dir, "Novel copy.md");
    expect(await h.recognise({ id: null, path: copy, text: long })).toMatchObject([{ by: "hash", match: "latest", local: true, copyOf: original }]);
    const { rm } = await import("node:fs/promises");
    await rm(original);
    expect(await h.recognise({ id: null, path: copy, text: long })).toMatchObject([{ by: "hash", local: true, copyOf: null }]);
  });
});
