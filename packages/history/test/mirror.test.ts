import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formOf, History, Mirror, parseRemote } from "../src/index.ts";

const temp = () => mkdtemp(join(tmpdir(), "highwater-mirror-"));
const gitIn = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
const script = "INT. HOUSE - DAY\n\nShe enters.\n";
const meta = (file: string) => ({ form: formOf(file), file });

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
    await a.commit(doc.id, { scriptName: "text.fountain", script }, "save", new Date(), undefined, meta("Script.highland"));

    const missing = await new Mirror(a, remote).push();
    expect(missing).toMatchObject({ ok: false, missing: true });

    execFileSync("git", ["init", "-q", "--bare", remote]);
    expect(await new Mirror(a, remote).push()).toMatchObject({ ok: true });
    expect(gitIn(remote, "rev-parse", doc.branch)).toBe(gitIn(a.repo, "rev-parse", doc.branch));
    expect(gitIn(remote, "show", "main:README.md")).toContain("Writing history");
    expect(gitIn(remote, "show", "main:README.md")).toContain(doc.branch);

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

  it("pulls main and the works this computer has, and fetches others only when asked", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    // Nothing pushed yet: nothing to pull, and that is not an error.
    expect(await a.exclusive(() => new Mirror(a, remote).pull())).toEqual({ ok: true, updated: [], removed: [] });

    const doc = await a.resolve({ id: "doc-1", path: "/desk/Script.highland", text: script });
    await a.commit(doc.id, { scriptName: "text.fountain", script }, "save", new Date(), undefined, meta("Script.highland"));
    const notes = await a.resolve({ id: null, path: "/desk/Notes.md", text: "# Notes\n" });
    await a.commit(notes.id, { scriptName: "text.md", script: "# Notes\n" }, "save", new Date(), undefined, meta("Notes.md"));
    expect(await a.exclusive(() => new Mirror(a, remote).push())).toMatchObject({ ok: true });

    // A new computer pulls only main: it knows of both works, but holds neither.
    const b = new History(await temp());
    const mirror = new Mirror(b, remote);
    expect(await b.exclusive(() => mirror.pull())).toEqual({ ok: true, updated: ["main"], removed: [] });
    expect(gitIn(b.repo, "for-each-ref", "--format=%(refname)", "refs/heads/works/", "refs/mirror/works/")).toBe("");
    const works = await b.works();
    expect(works.map((w) => [w.title, w.local, w.form, w.file]).sort()).toEqual([["Notes", false, "md", "Notes.md"], ["Script", false, "highland", "Script.highland"]]);

    // Asked for one: only that one comes, whole.
    await b.exclusive(() => mirror.fetchWork(doc.branch));
    expect(gitIn(b.repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/works/")).toBe(doc.branch);
    expect((await b.claim({ id: "doc-1", branch: doc.branch }, "/laptop/Script.highland"))).toBe("doc-1");
    expect((await b.log("doc-1")).map((c) => c.hash)).toEqual((await a.log("doc-1")).map((c) => c.hash));
    // Later pulls bring that work's saves, still not the other's.
    await a.commit(doc.id, { scriptName: "text.fountain", script: `${script}\nTwo.\n` }, "save", new Date(), undefined, meta("Script.highland"));
    await a.commit(notes.id, { scriptName: "text.md", script: "# Notes\n\nMore.\n" }, "save", new Date(), undefined, meta("Notes.md"));
    await a.exclusive(() => new Mirror(a, remote).push());
    const pulled = await b.exclusive(() => mirror.pull());
    expect(pulled.ok && pulled.updated.sort()).toEqual([doc.branch, "main"].sort());
    expect(gitIn(b.repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/works/")).toBe(doc.branch);
  });

  it("pull moves a branch forward, or joins one both computers moved, losing nothing", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const b = new History(await temp());
    const doc = await a.resolve({ id: "doc-1", path: "/a/S.highland", text: script });
    await a.commit(doc.id, { scriptName: "text.fountain", script }, "save", new Date(), undefined, meta("S.highland"));
    await a.exclusive(() => new Mirror(a, remote).push());
    await b.exclusive(() => new Mirror(b, remote).fetchWork(doc.branch));
    await b.claim({ id: "doc-1", branch: doc.branch }, "/b/S.highland");

    // a saves again: b is behind and simply moves forward.
    await a.commit(doc.id, { scriptName: "text.fountain", script: `${script}\nTwo.\n` }, "save", new Date(), undefined, meta("S.highland"));
    await a.exclusive(() => new Mirror(a, remote).push());
    let pulled = await b.exclusive(() => new Mirror(b, remote).pull());
    expect(pulled.ok && pulled.updated).toContain(doc.branch);
    expect(gitIn(b.repo, "rev-parse", doc.branch)).toBe(gitIn(a.repo, "rev-parse", doc.branch));

    // Both save: pulling joins them; b's own commit and text stay.
    await a.commit(doc.id, { scriptName: "text.fountain", script: `${script}\nThree on a.\n` }, "save", new Date(), undefined, meta("S.highland"));
    await a.exclusive(() => new Mirror(a, remote).push());
    const mine = await b.commit("doc-1", { scriptName: "text.fountain", script: `${script}\nThree on b.\n` }, "save", new Date(), undefined, meta("S.highland"));
    pulled = await b.exclusive(() => new Mirror(b, remote).pull());
    expect(pulled.ok && pulled.updated).toContain(doc.branch);
    const head = gitIn(b.repo, "rev-parse", doc.branch);
    expect(gitIn(b.repo, "merge-base", "--is-ancestor", mine!.hash, head) === "").toBe(true);
    expect(gitIn(b.repo, "merge-base", "--is-ancestor", gitIn(a.repo, "rev-parse", doc.branch), head) === "").toBe(true);
    expect(gitIn(b.repo, "show", `${doc.branch}:text.fountain`)).toContain("Three on b.");
    // Both computers' catalogs, joined: every save's text is listed once b pushes.
    await b.exclusive(() => new Mirror(b, remote).push());
    await a.exclusive(() => new Mirror(a, remote).pull());
    const [entry] = (await a.catalog()).filter((e) => e.branch === doc.branch);
    expect(entry!.texts.length).toBe(4);
    // Nothing new: nothing changes.
    expect(await b.exclusive(() => new Mirror(b, remote).pull())).toEqual({ ok: true, updated: [], removed: [] });
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
    await a.commit(doc.id, files, "save", new Date(), undefined, meta("Novel.highland"));
    await a.exclusive(() => new Mirror(a, remote).push());

    const b = new History(await temp());
    await b.exclusive(() => new Mirror(b, remote).pull());
    const work = (await b.works()).find((w) => w.branch === doc.branch)!;
    expect(work).toMatchObject({ id: "doc-9", title: "Novel", paths: [], local: false });
    await b.exclusive(() => new Mirror(b, remote).fetchWork(work.branch));
    const latest = (await b.branchLog(work.branch, 1))[0]!;
    const back = await b.filesAt(latest.hash);
    expect(back).toMatchObject({ scriptName: "text.md", script: files.script, bin: ["cut", "kept"], scratchpad: "notes" });
    const byPath = Object.fromEntries(back.others!.map((o) => [o.path, o.data]));
    expect(Object.keys(byPath).sort()).toEqual(["assets/map.png", "assets/pics/cover.png", "info.json"]);
    expect(Buffer.from(byPath["assets/pics/cover.png"]!).equals(Buffer.from(png))).toBe(true);

    // Restored at a path on b: claimed under its own ID, and later saves continue its branch.
    expect(await b.claim(work, "/laptop/Novel.highland")).toBe("doc-9");
    expect(await b.resolve({ id: "doc-9", path: "/laptop/Novel.highland", text: files.script })).toMatchObject({ branch: doc.branch, created: false });
    expect((await b.works()).find((w) => w.branch === doc.branch)!).toMatchObject({ paths: ["/laptop/Novel.highland"], local: true });
  });

  it("removes a work from this computer, or deletes it everywhere, leaving none of its data", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const b = new History(await temp());
    const secret = "A text found in no other work: the lighthouse keeper's last letter.\n";
    const doc = await a.resolve({ id: "doc-7", path: "/a/Letter.md", text: secret });
    const c = await a.commit(doc.id, { scriptName: "text.md", script: secret }, "save", new Date(), undefined, meta("Letter.md"));
    await a.exclusive(() => new Mirror(a, remote).push());
    await b.exclusive(() => new Mirror(b, remote).fetchWork(doc.branch));
    await b.claim({ id: "doc-7", branch: doc.branch }, "/b/Letter.md");
    await b.exclusive(() => new Mirror(b, remote).pull());
    const gone = (h: History, rev: string) => {
      try {
        gitIn(h.repo, "cat-file", "-e", rev);
        return false;
      } catch {
        return true;
      }
    };
    expect(gone(b, c!.hash)).toBe(false);

    // Remove from this computer: gone here, still on the mirror, and offered again.
    expect(await b.remove({ id: "doc-7", branch: doc.branch })).toEqual(["/b/Letter.md"]);
    expect(gone(b, c!.hash)).toBe(true);
    expect((await b.works()).find((w) => w.branch === doc.branch)).toMatchObject({ local: false });
    expect(await b.recognise({ id: "doc-7", path: "/b/Letter.md", text: secret })).toMatchObject([{ by: "id", local: false }]);

    // Deleted everywhere: the mirror's branch goes, and b drops its copy when it pulls.
    await b.exclusive(() => new Mirror(b, remote).fetchWork(doc.branch));
    await b.claim({ id: "doc-7", branch: doc.branch }, "/b/Letter.md");
    expect(await a.deleteWork({ id: "doc-7", branch: doc.branch })).toEqual({ branch: doc.branch, paths: ["/a/Letter.md"] });
    await a.exclusive(async () => {
      await new Mirror(a, remote).deleteRemote(doc.branch);
      return new Mirror(a, remote).push();
    });
    expect(gone(a, c!.hash)).toBe(true);
    expect(() => gitIn(remote, "rev-parse", "--verify", doc.branch)).toThrow();
    expect(await b.exclusive(() => new Mirror(b, remote).pull())).toMatchObject({ ok: true, removed: [{ id: "doc-7", paths: ["/b/Letter.md"] }] });
    expect(await b.applyDeletions()).toEqual([]);
    expect(gone(b, c!.hash)).toBe(true);
    expect((await b.works()).find((w) => w.branch === doc.branch)).toBeUndefined();
    // A file still naming the deleted work starts a new history.
    const again = await b.resolve({ id: "doc-7", path: "/b/Letter.md", text: secret });
    expect(again.id).not.toBe("doc-7");
    expect(again.branch).not.toBe(doc.branch);
  });

  it("deleting everywhere a work fetched here but never opened leaves nothing to push back", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const doc = await a.resolve({ id: "doc-9", path: "/a/Note.md", text: script });
    await a.commit(doc.id, { scriptName: "text.md", script }, "save", new Date(), undefined, meta("Note.md"));
    await a.exclusive(() => new Mirror(a, remote).push());

    // b fetches the work (a restore it then cancelled), so its branch is here with no index entry.
    const b = new History(await temp());
    await b.exclusive(() => new Mirror(b, remote).pull());
    await b.exclusive(() => new Mirror(b, remote).fetchWork(doc.branch));
    expect((await b.works()).find((w) => w.branch === doc.branch)).toMatchObject({ local: true });
    await b.deleteWork({ id: "doc-9", branch: doc.branch });
    expect(() => gitIn(b.repo, "rev-parse", "--verify", `refs/heads/${doc.branch}`)).toThrow();
    await b.exclusive(async () => {
      await new Mirror(b, remote).deleteRemote(doc.branch);
      return new Mirror(b, remote).push();
    });
    expect(() => gitIn(remote, "rev-parse", "--verify", doc.branch)).toThrow();
  });

  it("a computer that pushes before it pulls does not bring a deleted work back", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const doc = await a.resolve({ id: "doc-10", path: "/a/Play.fountain", text: script });
    await a.commit(doc.id, { scriptName: "text.fountain", script }, "save", new Date(2026, 9, 1), undefined, meta("Play.fountain"));
    await a.exclusive(() => new Mirror(a, remote).push());
    const b = new History(await temp());
    await b.exclusive(() => new Mirror(b, remote).fetchWork(doc.branch));
    await b.claim({ id: "doc-10", branch: doc.branch }, "/b/Play.fountain");

    // a deletes it everywhere; b saves and pushes without pulling first.
    await a.deleteWork({ id: "doc-10", branch: doc.branch });
    await a.exclusive(async () => {
      await new Mirror(a, remote).deleteRemote(doc.branch);
      return new Mirror(a, remote).push();
    });
    await b.commit("doc-10", { scriptName: "text.fountain", script: `${script}More.\n` }, "save", new Date(2026, 9, 2), undefined, meta("Play.fountain"));
    expect(await b.exclusive(() => new Mirror(b, remote).push())).toMatchObject({ ok: true, removed: [{ id: "doc-10", paths: ["/b/Play.fountain"] }] });
    expect(() => gitIn(remote, "rev-parse", "--verify", doc.branch)).toThrow();
    expect((await b.works()).find((w) => w.branch === doc.branch)).toBeUndefined();
    // And a mirror that has it back (pushed by an older version) loses it on the next push.
    gitIn(b.repo, "update-ref", `refs/heads/${doc.branch}`, gitIn(a.repo, "rev-parse", "main"));
    execFileSync("git", ["push", "-q", remote, `refs/heads/${doc.branch}:refs/heads/${doc.branch}`], { cwd: b.repo });
    await a.exclusive(() => new Mirror(a, remote).push());
    expect(() => gitIn(remote, "rev-parse", "--verify", doc.branch)).toThrow();
  });

  it("does not fetch a work deleted since this computer last pulled", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const doc = await a.resolve({ id: "doc-11", path: "/a/Story.md", text: script });
    await a.commit(doc.id, { scriptName: "text.md", script }, "save", new Date(), undefined, meta("Story.md"));
    await a.exclusive(() => new Mirror(a, remote).push());
    const b = new History(await temp());
    await b.exclusive(() => new Mirror(b, remote).pull());
    expect((await b.works()).find((w) => w.branch === doc.branch)).toMatchObject({ local: false });
    await a.deleteWork({ id: "doc-11", branch: doc.branch });
    await a.exclusive(async () => {
      await new Mirror(a, remote).deleteRemote(doc.branch);
      return new Mirror(a, remote).push();
    });
    // b's catalog is stale: it still lists the work, but fetching it finds the deletion first.
    expect((await b.works()).find((w) => w.branch === doc.branch)).toBeDefined();
    expect(await b.exclusive(() => new Mirror(b, remote).fetchWork(doc.branch))).toMatchObject({ deleted: true });
    expect((await b.works()).find((w) => w.branch === doc.branch)).toBeUndefined();
  });

  it("deleting on this computer only keeps the work from coming back here", async () => {
    const h = new History(await temp());
    const doc = await h.resolve({ id: "doc-8", path: "/w/Draft.md", text: script });
    await h.commit(doc.id, { scriptName: "text.md", script }, "save", new Date(), undefined, meta("Draft.md"));
    await h.flushCatalog();
    await h.remove({ id: "doc-8", branch: doc.branch }, { exclude: true });
    expect(await h.recognise({ id: "doc-8", path: "/w/Draft.md", text: script })).toEqual([]);
    expect((await h.resolve({ id: "doc-8", path: "/w/Draft.md", text: script })).id).not.toBe("doc-8");
  });

  it("finds a history started from a copy of another work's save, and joins the two", async () => {
    const remote = join(await temp(), "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote]);
    const a = new History(await temp());
    const text = Array.from({ length: 60 }, (_, i) => `Line ${i}.`).join("\n") + "\n";
    const doc = await a.resolve({ id: "doc-a", path: "/a/Play.fountain", text });
    await a.commit(doc.id, { scriptName: "text.fountain", script: text }, "save", new Date(2026, 9, 1), undefined, meta("Play.fountain"));
    await a.commit(doc.id, { scriptName: "text.fountain", script: `${text}On a.\n` }, "save", new Date(2026, 9, 2), undefined, meta("Play.fountain"));
    await a.exclusive(() => new Mirror(a, remote).push());

    // b got a copy of the first save and worked on it with no mirror: a history of its own.
    const b = new History(await temp());
    const copy = await b.resolve({ id: null, path: "/b/Play copy.fountain", text });
    await b.commit(copy.id, { scriptName: "text.fountain", script: text }, "save", new Date(2026, 9, 3), undefined, meta("Play copy.fountain"));
    const mine = await b.commit(copy.id, { scriptName: "text.fountain", script: `${text}On b.\n` }, "save", new Date(2026, 9, 4), undefined, meta("Play copy.fountain"));
    await b.exclusive(() => new Mirror(b, remote).pull());
    const [candidate] = await b.copyCandidates();
    expect(candidate).toMatchObject({ id: copy.id, branch: copy.branch, other: { id: "doc-a", branch: doc.branch } });

    await b.exclusive(() => new Mirror(b, remote).fetchWork(doc.branch));
    expect(await b.join(copy.id, candidate!.other, meta("Play copy.fountain"))).toBe("doc-a");
    const head = gitIn(b.repo, "rev-parse", doc.branch);
    expect(gitIn(b.repo, "merge-base", "--is-ancestor", mine!.hash, head) === "").toBe(true);
    expect(gitIn(b.repo, "merge-base", "--is-ancestor", gitIn(a.repo, "rev-parse", doc.branch), head) === "").toBe(true);
    expect(gitIn(b.repo, "show", `${doc.branch}:text.fountain`)).toContain("On b.");
    expect(() => gitIn(b.repo, "rev-parse", "--verify", copy.branch)).toThrow();
    expect((await b.find({ id: null, path: "/b/Play copy.fountain", text: "" }))?.id).toBe("doc-a");
    expect(await b.copyCandidates()).toEqual([]);
    // Declined pairs are not offered again.
    const c2 = new History(await temp());
    const other = await c2.resolve({ id: null, path: "/c/P.fountain", text });
    await c2.commit(other.id, { scriptName: "text.fountain", script: text }, "save", new Date(), undefined, meta("P.fountain"));
    await c2.exclusive(() => new Mirror(c2, remote).pull());
    const [c2Candidate] = await c2.copyCandidates();
    await c2.notJoin(other.branch, c2Candidate!.other.branch);
    expect(await c2.copyCandidates()).toEqual([]);
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
