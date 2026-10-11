import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { comparePages, extractPages, formatReport, type PdfPage } from "@highwater/pdf-compare";
import { describe, expect, it } from "vitest";
import { imageSize, layoutManuscript, MANUSCRIPT, runsText, type Layout } from "../src/index.ts";
import { renderManuscript } from "./helpers.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

const layout = (text: string, options = {}): Layout => layoutManuscript(parse(text, { mode: "markdown" }), { date: new Date(2026, 8, 28), ...options });
/** Every text item as [page, x, y, text]. */
const items = (l: Layout) => l.pages.flatMap((p, i) => p.items.map((it) => [i, Math.round(it.x * 100) / 100, Math.round(it.y * 100) / 100, runsText(it.runs)] as const));
const paragraphs = (n: number, tag = "P") => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}.`).join("\n\n");

describe("manuscript layout", () => {
  it("double-spaces paragraphs and indents all but the first, and those after a heading or scene break", () => {
    expect(items(layout("One.\n\nTwo.\n\n# Head\n\nThree.\n\nFour.\n\n* * *\n\nFive."))).toEqual([
      [0, 72, 90, "One."],
      [0, 108, 118.32, "Two."],
      [0, 306 - 2 * 7.2, 146.64, "Head"],
      [0, 72, 198.96, "Three."],
      [0, 108, 227.28, "Four."],
      [0, 302.4, 263.8, "#"],
      [0, 72, 283.92, "Five."],
    ]);
  });

  it("wraps at 65 characters, 60 on an indented first line", () => {
    const words = Array.from({ length: 40 }, () => "word").join(" ");
    const lines = items(layout(`x\n\n${words}`)).slice(1);
    expect(lines.map((l) => l[3].length)).toEqual([59, 64, 64, 9].map((n) => n));
    expect(lines[0]![1]).toBe(108);
    expect(lines[1]![1]).toBe(72);
  });

  it("fills 22 lines, and a 23rd only with the first line of a paragraph", () => {
    const wrapping = Array.from({ length: 30 }, () => "word").join(" ");
    // 22 one-line paragraphs, then a two-line one: its first line takes line 23.
    const a = layout(`${paragraphs(22)}\n\n${wrapping}`);
    expect(a.pages[0]!.items.length).toBe(23);
    expect(a.pages[1]!.items.filter((it) => it.y > 60).length).toBe(2);
    // 21 one-line paragraphs, then a three-line one: two lines fit, the third would be line 23.
    const b = layout(`${paragraphs(21)}\n\n${wrapping} ${wrapping}`);
    expect(b.pages[0]!.items.length).toBe(22);
  });

  it("keeps a heading with the next line and does not count the space after it", () => {
    const l = layout(`${paragraphs(22)}\n\n# Head\n\nAfter.`);
    expect(runsText(l.pages[1]!.items.find((it) => it.y > 60)!.runs)).toBe("Head");
    const m = layout(`${paragraphs(20)}\n\n# Head\n\nAfter.\n\nMore.`);
    expect(m.pages[0]!.items.map((it) => it.y).at(-1)).toBeCloseTo(90 + 22 * 28.32 + 24, 1);
  });

  it("stops text above the footer (Highland lets it run over)", () => {
    const text = `{{FOOTER: %p}}\n\n${paragraphs(20)}\n\n# Head\n\nAfter.\n\nMore.`;
    const fixed = layout(text);
    expect(fixed.pages.length).toBe(2);
    const quirky = layout(text, { highlandQuirks: true });
    expect(quirky.pages.length).toBe(1);
  });

  it("prints an extra empty source line as an empty line", () => {
    expect(items(layout("One.\n\n\nTwo.")).map((i) => i[2])).toEqual([90, 90 + 2 * 28.32]);
  });

  it("drops a heading that opens the text without a title page", () => {
    expect(items(layout("# Title\n\nText."))).toEqual([
      [0, 306 - 2.5 * 7.2, 282, "Title"],
      [0, 72, 282 + 28.32 + 24, "Text."],
    ]);
  });

  it("wraps block quotes at the right margin (Highland lets them run into it)", () => {
    const q = `> ${Array.from({ length: 30 }, () => "word").join(" ")}`;
    const lines = items(layout(q)).map((i) => i[3]);
    expect(Math.max(...lines.map((s) => s.length))).toBeLessThanOrEqual(60);
    expect(Math.max(...items(layout(q, { highlandQuirks: true })).map((i) => i[3].length))).toBeGreaterThan(60);
  });

  it("fills headers and footers: %p, %pp after {{PAGENUMBER}}, %# from the current heading", () => {
    const l = layout(`{{HEADER: %p of %pp}}\n{{FOOTER: %# | %p}}\n\n# One\n\nText.\n\n===\n\n{{PAGENUMBER: 7}}\n\n# Two\n\nText.`);
    const furniture = l.pages.map((p) => p.items.filter((it) => it.y < 60 || it.y > 720).map((it) => runsText(it.runs)));
    expect(furniture).toEqual([
      ["1 of 7", "One", "1"],
      ["7 of 7", "Two", "7"],
    ]);
  });

  it("lists headings with their page numbers for {{TOC}}", () => {
    const l = layout(`{{TOC}}\n\n# Chapter {{SERIES}}\n\nText.\n\n===\n\n# Chapter {{SERIES}}\n\nText.`);
    expect(items(l).slice(0, 4)).toEqual([
      [0, 72, 90, "Chapter 1"],
      [0, 540 - 7.2, 90, "1"],
      [0, 72, 130.32, "Chapter 2"],
      [0, 540 - 7.2, 130.32, "2"],
    ]);
  });

  it("lays out the title page's corners and centre", () => {
    const l = layout("TL: Left\n\tTwo\nTR: Right\nCC: Title\n\t\n\tby\nBR: Corner\n\nBody.");
    expect(items(l).filter((i) => i[0] === 0)).toEqual([
      [0, 72, 83, "Left"],
      [0, 72, 97.4, "Two"],
      [0, 540 - 5 * 7.2, 83, "Right"],
      [0, 306 - 2.5 * 7.2, 313.4, "Title"],
      [0, 306 - 7.2, 341.8, "by"],
      [0, 540 - 6 * 7.2, 716.6, "Corner"],
    ]);
  });

  it("reads PNG and JPEG sizes", () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(png.buffer).setUint32(16, 200);
    new DataView(png.buffer).setUint32(20, 100);
    expect(imageSize(png)).toEqual({ width: 200, height: 100 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 50, 0, 80, 3, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ width: 80, height: 50 });
  });
});

