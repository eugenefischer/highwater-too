import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CommitBatcher, commitMessage, History, similarity, wordCount } from "../src/index.ts";

const folder = () => mkdtemp(join(tmpdir(), "highwater-history-"));
const script = "INT. HOUSE - DAY\n\nShe enters.\n\nBOB\nHello there.\n";

describe("History", () => {
  it("creates a repo per document and commits its text, Bin and Scratchpad", async () => {
    const h = new History(await folder());
    const { id, repo, created } = await h.resolve({ id: null, path: "/w/Script.highland", text: script });
    expect(created).toBe(true);
    expect(repo.endsWith("Script")).toBe(true);
    const c1 = await h.commit(repo, { scriptName: "text.fountain", script, bin: ["cut scene"], scratchpad: "ideas" }, "save", new Date(2026, 9, 11, 14, 3));
    expect(c1?.message).toBe("Save 2026-10-11 14:03, +8 words (8)");
    expect(await readFile(join(repo, "bin/0.txt"), "utf8")).toBe("cut scene");
    expect(await h.commit(repo, { scriptName: "text.fountain", script, bin: ["cut scene"], scratchpad: "ideas" }, "save")).toBeNull();
    await h.commit(repo, { scriptName: "text.fountain", script: `${script}\nShe leaves.\n` }, "autosave");
    expect(existsSync(join(repo, "bin"))).toBe(false);
    expect(existsSync(join(repo, "scratchpad.txt"))).toBe(false);
    const log = await h.log(repo);
    expect(log.map((c) => c.message.split(" ")[0])).toEqual(["Autosave", "Save"]);
    expect(await h.show(repo, log[1]!.hash, "text.fountain")).toBe(script);
    // Same ID again: same repo.
    expect((await h.resolve({ id, path: "/w/Script.highland", text: script })).repo).toBe(repo);
  });

  it("finds a moved document by its ID, and by its text when the ID is gone", async () => {
    const dir = await folder();
    const h = new History(dir);
    const first = await h.resolve({ id: null, path: "/a/One.highland", text: script });
    await h.commit(first.repo, { scriptName: "text.fountain", script }, "save");
    const byId = await h.resolve({ id: first.id, path: "/b/Renamed.highland", text: "different" });
    expect(byId.repo).toBe(first.repo);
    // Highland dropped the ID and the file moved again: matched by text.
    const fresh = new History(dir);
    const byText = await fresh.resolve({ id: null, path: "/c/Again.highland", text: `${script}\nOne more line.\n` });
    expect(byText).toEqual({ id: first.id, repo: first.repo, created: false });
    // An unrelated document gets its own history, under a free name.
    const other = await fresh.resolve({ id: null, path: "/d/One.highland", text: "Something else entirely.\n\nNothing alike." });
    expect(other.created).toBe(true);
    expect(other.repo.endsWith("One 2")).toBe(true);
    const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
    expect(index.documents[first.id].paths).toEqual(["/a/One.highland", "/b/Renamed.highland", "/c/Again.highland"]);
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
    await b.saved("doc", "autosave"); // first autosave: commits
    b.saved("doc", "autosave"); // too soon: pending
    b.saved("doc", "autosave"); // still one pending
    expect(commits).toEqual(["autosave"]);
    now = 1000;
    vi.advanceTimersByTime(1000);
    expect(commits).toEqual(["autosave", "autosave"]);
    now = 1500;
    b.saved("doc", "autosave"); // pending again
    await b.saved("doc", "close"); // flushes
    expect(commits).toEqual(["autosave", "autosave", "close"]);
    expect(b.saved("doc", "close")).toBeNull(); // nothing pending
    await b.saved("doc", "save");
    expect(commits.at(-1)).toBe("save");
    b.dispose();
    vi.useRealTimers();
  });
});
