import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { History, Mirror, parseRemote } from "../src/index.ts";

const temp = () => mkdtemp(join(tmpdir(), "highwater-mirror-"));
const gitIn = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const script = "INT. HOUSE - DAY\n\nShe enters.\n";

describe("parseRemote", () => {
  it("reads the common address forms", () => {
    expect(parseRemote("https://github.com/ej/writing-history.git")).toMatchObject({ kind: "github", owner: "ej", name: "writing-history" });
    expect(parseRemote("git@github.com:ej/history.git")).toMatchObject({ kind: "github", login: "git@github.com", path: "ej/history.git", name: "history" });
    expect(parseRemote("https://gitlab.com/group/sub/history")).toMatchObject({ kind: "gitlab", owner: "sub", name: "history" });
    expect(parseRemote("ssh://me@nas.local:2222/volume1/git/history.git")).toMatchObject({ kind: "ssh", login: "me@nas.local", port: "2222", path: "/volume1/git/history.git" });
    expect(parseRemote("me@server:git/history.git")).toMatchObject({ kind: "ssh", login: "me@server", path: "git/history.git" });
    expect(parseRemote("https://git.example.org/me/history.git")).toMatchObject({ kind: "https", host: "git.example.org" });
    expect(parseRemote("/Volumes/Backup/history.git")).toMatchObject({ kind: "local", path: "/Volumes/Backup/history.git" });
  });
});

describe("failureKind", () => {
  it("sorts git's failures by what the writer can do", async () => {
    const { failureKind } = await import("../src/index.ts");
    expect(failureKind("git push: fatal: could not read Username for 'https://gitea.example.net': terminal prompts disabled")).toBe("auth");
    expect(failureKind("remote: Unauthorized\nfatal: Authentication failed for 'https://host/x.git/'")).toBe("auth");
    expect(failureKind("The requested URL returned error: 403")).toBe("auth");
    expect(failureKind("git@host: Permission denied (publickey).\nfatal: Could not read from remote repository.")).toBe("auth");
    expect(failureKind("fatal: unable to access 'https://x/': Could not resolve host: x")).toBe("unreachable");
    expect(failureKind("fatal: repository 'https://host/me/h.git/' not found")).toBe("missing");
    expect(failureKind("fatal: '/tmp/nope.git' does not appear to be a git repository")).toBe("missing");
  });
});

