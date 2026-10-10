import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BundleError, createDocument, HIGHLAND_KEY, HighlandBundle } from "../src/index.ts";
import { listZip } from "./zip-listing.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../fixtures/generated/${name}`, import.meta.url))));
const enc = (s: string) => new TextEncoder().encode(s);

function sample(extra: Record<string, Uint8Array | string> = {}): HighlandBundle {
  return HighlandBundle.fromEntries("Untitled.textbundle", [
    ["characters.json", "[]"],
    ["text.fountain", "INT. ROOM - DAY\r\n\r\nShe waits.{{REVISION: #ee2d36}} Changed.{{/REVISION}}"],
    ["info.json", JSON.stringify({ version: 2, type: "com.quoteunquoteapps.fountain", [HIGHLAND_KEY]: { templateName: "Screenplay" }, futureKey: { a: 1 } })],
    ["includes.dat", new Uint8Array([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x00, 0xff, 0x01])],
    ["revisions/current.json", '{"number":1}'],
    ["mystery/unknown.bin", new Uint8Array([1, 2, 3])],
    ...Object.entries(extra),
  ]);
}

describe("reading Highland's own files", () => {
  for (const name of ["ScreenplayEdgeCases.highland", "ManuscriptEdgeCases.highland"]) {
    it(`round-trips ${name} with every entry byte-identical and in order`, () => {
      const original = HighlandBundle.fromZip(fixture(name));
      const again = HighlandBundle.fromZip(original.toZip(name));
      expect(again.paths).toEqual(original.paths);
      for (const p of original.paths) expect(again.get(p)).toEqual(original.get(p));
    });
  }

  it("finds the script and its mode", () => {
    const screenplay = HighlandBundle.fromZip(fixture("ScreenplayEdgeCases.highland"));
    expect(screenplay.textPath).toBe("text.fountain");
    expect(screenplay.mode).toBe("fountain");
    expect(screenplay.text).toContain("INT. TEST KITCHEN - DAY #5#");
    const manuscript = HighlandBundle.fromZip(fixture("ManuscriptEdgeCases.highland"));
    expect(manuscript.mode).toBe("markdown");
    expect(manuscript.has("assets/test-image.png")).toBe(true);
  });
});

describe("writing", () => {
  it("uses Highland's layout: one folder named after the file, Deflate, no directory entries", () => {
    const listing = listZip(sample().toZip("My Script.highland"));
    expect(listing.every((e) => e.name.startsWith("My Script.textbundle/"))).toBe(true);
    expect(listing.some((e) => e.name.endsWith("/"))).toBe(false);
    expect(listing.every((e) => e.method === 8)).toBe(true);
    expect(listing.map((e) => e.name.split("/").slice(1).join("/"))).toEqual(sample().paths);
  });

  it("keeps unknown files, includes.dat and unknown info.json keys untouched", () => {
    const bundle = sample();
    bundle.setHighlandSettings({ ...bundle.highlandSettings, templateName: "Manuscript" });
    const again = HighlandBundle.fromZip(bundle.toZip("x.highland"));
    expect(again.get("includes.dat")).toEqual(sample().get("includes.dat"));
    expect(again.get("mystery/unknown.bin")).toEqual(new Uint8Array([1, 2, 3]));
    expect(again.info.futureKey).toEqual({ a: 1 });
    expect(again.highlandSettings.templateName).toBe("Manuscript");
  });

  it("keeps the revision cache while the text is unchanged", () => {
    const bundle = sample();
    bundle.text = bundle.text; // same text: not a change
    expect(bundle.textChanged).toBe(false);
    expect(HighlandBundle.fromZip(bundle.toZip("x.highland")).has("revisions/current.json")).toBe(true);
  });

  it("drops the revision cache when the text changes, keeping the inline tags", () => {
    const bundle = sample();
    bundle.text = bundle.text + "\r\n\r\nNew line.";
    const again = HighlandBundle.fromZip(bundle.toZip("x.highland"));
    expect(again.has("revisions/current.json")).toBe(false);
    expect(again.text).toContain("{{REVISION: #ee2d36}}");
  });

  it("preserves line endings exactly", () => {
    const again = HighlandBundle.fromZip(sample().toZip("x.highland"));
    expect(again.text.startsWith("INT. ROOM - DAY\r\n\r\n")).toBe(true);
  });

  it("does not rewrite info.json when nothing in it changed", () => {
    const raw = '{"version":2,"type":"public.plain.text"}';
    const bundle = HighlandBundle.fromEntries("A", [["text.txt", "x"], ["info.json", raw]]);
    bundle.setInfo(JSON.parse(raw));
    expect(bundle.getText("info.json")).toBe(raw);
  });
});

describe("Bin and Scratchpad", () => {
  it("reads Bin items in numeric order and renumbers on write", () => {
    const bundle = sample({ "bin/10.txt": "ten", "bin/2.txt": "two", "bin/0.txt": "zero" });
    expect(bundle.binItems).toEqual(["zero", "two", "ten"]);
    bundle.setBinItems(["b", "a"]);
    expect(bundle.binItems).toEqual(["b", "a"]);
    expect(bundle.paths.filter((p) => p.startsWith("bin/"))).toEqual(["bin/0.txt", "bin/1.txt"]);
  });

  it("reads and writes the Scratchpad", () => {
    const bundle = sample();
    expect(bundle.scratchpad).toBeUndefined();
    bundle.scratchpad = "ideas";
    expect(HighlandBundle.fromZip(bundle.toZip("x.highland")).scratchpad).toBe("ideas");
  });
});

describe("tolerant reading", () => {
  it("accepts a Finder re-zip with directory entries, __MACOSX and .DS_Store", () => {
    const zip = zipSync({
      "Doc.textbundle/": new Uint8Array(),
      "Doc.textbundle/text.md": enc("# Hi"),
      "Doc.textbundle/info.json": enc("{}"),
      "Doc.textbundle/.DS_Store": enc("junk"),
      "__MACOSX/Doc.textbundle/._text.md": enc("junk"),
    });
    const bundle = HighlandBundle.fromZip(zip);
    expect(bundle.paths).toEqual(["text.md", "info.json"]);
    expect(bundle.mode).toBe("markdown");
  });

  it("rejects archives without exactly one .textbundle folder", () => {
    expect(() => HighlandBundle.fromZip(zipSync({ "a/text.md": enc("x") }))).toThrow(BundleError);
    expect(() =>
      HighlandBundle.fromZip(zipSync({ "A.textbundle/text.md": enc("x"), "B.textbundle/text.md": enc("y") })),
    ).toThrow(/Several/);
    expect(() => HighlandBundle.fromZip(enc("not a zip"))).toThrow(BundleError);
  });
});

describe("createDocument", () => {
  it("matches the files Highland writes for a new screenplay", () => {
    const doc = createDocument({ mode: "fountain", template: "Screenplay" });
    expect(doc.paths).toEqual(["characters.json", "navigatorFilters.json", "text.fountain", "info.json", "sprints.json"]);
    expect(doc.info.type).toBe("com.quoteunquoteapps.fountain");
    expect(doc.highlandSettings.templateName).toBe("Screenplay");
  });

  it("uses text.md for a manuscript and only info.json plus text.txt for plain text", () => {
    expect(createDocument({ mode: "markdown", template: "Manuscript" }).textPath).toBe("text.md");
    expect(createDocument({ mode: "plain", template: "Plain Text" }).paths).toEqual(["text.txt", "info.json"]);
  });
});
