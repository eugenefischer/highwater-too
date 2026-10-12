import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommitBatcher, commitMessage, formOf, History, moveHistory, similarity, textHash, wordCount } from "../src/index.ts";

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

  it("finds a moved document by its ID, and by its text when the ID is gone", async () => {
    const dir = await folder();
    const h = new History(dir);
    const first = await h.resolve({ id: null, path: "/a/One.highland", text: script });
    await h.commit(first.id, { scriptName: "text.fountain", script }, "save");
    expect((await h.resolve({ id: first.id, path: "/b/Renamed.highland", text: "different" })).branch).toBe(first.branch);
    const fresh = new History(dir);
    const byText = await fresh.resolve({ id: null, path: "/c/Again.highland", text: `${script}\nOne more line.\n` });
    expect(byText).toEqual({ id: first.id, branch: first.branch, created: false, paused: false });
    const other = await fresh.resolve({ id: null, path: "/d/One.highland", text: "Something else entirely.\n\nNothing alike." });
    expect(other.created).toBe(true);
    expect(other.branch).not.toBe(first.branch);
    const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
    expect(index.documents[first.id].paths).toEqual(["/a/One.highland", "/b/Renamed.highland", "/c/Again.highland"]);
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

  it("scores text similarity by shared lines", () => {
    expect(similarity("a\nb\nc", "a\nb\nc")).toBe(1);
    expect(similarity("a\nb", "c\nd")).toBe(0);
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

describe("the README on main", () => {
  it("explains the repository and lists its works, updating when a work is added", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const { History } = await import("../src/index.ts");
    const h = new History(await mkdtemp(join(tmpdir(), "readme-")));
    const doc = await h.resolve({ id: "1a2b3c4d-0000", path: "/w/The Purity Variations.highland", text: "x" });
    const text = execFileSync("git", ["show", "main:README.md"], { cwd: h.repo, encoding: "utf8" });
    expect(text).toContain("Each work has its own branch");
    expect(text).toContain(`| The Purity Variations | \`${doc.branch}\` |`);
    expect(text).not.toContain("beside this repository");
    // Nothing changed: no new commit on main.
    const before = execFileSync("git", ["rev-parse", "main"], { cwd: h.repo, encoding: "utf8" });
    await new History(h.folder).resolve({ id: "1a2b3c4d-0000", path: "/w/The Purity Variations.highland", text: "x" });
    expect(execFileSync("git", ["rev-parse", "main"], { cwd: h.repo, encoding: "utf8" })).toBe(before);
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