describe("Mirror", () => {
  it("pushes every branch, says when the remote is missing, and never force-pushes", async () => {
    const remote = join(await temp(), "remote.git");
    const a = new History(await temp());
    const doc = await a.resolve({ id: "doc-1", path: "/w/Script.highland", text: script });
    await a.commit(doc.id, { scriptName: "text.fountain", script }, "save");

    const missing = await new Mirror(a, remote).push();
    expect(missing).toMatchObject({ ok: false, missing: true });

    execFileSync("git", ["init", "-q", "--bare", remote]);
    expect(await new Mirror(a, remote).push()).toMatchObject({ ok: true });
    expect(gitIn(remote, "rev-parse", doc.branch)).toBe(gitIn(a.repo, "rev-parse", doc.branch));
    expect(gitIn(remote, "show", "main:README.md")).toContain("Writing history");

    // A second computer saves the same document (same ID, travelling inside the .highland file).
    const b = new History(await temp());
    const docB = await b.resolve({ id: "doc-1", path: "/Users/other/Script.highland", text: script });
    expect(docB.branch).toBe(doc.branch);
    await b.commit(docB.id, { scriptName: "text.fountain", script: `${script}\nOn the laptop.\n` }, "save");
    const before = gitIn(remote, "rev-parse", doc.branch);
    expect(await new Mirror(b, remote).push()).toMatchObject({ ok: true });
    // Joined, not overwritten: the remote branch still contains the first computer's commit.
    const after = gitIn(remote, "rev-parse", doc.branch);
    expect(gitIn(remote, "merge-base", "--is-ancestor", before, after) === "").toBe(true);
    expect(gitIn(remote, "show", `${doc.branch}:text.fountain`)).toContain("On the laptop.");

    // The first computer catches up without losing anything either.
    await a.commit(doc.id, { scriptName: "text.fountain", script: `${script}\nOn the desktop.\n` }, "save");
    expect(await new Mirror(a, remote).push()).toMatchObject({ ok: true });
    const final = gitIn(remote, "rev-parse", doc.branch);
    expect(gitIn(remote, "merge-base", "--is-ancestor", after, final) === "").toBe(true);
    expect(gitIn(remote, "show", `${doc.branch}:text.fountain`)).toContain("On the desktop.");
  });

  it("pulls another computer's histories onto a new one, matched by ID, path-free", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    // Nothing pushed yet: nothing to pull, and that is not an error.
    expect(await a.exclusive(() => new Mirror(a, remote).pull())).toEqual({ ok: true, updated: [] });

    const doc = await a.resolve({ id: "doc-1", path: "/desk/Script.highland", text: script });
    await a.commit(doc.id, { scriptName: "text.fountain", script }, "save");
    const plain = await a.resolve({ id: null, path: "/desk/Notes.md", text: "# Notes\n\nOne idea.\nAnother idea.\n" });
    await a.commit(plain.id, { scriptName: "text.md", script: "# Notes\n\nOne idea.\nAnother idea.\n" }, "save");
    expect(await new Mirror(a, remote).push()).toMatchObject({ ok: true });

    // A new computer, with the files at other paths (one renamed): pulling finds both histories.
    const b = new History(await temp());
    const pulled = await b.exclusive(() => new Mirror(b, remote).pull());
    expect(pulled.ok && pulled.updated.filter((u) => u !== "main").sort()).toEqual([doc.branch, plain.branch].sort());
    const found = await b.find({ id: "doc-1", path: "/laptop/Renamed.highland", text: "" });
    expect(found?.branch).toBe(doc.branch);
    expect((await b.log("doc-1")).map((c) => c.hash)).toEqual((await a.log("doc-1")).map((c) => c.hash));
    // A plain file has no ID: matched by its text, it takes the ID its commits name.
    const notes = await b.resolve({ id: null, path: "/laptop/Notes.md", text: "# Notes\n\nOne idea.\nAnother idea.\nA third.\n" });
    expect(notes).toMatchObject({ id: plain.id, branch: plain.branch, created: false });
    // Saving there continues the same branch.
    const r = await b.resolve({ id: "doc-1", path: "/laptop/Renamed.highland", text: script });
    expect(r).toMatchObject({ branch: doc.branch, created: false });
  });

  it("pull moves a branch forward, or joins one both computers moved, losing nothing", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const b = new History(await temp());
    const doc = await a.resolve({ id: "doc-1", path: "/a/S.highland", text: script });
    await a.commit(doc.id, { scriptName: "text.fountain", script }, "save");
    await new Mirror(a, remote).push();
    await b.exclusive(() => new Mirror(b, remote).pull());
    await b.resolve({ id: "doc-1", path: "/b/S.highland", text: script });

    // a saves again: b is behind and simply moves forward.
    await a.commit(doc.id, { scriptName: "text.fountain", script: `${script}\nTwo.\n` }, "save");
    await new Mirror(a, remote).push();
    expect(await b.exclusive(() => new Mirror(b, remote).pull())).toEqual({ ok: true, updated: [doc.branch] });
    expect(gitIn(b.repo, "rev-parse", doc.branch)).toBe(gitIn(a.repo, "rev-parse", doc.branch));

    // Both save: pulling joins them; b's own commit and text stay.
    await a.commit(doc.id, { scriptName: "text.fountain", script: `${script}\nThree on a.\n` }, "save");
    await new Mirror(a, remote).push();
    const mine = await b.commit("doc-1", { scriptName: "text.fountain", script: `${script}\nThree on b.\n` }, "save");
    expect(await b.exclusive(() => new Mirror(b, remote).pull())).toEqual({ ok: true, updated: [doc.branch] });
    const head = gitIn(b.repo, "rev-parse", doc.branch);
    expect(gitIn(b.repo, "merge-base", "--is-ancestor", mine!.hash, head) === "").toBe(true);
    expect(gitIn(b.repo, "merge-base", "--is-ancestor", gitIn(a.repo, "rev-parse", doc.branch), head) === "").toBe(true);
    expect(gitIn(b.repo, "show", `${doc.branch}:text.fountain`)).toContain("Three on b.");
    // Nothing new: nothing changes.
    expect(await b.exclusive(() => new Mirror(b, remote).pull())).toEqual({ ok: true, updated: [] });
  });

  it("records the whole document and gives it back on another computer, for a work it does not have", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254, 10, 13, 0]);
    const doc = await a.resolve({ id: "doc-9", path: "/desk/Novel.highland", text: script });
    const files = {
      scriptName: "text.md",
      script: "# One\n\nText.\n",
      bin: ["cut", "kept"],
      scratchpad: "notes",
      others: [
        { path: "info.json", data: new TextEncoder().encode('{"version":2}') },
        { path: "assets/pics/cover.png", data: png },
        { path: "assets/map.png", data: png },
      ],
    };
    await a.commit(doc.id, files, "save");
    await new Mirror(a, remote).push();

    const b = new History(await temp());
    await b.exclusive(() => new Mirror(b, remote).pull());
    const works = await b.works();
    const work = works.find((w) => w.branch === doc.branch)!;
    expect(work).toMatchObject({ id: "doc-9", title: "Novel", paths: [] });
    const back = await b.filesAt(work.latest!.hash);
    expect(back).toMatchObject({ scriptName: "text.md", script: files.script, bin: ["cut", "kept"], scratchpad: "notes" });
    const byPath = Object.fromEntries(back.others!.map((o) => [o.path, o.data]));
    expect(Object.keys(byPath).sort()).toEqual(["assets/map.png", "assets/pics/cover.png", "info.json"]);
    expect(Buffer.from(byPath["assets/pics/cover.png"]!).equals(Buffer.from(png))).toBe(true);

    // Restored at a path on b: claimed under its own ID, and later saves continue its branch.
    expect(await b.claim(work, "/laptop/Novel.highland")).toBe("doc-9");
    expect(await b.resolve({ id: "doc-9", path: "/laptop/Novel.highland", text: files.script })).toMatchObject({ branch: doc.branch, created: false });
    expect((await b.works()).find((w) => w.branch === doc.branch)!.paths).toEqual(["/laptop/Novel.highland"]);
  });

  it("bundles one work's history alone", async () => {
    const h = new History(await temp());
    const doc = await h.resolve({ id: "doc-2", path: "/w/A.highland", text: script });
    await h.commit(doc.id, { scriptName: "text.fountain", script }, "save");
    const file = join(await temp(), "A.bundle");
    await h.bundle(doc.id, file);
    expect(gitIn(h.folder, "bundle", "list-heads", file)).toContain(doc.branch);
    expect(gitIn(h.folder, "bundle", "list-heads", file)).not.toContain("main");
  });
});
