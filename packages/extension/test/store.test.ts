import { textHash } from "@highwater/history";
import { chmod, copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle, readBundle, writeBundle } from "@highwater/bundle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BundleStore, splitBundlePath } from "../src/store.ts";

const fixture = fileURLToPath(new URL("../../../fixtures/generated/ScreenplayEdgeCases.highland", import.meta.url));
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

let dir: string;
let file: string;
let backups: string;
let store: BundleStore;
let clock = 0;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "highwater-store-"));
  file = join(dir, "Script.highland");
  backups = join(dir, "backups");
  await copyFile(fixture, file);
  clock = 0;
  store = new BundleStore({ backupFolder: () => backups, now: () => new Date(Date.UTC(2026, 9, 10, 9, 0, clock++)), debounceMs: 20 });
});

afterEach(async () => {
  store.dispose();
  await chmod(dir, 0o755).catch(() => {});
  await rm(dir, { recursive: true, force: true });
});

/** Another program (Highland) saving the file. */
async function externalSave(change: (b: HighlandBundle) => void): Promise<void> {
  const { bundle } = await readBundle(file);
  change(bundle);
  await new Promise((r) => setTimeout(r, 15)); // a later mtime
  await writeBundle(file, bundle);
}

describe("BundleStore", () => {
  it("reads the script, entries and folders", async () => {
    const original = (await readBundle(file)).bundle;
    expect(dec(await store.read(file))).toBe(original.text);
    expect(dec(await store.read(file, "info.json"))).toBe(original.getText("info.json"));
    expect((await store.stat(file)).size).toBe(enc(original.text).byteLength);
    expect((await store.list(file)).map((e) => e.name).sort()).toEqual(["characters.json", "info.json", "navigatorFilters.json", "sprints.json", "text.fountain"]);
    await expect(store.read(file, "bin/0.txt")).rejects.toThrow("has no bin/0.txt");
  });

  it("saves the script and keeps every other entry byte for byte", async () => {
    const before = (await readBundle(file)).bundle;
    await store.write(file, "", enc("INT. NEW - DAY\n\nChanged."));
    const after = (await readBundle(file)).bundle;
    expect(after.text).toBe("INT. NEW - DAY\n\nChanged.");
    for (const p of before.paths) if (p !== "text.fountain" && p !== "info.json") expect(after.get(p)).toEqual(before.get(p));
    expect(dec(await store.read(file))).toBe("INT. NEW - DAY\n\nChanged.");
    // info.json changes only by noting which text was saved.
    const { highwaterToo, ...rest } = after.info as { highwaterToo?: { savedText?: string } };
    expect(highwaterToo?.savedText).toBe(textHash("INT. NEW - DAY\n\nChanged."));
    expect(rest).toEqual(before.info);
  });

  it("backs up the original once per session and keeps the newest 10", async () => {
    const original = await readFile(file);
    await store.write(file, "", enc("one"));
    await store.write(file, "", enc("two"));
    const folder = join(backups, "Script");
    let names = await readdir(folder);
    expect(names).toEqual(["2026-10-10T09-00-00.highland"]);
    expect(await readFile(join(folder, names[0]!))).toEqual(original);
    for (let i = 0; i < 12; i++) {
      const next = new BundleStore({ backupFolder: () => backups, now: () => new Date(Date.UTC(2026, 9, 11, 9, 0, i)) });
      await next.write(file, "", enc(`session ${i}`));
      next.dispose();
    }
    names = await readdir(folder);
    expect(names).toHaveLength(10);
    expect(names.at(-1)).toBe("2026-10-11T09-00-11.highland");
  });

  it("queues writes to the same bundle", async () => {
    await Promise.all([store.write(file, "", enc("script")), store.write(file, "scratchpad.txt", enc("notes")), store.write(file, "bin/0.txt", enc("cut line"))]);
    const after = (await readBundle(file)).bundle;
    expect([after.text, after.scratchpad, after.binItems]).toEqual(["script", "notes", ["cut line"]]);
  });

  it("reports which entries another program changed, and reloads them", async () => {
    await store.read(file);
    const seen: string[][] = [];
    store.onExternalChange((_p, entries) => seen.push(entries));
    await externalSave((b) => (b.text = "Highland's edit"));
    await store.checkDisk(file);
    expect(seen).toEqual([[""]]);
    expect(dec(await store.read(file))).toBe("Highland's edit");
  });

  it("does not treat a settings-only save by Highland as a script change", async () => {
    const textTime = (await store.stat(file)).mtime;
    const seen: string[][] = [];
    store.onExternalChange((_p, entries) => seen.push(entries));
    await externalSave((b) => b.setHighlandSettings({ ...b.highlandSettings, cursorPosition: 42 }));
    await store.checkDisk(file);
    expect(seen).toEqual([["info.json"]]);
    expect((await store.stat(file)).mtime).toBe(textTime);
  });

  it("applies a save on top of another program's changes to other entries", async () => {
    await store.read(file);
    await externalSave((b) => (b.scratchpad = "from Highland"));
    await store.write(file, "", enc("from VS Code"));
    const after = (await readBundle(file)).bundle;
    expect([after.text, after.scratchpad]).toEqual(["from VS Code", "from Highland"]);
  });

  it("leaves the file untouched when the save fails", async () => {
    if (process.getuid?.() === 0) return; // root ignores folder permissions
    const original = await readFile(file);
    await store.read(file);
    await store.write(file, "", enc("first")); // backup made while the folder is writable
    const saved = await readFile(file);
    await chmod(dir, 0o555);
    await expect(store.write(file, "", enc("second"))).rejects.toThrow();
    await chmod(dir, 0o755);
    expect(await readFile(file)).toEqual(saved);
    expect(dec(await store.read(file))).toBe("first");
    expect(saved).not.toEqual(original);
  });

  it("saves a copy under a new name and leaves the original alone", async () => {
    const original = await readFile(file);
    const target = join(dir, "Copy.highland");
    await store.writeCopy(file, "", enc("my version"), target);
    expect(await readFile(file)).toEqual(original);
    const copy = (await readBundle(target)).bundle;
    expect(copy.text).toBe("my version");
    expect(copy.originalFolder).toBe("Copy.textbundle");
  });

  it("notices changes through the folder watcher", async () => {
    await store.read(file);
    const stop = store.watch(file);
    const changed = new Promise<string[]>((resolve) => store.onExternalChange((_p, e) => resolve(e)));
    await externalSave((b) => (b.text = "watched"));
    const entries = await Promise.race([changed, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    stop();
    expect(entries).toEqual([""]);
  });

  it("ignores its own saves while watching", async () => {
    await store.read(file);
    const stop = store.watch(file);
    const seen: string[][] = [];
    store.onExternalChange((_p, e) => seen.push(e));
    await store.write(file, "", enc("mine"));
    await new Promise((r) => setTimeout(r, 300));
    stop();
    expect(seen).toEqual([]);
  });
});

describe("splitBundlePath", () => {
  it("splits a highland: path into the file and the entry", () => {
    expect(splitBundlePath("/Users/ej/My Script.highland")).toEqual({ bundle: "/Users/ej/My Script.highland", entry: "" });
    expect(splitBundlePath("/Users/ej/My Script.highland/bin/0.txt")).toEqual({ bundle: "/Users/ej/My Script.highland", entry: "bin/0.txt" });
    expect(splitBundlePath("/Users/ej/notes.txt")).toBeNull();
  });
});
