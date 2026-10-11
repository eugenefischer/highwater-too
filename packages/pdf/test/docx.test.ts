import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { defaultFontDir, layoutManuscript, manuscriptDocx, type DocxOptions } from "../src/index.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;
const date = new Date(2026, 9, 11);

const docx = (text: string, options: DocxOptions = {}) => unzipSync(manuscriptDocx(parse(text, { mode: "markdown" }), { date, ...options }));
const xml = (files: Record<string, Uint8Array>, name: string) => strFromU8(files[name]!);
const body = (text: string, options: DocxOptions = {}) => xml(docx(text, options), "word/document.xml");
/** Paragraph style ids in order. */
const styles = (doc: string) => [...doc.matchAll(/<w:p>(?:<w:pPr><w:pStyle w:val="([^"]+)"\/>)?/g)].map((m) => m[1]);

/** Every start tag closed in order: enough to catch broken XML. */
function wellFormed(text: string): boolean {
  const stack: string[] = [];
  for (const m of text.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) {
      if (stack.pop() !== m[2]) return false;
    } else stack.push(m[2]!);
  }
  return stack.length === 0;
}

describe("Word export", () => {
  it("writes a package whose XML parts are well formed", () => {
    const files = docx("Title: A Story\nAuthor: Someone\n\n# One\n\nFirst.\n\nSecond [link](https://example.com).\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |");
    for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/settings.xml", "word/numbering.xml", "word/fontTable.xml", "word/_rels/document.xml.rels", "docProps/core.xml"]) {
      expect(files[name], name).toBeDefined();
      expect(wellFormed(xml(files, name)), name).toBe(true);
    }
    for (const name of Object.keys(files).filter((n) => /header|footer/.test(n))) expect(wellFormed(xml(files, name)), name).toBe(true);
  });

  it("indents paragraphs after a paragraph, not after a heading or scene break", () => {
    expect(styles(body("One.\n\nTwo.\n\n# Head\n\nThree.\n\nFour.\n\n* * *\n\nFive."))).toEqual(["FirstParagraph", "BodyText", "Heading1", "FirstParagraph", "BodyText", "SceneBreak", "FirstParagraph"]);
  });

  it("uses Courier New double-spaced by default, and embeds Courier Prime when chosen", () => {
    const plain = docx("Text.");
    expect(xml(plain, "word/styles.xml")).toContain('w:ascii="Courier New"');
    expect(xml(plain, "word/styles.xml")).toContain('w:line="480" w:lineRule="auto"');
    expect(Object.keys(plain).some((n) => n.endsWith(".odttf"))).toBe(false);

    const prime = docx("Text.", { font: "Courier Prime", fontDir: defaultFontDir() });
    expect(xml(prime, "word/styles.xml")).toContain('w:ascii="Courier Prime"');
    expect(xml(prime, "word/settings.xml")).toContain("<w:embedTrueTypeFonts/>");
    // The embedded font is the .ttf with its first 32 bytes obfuscated by the key in fontTable.xml.
    const table = xml(prime, "word/fontTable.xml");
    const key = /<w:embedRegular r:id="([^"]+)" w:fontKey="\{([^}]+)\}"/.exec(table)!;
    const target = /Id="(\w+)"[^>]*Target="([^"]+)"/.exec(xml(prime, "word/_rels/fontTable.xml.rels"))!;
    expect(target[1]).toBe(key[1]);
    const hex = key[2]!.replace(/-/g, "");
    const bytes = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(30 - 2 * i, 32 - 2 * i), 16));
    const data = prime[`word/${target[2]}`]!.slice();
    for (let i = 0; i < 32; i++) data[i] = data[i]! ^ bytes[i % 16]!;
    expect(Buffer.from(data).equals(readFileSync(join(defaultFontDir(), "CourierPrime-Regular.ttf")))).toBe(true);
  });

  it("puts the title page in its own section with no header, and numbers the text from 1", () => {
    const doc = body("Title: A Story\nAuthor: Someone\nContact: me@example.com\nDraft date: 1 May\n\nText.");
    const sections = [...doc.matchAll(/<w:sectPr>(.*?)<\/w:sectPr>/g)].map((m) => m[1]!);
    expect(sections).toHaveLength(2);
    expect(sections[1]).toContain('<w:pgNumType w:start="1"/>');
    expect(sections[1]).toContain("<w:titlePg/>"); // no number on the first page of the text
    expect(doc.indexOf("A Story")).toBeLessThan(doc.indexOf("<w:sectPr>"));
  });

  it("writes {{HEADER}} with page-number and heading fields", () => {
    const files = docx("{{HEADER: Name / %# / %p}}\n\n# Chapter\n\nText.");
    const headers = Object.keys(files).filter((n) => /^word\/header\d+\.xml$/.test(n)).map((n) => xml(files, n));
    expect(headers.some((h) => h.includes('w:instr=" PAGE "') && h.includes('w:instr=" STYLEREF &quot;heading 1&quot; "') && h.includes("Name / "))).toBe(true);
  });

  it("starts a new page at ===, with the heading after it dropped", () => {
    const doc = body("Text.\n\n===\n\n# Two\n\nMore.");
    expect(doc).toMatch(/<w:pStyle w:val="Heading1"\/><w:pageBreakBefore\/><w:spacing w:before="3840"\/>/);
  });

  it("makes real lists, a table, links, highlights and a table of contents", () => {
    const files = docx("{{TOC}}\n\n# One\n\nSee [here](https://example.com) and +this+.\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n# Two\n\nEnd.");
    const doc = xml(files, "word/document.xml");
    expect(doc).toContain('<w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z </w:instrText>');
    expect(doc).toMatch(/<w:hyperlink r:id="rId\d+"/);
    expect(xml(files, "word/_rels/document.xml.rels")).toContain('Target="https://example.com" TargetMode="External"');
    expect(doc).toContain('<w:highlight w:val="yellow"/>');
    expect(doc.match(/<w:numId w:val="1"\/>/g)).toHaveLength(2);
    expect(xml(files, "word/numbering.xml")).toContain('<w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>');
    expect(doc).toContain("<w:tbl>");
    expect(doc).toContain('w:color="BCBEC0"');
  });

  it("embeds images at the PDF's size", () => {
    const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(join(generated, "ManuscriptEdgeCases.highland"))));
    const image = (src: string) => bundle.get(bundle.paths.find((p) => p.endsWith(src))!) ?? null;
    const files = unzipSync(manuscriptDocx(parse(bundle.text, { mode: "markdown" }), { date, image }));
    expect(Object.keys(files).some((n) => n.startsWith("word/media/"))).toBe(true);
    expect(xml(files, "word/document.xml")).toContain("<wp:inline");
  });

  // Word does its own page breaking; LibreOffice's pages should be close to ours.
  const soffice = (() => {
    try {
      execFileSync("soffice", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!soffice || !priv)("comes within a few pages of the PDF in LibreOffice", () => {
    const dir = mkdtempSync(join(tmpdir(), "docx-"));
    for (const [file, font] of [["SweetBetty_HighlandTest.highland", "Courier New"], ["ThePurityVariations_draft_1 copy.highland", "Courier Prime"]] as const) {
      const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(join(priv!, "Files with exports", file))));
      const doc = parse(bundle.text, { mode: "markdown" });
      const out = join(dir, file.replace(/\.highland$/, ".docx"));
      writeFileSync(out, manuscriptDocx(doc, { date, font, fontDir: defaultFontDir() }));
      execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, out], { stdio: "ignore", timeout: 120_000 });
      const pdf = readFileSync(out.replace(/\.docx$/, ".pdf"), "latin1");
      const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      const ours = layoutManuscript(doc, { date }).pages.length;
      expect(Math.abs(pages - ours), `${file}: ${pages} pages in LibreOffice, ${ours} in our PDF`).toBeLessThanOrEqual(Math.ceil(ours * 0.06));
    }
  }, 240_000);
});
