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
