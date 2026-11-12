import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { defaultFontDir, layoutManuscript, layoutProse, layoutScreenplay, MULTI_CAM, NOVEL, renderPdf, runsText, STAGE_PLAY } from "../src/index.ts";

// Highland 2's template font options (the <Name>Probe-<Font> exports in the private fixtures).
const script = (text: string) => parse(text, { mode: "fountain" });
const lines = (layout: { pages: { items: { y: number; x: number; runs: { text: string }[] }[] }[] }, page = 0) => layout.pages[page]!.items.map((it) => ({ x: it.x, y: it.y, text: runsText(it.runs as never) }));

describe("template fonts", () => {
  it("prints scripts in Courier, a hair wider than Courier Prime, one point lower", async () => {
    const doc = script(`INT. ROOM - DAY\n\nBOB\naaaa bbbbbbbbbbbbbbbb cccccccccccccccccccccccc\n`);
    const prime = layoutScreenplay(doc, { template: STAGE_PLAY });
    const courier = layoutScreenplay(doc, { template: STAGE_PLAY, font: "Courier" });
    // 46 characters fit Stage Play's dialogue in Courier Prime; in Courier they wrap (StagePlayProbe-Courier).
    expect(lines(prime).filter((l) => l.x === 124.28)).toHaveLength(1);
    expect(lines(courier).filter((l) => l.x === 124.28)).toHaveLength(2);
    expect(lines(courier)[0]!.y).toBe(lines(prime)[0]!.y + 1);
    expect(courier.pages[0]!.items[0]!.runs[0]!.style.font).toBe("Courier");
    expect((await renderPdf(courier)).length).toBeGreaterThan(1000);
  });

  it("gives scripts in Times New Roman (or its stand-in) 12.51 pt lines and measured wrapping", () => {
    const doc = script(`INT. ROOM - DAY\n\nBOB\naaaa bbbbbbbbbbbbbbb cccccccccccccccccccccccc\n\nA second line of action here.\n`);
    const times = layoutScreenplay(doc, { font: "Times New Roman", fontDirs: [] });
    expect(times.substituted).toEqual({ "Times New Roman": "Tinos" });
    const ys = lines(times).map((l) => l.y);
    expect(ys[1]! - ys[0]!).toBeCloseTo(25.02, 1); // a blank line between: two 12.51 pt lines
    // 45 characters of a's, b's and c's (245.1 pt) fit Screenplay's 249 pt dialogue (GraphicNovelProbe-TimesNewRoman).
    expect(lines(times).some((l) => l.text === "aaaa bbbbbbbbbbbbbbb cccccccccccccccccccccccc")).toBe(true);
  });

  it("sets the Manuscript in Courier: a 65-character line wraps (ManuscriptProbe-Courier)", () => {
    const doc = parse(`${"abcd ".repeat(12)}abcda\n`, { mode: "markdown" }); // 65 characters, not indented
    const count = (l: ReturnType<typeof layoutManuscript>) => l.pages.flatMap((p) => p.items).filter((i) => /^[abcd ]+$/.test(runsText(i.runs))).length;
    expect(count(layoutManuscript(doc))).toBe(1);
    expect(count(layoutManuscript(doc, { font: "Courier" }))).toBe(2);
  });

  it("gives prose templates their Headers and Body fonts, moving baselines with the font", () => {
    const doc = parse("# Heading\n\nA paragraph of text.\n", { mode: "markdown" });
    const amiri = layoutProse(doc, NOVEL, { fontDir: defaultFontDir(), fontDirs: [] });
    const schola = layoutProse(doc, NOVEL, { fontDir: defaultFontDir(), fontDirs: [], fonts: { headers: "Cormorant Garamond", body: "TeX Gyre Schola" } });
    const fonts = schola.pages.flatMap((p) => p.items).flatMap((i) => i.runs.map((r) => r.style.font));
    expect(fonts).toContain("Cormorant Garamond");
    expect(fonts).toContain("TeX Gyre Schola");
    expect(schola.substituted).toEqual({});
    const para = (l: typeof amiri) => l.pages.flatMap((p) => p.items).find((i) => /^a paragraph/i.test(runsText(i.runs)))!.y;
    // TeX Gyre Schola sits 2 pt lower than Amiri at 13 pt (NovelProbe-Schola).
    expect(para(schola) - para(amiri)).toBeCloseTo(2 + 0, 0);
  });

  it("has Highland's other template options: Manuscript's indents and heading space, Multi-Cam's capitals", () => {
    const doc = parse("# Chapter\n\nFirst paragraph.\n\nSecond paragraph.\n", { mode: "markdown" });
    const at = (l: ReturnType<typeof layoutManuscript>, text: string) => l.pages.flatMap((p) => p.items).find((i) => runsText(i.runs) === text)!;
    // ManuscriptProbe-IndentLeading: the first paragraph after a heading is indented too.
    expect(at(layoutManuscript(doc), "First paragraph.").x).toBe(72);
    expect(at(layoutManuscript(doc, { indentLeading: true }), "First paragraph.").x).toBe(108);
    // ManuscriptProbe-NoSectionSpace: an opening heading starts at the top, not 192 pt down.
    expect(at(layoutManuscript(doc), "Chapter").y - at(layoutManuscript(doc, { spaceBeforeSections: false }), "Chapter").y).toBeCloseTo(192, 0);
    const script = parse("INT. ROOM - DAY\n\nBob waves.\n", { mode: "fountain" });
    const texts = (t: typeof MULTI_CAM) => layoutScreenplay(script, { template: t }).pages[0]!.items.map((i) => runsText(i.runs));
    expect(texts(MULTI_CAM)).toContain("BOB WAVES.");
    expect(texts({ ...MULTI_CAM, uppercaseAction: false })).toContain("Bob waves.");
  });
});
