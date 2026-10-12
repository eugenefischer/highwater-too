import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    expect(await h.find({ id: null, path: "/w/New.highland", text: "" })).toEqual({ id: made.id, branch: made.branch, paused: false });
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
});