/** Drops Highland's object-replacement character for images (we draw the image only). */
const noPlaceholders = (pages: PdfPage[]) => pages.map((p) => ({ ...p, lines: p.lines.filter((l) => l.text !== "￼") }));

describe("rendered manuscript PDFs match Highland's", () => {
  // Highland's quirks reproduced: quotes into the margin, "%pp" counting its blank last page.
  it("ManuscriptEdgeCases: matches line for line with Highland's quirks, but for its blank last page", async () => {
    const expected = noPlaceholders(await extractPages(join(generated, "ManuscriptEdgeCases.pdf"))).slice(0, 5);
    const actual = await renderManuscript(join(generated, "ManuscriptEdgeCases.highland"), { highlandQuirks: true });
    const ofFive = (pages: PdfPage[]) => pages.map((p) => ({ ...p, lines: p.lines.map((l) => ({ ...l, text: l.text.replace(/ of \d+$/, "") })) }));
    // Highland's paragraph after "===" opens a page whose page count includes the blank page: drop "of N".
    const r = comparePages(ofFive(expected), ofFive(actual));
    expect(r.diffs, formatReport(r)).toEqual([]);
  });

  it("ManuscriptEdgeCases: our fixes put the last paragraph on its own page, numbered 12 of 12", async () => {
    const pages = await renderManuscript(join(generated, "ManuscriptEdgeCases.highland"));
    expect(pages.length).toBe(6);
    expect(pages[5]!.lines.map((l) => l.text)).toEqual(["Claude / Manuscript Edge Cases / 12 of 12", "This is the final paragraph of the manuscript test.", "Chapter 3 12"]);
  });

  it.each(["ManuscriptStart1", "ManuscriptStart2", "ManuscriptStart3", "ManuscriptTitle1", "ManuscriptTitle2", "ManuscriptTitle3"])("%s matches line for line", async (name) => {
    const r = comparePages(await extractPages(join(generated, `${name}.pdf`)), await renderManuscript(join(generated, `${name}.highland`)));
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // With Highland's quirks (its quotes run 65 characters). The last page holds {{TOC: ##}}, which Highland prints oddly (no entries, a broken line): not matched.
  it("ManuscriptProbes: every page but the last matches line for line", async () => {
    const expected = await extractPages(join(generated, "ManuscriptProbes.pdf"));
    const actual = await renderManuscript(join(generated, "ManuscriptProbes.highland"), { highlandQuirks: true });
    expect(actual.length).toBe(expected.length);
    const r = comparePages(expected.slice(0, -1), actual.slice(0, -1));
    expect(r.diffs, formatReport(r)).toEqual([]);
  });

  it("draws an image centred at 1 pt per pixel", () => {
    const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(join(generated, "ManuscriptEdgeCases.highland"))));
    const l = layoutManuscript(parse(bundle.text, { mode: "markdown" }), { highlandQuirks: true, image: (src) => bundle.get(src) ?? null });
    const img = l.pages.flatMap((p) => p.graphics ?? []).find((g) => g.kind === "image")!;
    expect([img.x, img.y, img.width, img.height]).toEqual([206, expect.closeTo(329.76, 1), 200, 100]);
  });

  // Fresh exports by EJ with Highland 2, October 2026.
  it.runIf(priv).each([
    ["SweetBetty_HighlandTest.highland", "SweetBetty_HighlandTest_2026.pdf"],
    ["ThePurityVariations_draft_1 copy.highland", "ThePurityVariations_draft_1 copy 2026.pdf"],
  ])("%s: every page matches line for line", async (source, pdf) => {
    const expected = await extractPages(join(priv!, "Files with exports", pdf));
    const actual = await renderManuscript(join(priv!, "Files with exports", source));
    const r = comparePages(expected, actual);
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

void MANUSCRIPT;

describe("manuscript rules from the probes", () => {
  it("numbers pages from 2 at the top right when there is no {{HEADER}}", () => {
    const l = layout(paragraphs(30));
    expect(l.pages.map((p) => p.items.filter((it) => it.y < 60).map((it) => runsText(it.runs)))).toEqual([[], ["2"]]);
  });

  it("starts a heading lower on a page opened by ===, and spills === after a full page onto an empty one", () => {
    const l = layout(`${paragraphs(23)}\n\n===\n\n# Head\n\nText.`);
    expect(l.pages.length).toBe(3);
    expect(l.pages[1]!.items.filter((it) => it.y > 60)).toEqual([]);
    expect(l.pages[2]!.items.find((it) => runsText(it.runs) === "Head")!.y).toBe(282);
  });

  it("moves a quote paragraph or list item whole rather than splitting it", () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    for (const block of [`> ${long}`, `* ${long}`]) {
      const l = layout(`${paragraphs(21)}\n\n${block}`);
      expect(l.pages[0]!.items.filter((it) => it.y > 60).length).toBe(21);
    }
  });

  it("drops empty lines at the top of a page", () => {
    const l = layout(`${paragraphs(22)}\n\n\n\n\nAfter.`);
    expect(l.pages[1]!.items.find((it) => runsText(it.runs) === "After.")!.y).toBe(90);
  });
});
