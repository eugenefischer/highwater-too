/**
 * A document's Bin, Scratchpad and images, kept inside a .highland file or, for a plain .fountain
 * file, in the writing history's extras folder and a folder of images beside the file. These tests
 * pin what each operation leaves on disk, for both kinds of document, so the code behind them can
 * change without the writer's files changing.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocument, readBundle, writeBundle } from "@highwater/bundle";
import { History } from "@highwater/history";
import { beforeEach, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { AssetsView, BinView, type Owner } from "../src/bin-assets.ts";
import { plainExtras, startPlainExtras } from "../src/extras.ts";
import type { HighlandFileSystem } from "../src/fs-provider.ts";
import type { FocusedDocument } from "../src/focus.ts";
import { BundleStore } from "../src/store.ts";

const stub = vscode as unknown as { shown: { kind: string; message: string; choices: string[] }[]; answers: (string | undefined)[]; workspace: Record<string, unknown> };
// Assets removed from a plain file's folder go to the Trash: here, simply deleted.
stub.workspace.fs = { delete: (uri: vscode.Uri) => rm(uri.fsPath) };

const image = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]);

interface World {
  dir: string;
  store: BundleStore;
  bundle: string;
  plain: string;
  history: History;
  fired: { bundle: string; entries: string[] }[];
  bin(owner: Owner): BinView;
  assets(owner: Owner): AssetsView;
}

async function world(): Promise<World> {
  const dir = await mkdtemp(join(tmpdir(), "highwater-extras-world-"));
  const store = new BundleStore({ backupFolder: () => join(dir, "backups") });
  const bundle = join(dir, "Script.highland");
  await writeBundle(bundle, createDocument({ mode: "fountain", template: "Screenplay", text: "INT. HALL - DAY\n\nHello." }));
  const plain = join(dir, "Plain.fountain");
  await writeFile(plain, "INT. KITCHEN - NIGHT\n\nGoodbye.");
  const history = new History(join(dir, "history"));
  const state = new Map<string, unknown>();
  const context = {
    subscriptions: [] as { dispose(): unknown }[],
    globalStorageUri: vscode.Uri.file(join(dir, "storage")),
    globalState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => void state.set(k, v) },
  } as unknown as vscode.ExtensionContext;
  startPlainExtras(context, { history: () => history, historyRoot: () => join(dir, "history") });
  const fired: World["fired"] = [];
  const fs = { fireChanged: (b: string, entries: string[]) => fired.push({ bundle: b, entries }) } as unknown as HighlandFileSystem;
  const current = (owner: Owner) => ({ bundle: owner.bundle, plain: owner.plain }) as unknown as FocusedDocument;
  return { dir, store, bundle, plain, history, fired, bin: (o) => new BinView(store, fs, current(o)), assets: (o) => new AssetsView(store, current(o)) };
}

let w: World;
beforeEach(async () => {
  w = await world();
  stub.shown.length = 0;
  stub.answers.length = 0;
});

const texts = async (bin: BinView, owner: Owner) => (await bin.items(owner)).map((i) => i.text);

describe("the Bin of a .highland file", () => {
  it("adds, moves, edits and removes items inside the file, telling open item tabs", async () => {
    const owner: Owner = { bundle: w.bundle };
    const bin = w.bin(owner);
    expect(await texts(bin, owner)).toEqual([]);
    expect(await bin.add("one")).toBe(true);
    expect(await bin.add("two")).toBe(true);
    expect(stub.shown).toEqual([]); // nothing to confirm
    await bin.reorder(0, 1);
    expect(await texts(bin, owner)).toEqual(["two", "one"]);
    await bin.edit(owner, 1, "ONE");
    stub.answers.push("Delete");
    await bin.remove((await bin.items(owner))[0]!);
    expect(await texts(bin, owner)).toEqual(["ONE"]);
    const saved = (await readBundle(w.bundle)).bundle;
    expect(saved.binItems).toEqual(["ONE"]);
    expect(saved.text).toBe("INT. HALL - DAY\n\nHello.");
    expect(w.fired.at(-1)).toEqual({ bundle: w.bundle, entries: ["bin/0.txt", "bin/1.txt"] });
  });

  it("keeps an item when Delete is not chosen", async () => {
    const owner: Owner = { bundle: w.bundle };
    const bin = w.bin(owner);
    await bin.add("keep");
    await bin.remove((await bin.items(owner))[0]!);
    expect(await texts(bin, owner)).toEqual(["keep"]);
  });
});

describe("the Bin of a plain file", () => {
  it("asks once before the first item, then keeps items in the history's extras folder", async () => {
    const owner: Owner = { plain: w.plain };
    const bin = w.bin(owner);
    expect(await texts(bin, owner)).toEqual([]);
    stub.answers.push("Continue");
    expect(await bin.add("one")).toBe(true);
    expect(stub.shown.map((s) => s.choices)).toEqual([["Continue", "Convert to .highland File…"]]);
    expect(await bin.add("two")).toBe(true);
    expect(stub.shown.length).toBe(1); // asked once
    await bin.reorder(0, 1);
    await bin.edit(owner, 0, "TWO");
    expect(await texts(bin, owner)).toEqual(["TWO", "one"]);
    const folder = (await plainExtras().folder(w.plain))!;
    expect(folder.dir.startsWith(join(w.dir, "history", "extras"))).toBe(true);
    expect(await folder.binItems()).toEqual(["TWO", "one"]);
    expect(await readFile(w.plain, "utf8")).toBe("INT. KITCHEN - NIGHT\n\nGoodbye."); // the file itself is untouched
    stub.answers.push("Delete");
    await bin.remove((await bin.items(owner))[1]!);
    expect(await folder.binItems()).toEqual(["TWO"]);
  });

  it("adds nothing, and makes no folder, when the first question is declined", async () => {
    const owner: Owner = { plain: w.plain };
    const bin = w.bin(owner);
    expect(await bin.add("one")).toBe(false);
    expect(await texts(bin, owner)).toEqual([]);
    expect(await plainExtras().folder(w.plain)).toBeNull();
  });
});

describe("the assets of a .highland file", () => {
  it("are kept in its assets/ folder, under names not already taken, and removed on Delete", async () => {
    const owner: Owner = { bundle: w.bundle };
    const assets = w.assets(owner);
    expect(await assets.list(owner)).toEqual([]);
    await assets.importFiles(owner, [{ name: "a.png", data: image(1) }]);
    await assets.importFiles(owner, [{ name: "a.png", data: image(2) }, { name: "b.png", data: image(3) }]);
    const list = await assets.list(owner);
    expect(list.map((a) => [a.name, a.folder, a.file])).toEqual([
      ["a 2.png", "assets", undefined],
      ["a.png", "assets", undefined],
      ["b.png", "assets", undefined],
    ]);
    expect(await assets.read(list[0]!)).toEqual(image(2));
    expect(assets.info(list[0]!)).toEqual({ size: expect.any(String), dimensions: undefined });
    stub.answers.push("Delete");
    await assets.remove(list[1]!);
    const saved = (await readBundle(w.bundle)).bundle;
    expect(saved.paths.filter((p) => p.startsWith("assets/")).sort()).toEqual(["assets/a 2.png", "assets/b.png"]);
    expect(stub.shown.map((s) => s.choices)).toEqual([["Delete"]]); // no question before adding
  });
});

describe("the assets of a plain file", () => {
  it("are kept in a folder beside the file, made when the first is added after the one question", async () => {
    const owner: Owner = { plain: w.plain };
    const assets = w.assets(owner);
    expect(await assets.list(owner)).toEqual([]);
    stub.answers.push("Continue");
    await assets.importFiles(owner, [{ name: "a.png", data: image(1) }]);
    await assets.importFiles(owner, [{ name: "a.png", data: image(2) }]);
    const dir = join(w.dir, "Plain assets");
    const list = await assets.list(owner);
    expect(list.map((a) => [a.name, a.folder, a.file])).toEqual([
      ["a 2.png", "Plain assets", join(dir, "a 2.png")],
      ["a.png", "Plain assets", join(dir, "a.png")],
    ]);
    expect(new Uint8Array(await readFile(join(dir, "a.png")))).toEqual(image(1));
    expect(new Uint8Array((await assets.read(list[0]!))!)).toEqual(image(2));
    stub.answers.push("Delete");
    await assets.remove(list[1]!);
    expect(existsSync(join(dir, "a.png"))).toBe(false);
    expect(existsSync(join(dir, "a 2.png"))).toBe(true);
  });

  it("adds nothing when the first question is declined", async () => {
    const owner: Owner = { plain: w.plain };
    const assets = w.assets(owner);
    await assets.importFiles(owner, [{ name: "a.png", data: image(1) }]);
    expect(existsSync(join(w.dir, "Plain assets"))).toBe(false);
  });
});
