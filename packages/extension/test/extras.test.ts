import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetsFolderName, detectAssetsFolder, ExtrasFolder, idNote, listAssets, noteId, relinkAssets, sameExtras, withoutIdNote } from "../src/extras-folder.ts";
import { assetMarkdown } from "../src/syntax/workspace.ts";

const temp = () => mkdtemp(join(tmpdir(), "highwater-extras-"));

describe("a plain file's extras folder", () => {
  it("keeps the Bin as numbered files, renumbering when items change", async () => {
    const f = new ExtrasFolder(join(await temp(), "extras", "id"));
    expect(f.exists).toBe(false);
    expect(await f.binItems()).toEqual([]);
    expect(await f.setBinItems(["a", "b", "c"])).toBe(0);
    expect(await f.binItems()).toEqual(["a", "b", "c"]);
    expect(await f.setBinItems(["c", "a"])).toBe(3);
    expect(await f.binItems()).toEqual(["c", "a"]);
    expect(existsSync(f.binPath(2))).toBe(false);
  });

  it("makes the Scratchpad on first use and keeps settings", async () => {
    const f = new ExtrasFolder(join(await temp(), "x"));
    expect(await f.scratchpad()).toBeUndefined();
    await f.ensureScratchpad();
    expect(await f.scratchpad()).toBe("");
    await writeFile(f.scratchpadPath, "ideas");
    await f.ensureScratchpad();
    expect(await f.scratchpad()).toBe("ideas");
    await f.updateSettings({ templateName: "Manuscript" });
    await f.updateSettings({ assetsFolder: "Script assets" });
    expect(await f.settings()).toEqual({ templateName: "Manuscript", assetsFolder: "Script assets" });
    // The template is in info.json, as a .highland file keeps it; the images folder's name stays local.
    const info = '{"com.quoteunquoteapps.highland2":{"templateName":"Manuscript"}}';
    expect(await f.files()).toEqual({ bin: [], scratchpad: "ideas", document: [{ path: "info.json", data: new TextEncoder().encode(info) }] });
    await f.updateSettings({ templateName: undefined });
    expect(await f.settings()).toEqual({ assetsFolder: "Script assets" });
  });

  it("is replaced by a save brought in from the history, and remembers that save", async () => {
    const f = new ExtrasFolder(join(await temp(), "x"));
    await f.setBinItems(["old 1", "old 2"]);
    await f.ensureScratchpad();
    await f.replace({ bin: ["new"] });
    expect(await f.files()).toEqual({ bin: ["new"] });
    expect(await f.base()).toBeNull();
    await f.setBase("abc123");
    expect(await f.base()).toBe("abc123");
    expect(sameExtras(await f.files(), { bin: ["new"] })).toBe(true);
    expect(sameExtras(await f.files(), { bin: ["new", "other"] })).toBe(false);
    expect(sameExtras({ bin: [], scratchpad: "" }, { bin: [] })).toBe(true);
  });

  it("keeps the rest of the .highland file it was converted from", async () => {
    const f = new ExtrasFolder(join(await temp(), "x"));
    expect(await f.document()).toEqual([]);
    const document = [
      { path: "info.json", data: new Uint8Array([123, 125]) },
      { path: "assets/deep/a.png", data: new Uint8Array([1]) },
    ];
    await f.replace({ bin: [], document });
    expect(await f.document()).toEqual([document[1], document[0]]);
    expect(sameExtras(await f.files(), { bin: [], document })).toBe(true);
    expect(sameExtras(await f.files(), { bin: [], document: [document[0]!] })).toBe(false);
    await f.replace({ bin: [] });
    expect(await f.document()).toEqual([]);
  });

  it("moves (from the stand-in place used while history is off) and is removed", async () => {
    const dir = await temp();
    const f = new ExtrasFolder(join(dir, "standin", "k"));
    await f.setBinItems(["kept"]);
    const g = await f.moveTo(join(dir, "history", "extras", "id"));
    expect(f.exists).toBe(false);
    expect(await g.binItems()).toEqual(["kept"]);
    await g.remove();
    expect(g.exists).toBe(false);
  });
});

describe("a plain file's images", () => {
  it("go in a folder named after the file, listed without hidden files", async () => {
    expect(assetsFolderName("/w/My Script.fountain")).toBe("My Script assets");
    const dir = join(await temp(), "My Script assets");
    expect(await listAssets(dir)).toEqual([]);
    await mkdir(dir);
    await writeFile(join(dir, "b.png"), "");
    await writeFile(join(dir, "a.jpg"), "");
    await writeFile(join(dir, ".DS_Store"), "");
    expect(await listAssets(dir)).toEqual(["a.jpg", "b.png"]);
    expect(assetMarkdown("a b.png", "My Script assets")).toBe("![a b](My%20Script%20assets/a%20b.png)");
  });

  it("are found in the folder the text refers to", () => {
    expect(detectAssetsFolder("![a](My%20Book%20assets/a.png) ![b](<My Book assets/b.png>) ![c](elsewhere/c.png)", ["a.png", "b.png"])).toBe("My Book assets");
    expect(detectAssetsFolder("![a](assets/a.png)", ["a.png"])).toBe("assets");
    expect(detectAssetsFolder("No images.", ["a.png"])).toBeNull();
  });

  it("are relinked when they move to another folder", () => {
    const text = "One ![map](My%20Script%20assets/map.png) and ![x](<My Script assets/x.png>) but not ![y](other/y.png).";
    expect(relinkAssets(text, "My Script assets", "assets")).toBe("One ![map](assets/map.png) and ![x](<assets/x.png>) but not ![y](other/y.png).");
    expect(relinkAssets("![a](assets/a.png)", "assets", "New (2) assets")).toBe("![a](New%20%282%29%20assets/a.png)");
    expect(relinkAssets(text, "same", "same")).toBe(text);
  });
});

describe("the note linking a plain file to its history", () => {
  const id = "1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d";
  it("names the document's ID", () => {
    expect(idNote(id)).toBe(`[[highwater: ${id}]]`);
    expect(noteId(`Text.\n\n[[highwater: ${id}]]\n`)).toBe(id);
    expect(noteId("[[a note]]")).toBeNull();
  });

  it("is taken out of the text when the file becomes a .highland file", () => {
    expect(withoutIdNote(`Text.\n\n[[highwater: ${id}]]\n`)).toBe("Text.\n");
    expect(withoutIdNote(`Text.\n\n[[highwater: ${id}]]`)).toBe("Text.\n");
    expect(withoutIdNote(`[[highwater: ${id}]]\n\nText.\n`)).toBe("\nText.\n");
    expect(withoutIdNote(`Text [[highwater: ${id}]] more.\n`)).toBe("Text more.\n");
    expect(withoutIdNote("No note.\n")).toBe("No note.\n");
  });
});
