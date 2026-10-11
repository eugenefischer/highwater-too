import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommitBatcher, commitMessage, History, moveHistory, similarity, wordCount } from "../src/index.ts";

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

  it("brings 0.0.15–0.0.16 per-document repositories in as branches, commits unchanged", async () => {
    const dir = await folder();
    const old = join(dir, "Old Script");
    await mkdir(old);
    gitIn(old, "init", "-q");
    gitIn(old, "config", "user.email", "t@example.com");
    gitIn(old, "config", "user.name", "T");
    await writeFile(join(old, "text.fountain"), script);
    gitIn(old, "add", "-A");
    gitIn(old, "commit", "-q", "-m", "Save");
    const hash = gitIn(old, "rev-parse", "HEAD");
    await writeFile(join(dir, "index.json"), JSON.stringify({ version: 1, documents: { "abc-123": { repo: "Old Script", paths: ["/w/Old Script.highland"] } } }));
    const h = new History(dir);
    const r = await h.resolve({ id: "abc-123", path: "/w/Old Script.highland", text: script });
    expect(r.created).toBe(false);
    expect((await h.log("abc-123"))[0]!.hash).toBe(hash);
    expect(existsSync(join(dir, "old-repositories", "Old Script"))).toBe(true);
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
