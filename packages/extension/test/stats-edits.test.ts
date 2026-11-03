import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { changeCase, stripRevisionTags, toggleBoneyard, toggleCentre, toggleWrap, type TextEdit } from "../src/syntax/edits.ts";
import { countWords, documentStats } from "../src/syntax/stats.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;
const load = (path: string) => HighlandBundle.fromZip(new Uint8Array(readFileSync(path)));

/** Applies an edit and shows the selection as [ ]. */
function show(text: string, e: TextEdit): string {
  const out = text.slice(0, e.start) + e.text + text.slice(e.end);
  return out.slice(0, e.selectionStart) + "[" + out.slice(e.selectionStart, e.selectionEnd) + "]" + out.slice(e.selectionEnd);
}
/** Selection given as [ ] in the input. */
function run(input: string, f: (text: string, s: number, e: number) => TextEdit): string {
  const s = input.indexOf("[");
  const e = input.indexOf("]") - 1;
  const text = input.replace("[", "").replace("]", "");
  return show(text, f(text, s, e));
}

describe("word count", () => {
  it("counts words with apostrophes, hyphens and numbers as one", () => {
    expect(countWords("Don't stop — the twenty-two cats ate 3.5 pies.")).toBe(8);
  });

  it("skips notes, boneyards, sections, synopses, directives and the title page", () => {
    const doc = parse("Title: Many Words Here\n\n# Section words\n\n= synopsis words\n\nShe runs [[not counted]] home. /* nor this */\n\nChapter {{SERIES}}", { mode: "fountain" });
    expect(documentStats(doc).words).toBe(4);
  });
});

describe("page estimate", () => {
  it("matches Highland's page counts for the generated screenplay", () => {
    const b = load(join(generated, "ScreenplayEdgeCases.highland"));
    expect(documentStats(parse(b.text, { mode: b.mode })).pages).toBe(11); // the 12-page PDF has a title page
  });

  it.runIf(priv)("comes within 3% of Highland's PDFs for the real scripts and manuscripts", () => {
    const dir = join(priv!, "Files with exports");
    const cases: [string, number][] = [
      ["Astounding_date_EJ draft 2 copy.highland", 56],
      ["SweetBetty_HighlandTest.highland", 69],
      ["ThePurityVariations_draft_1 copy.highland", 92],
    ]; // PDF page counts minus the title page
    for (const [file, pages] of cases) {
      const b = load(join(dir, file));
      const estimate = documentStats(parse(b.text, { mode: b.mode })).pages;
      expect(Math.abs(estimate - pages) / pages, `${file}: ${estimate} vs ${pages}`).toBeLessThanOrEqual(0.03);
    }
  });
});

describe("emphasis toggles", () => {
  const bold = (t: string, s: number, e: number) => toggleWrap(t, s, e, "**");
  const italic = (t: string, s: number, e: number) => toggleWrap(t, s, e, "*");
  const note = (t: string, s: number, e: number) => toggleWrap(t, s, e, "[[", "]]");

  it("wraps and unwraps the selection", () => {
    expect(run("She [runs] home.", bold)).toBe("She **[runs]** home.");
    expect(run("She **[runs]** home.", bold)).toBe("She [runs] home.");
    expect(run("She [**runs**] home.", bold)).toBe("She [runs] home.");
  });

  it("does not mistake bold for italic", () => {
    expect(run("She **[runs]** home.", italic)).toBe("She ***[runs]*** home.");
    expect(run("She [**runs**] home.", italic)).toBe("She *[**runs**]* home.");
    expect(run("She *[runs]* home.", italic)).toBe("She [runs] home.");
  });

  it("inserts an empty pair at the cursor", () => {
    expect(run("She [] home.", note)).toBe("She [[[]]] home.");
  });
});

describe("centre and omit", () => {
  it("centres and un-centres the selected lines", () => {
    expect(run("[THE END]", toggleCentre)).toBe("[> THE END <]");
    expect(run("> THE [END] <", toggleCentre)).toBe("[THE END]");
  });

  it("omits the current line, or the selection, and restores it", () => {
    expect(run("One.\nT[]wo.\nThree.", toggleBoneyard)).toBe("One.\n[/*Two.*/]\nThree.");
    expect(run("One /*T[]wo*/ three", toggleBoneyard)).toBe("One [Two] three");
    expect(run("One [two] three", toggleBoneyard)).toBe("One [/*two*/] three");
  });
});

describe("export", () => {
  it("removes revision tags and keeps everything else", () => {
    expect(stripRevisionTags("She {{REVISION: #ff0000}}runs{{/REVISION}} [[note]] /* gone */ home.")).toBe("She runs [[note]] /* gone */ home.");
  });
});

describe("reading time", () => {
  it("reads prose at Highland's 250 words a minute", () => {
    const prose = Array.from({ length: 2500 }, (_, i) => (i % 10 === 9 ? "word." : "word")).join(" ");
    expect(documentStats(parse(prose, { mode: "markdown" })).minutes).toBe(10);
  });
});

describe("emphasis with spaces at the ends of the selection", () => {
  it("leaves the spaces outside the markers, and selects the word", () => {
    const bold = (t: string, s: number, e: number) => toggleWrap(t, s, e, "**");
    expect(bold("a word b", 1, 7)).toEqual({ start: 2, end: 6, text: "**word**", selectionStart: 4, selectionEnd: 8 });
    expect(bold("a **word** b", 1, 11)).toEqual({ start: 2, end: 10, text: "word", selectionStart: 2, selectionEnd: 6 });
    expect(bold("line one\nline two", 5, 9)).toEqual({ start: 5, end: 8, text: "**one**", selectionStart: 7, selectionEnd: 10 });
    // Only spaces selected: wrapped as they are.
    expect(bold("a  b", 1, 3).text).toBe("**  **");
  });
});

describe("case keys", () => {
  it("changes the selection, or the word at the cursor, and keeps the selection", () => {
    expect(changeCase("she said hello", 4, 8, true)).toEqual({ start: 4, end: 8, text: "SAID", selectionStart: 4, selectionEnd: 8 });
    expect(changeCase("INT. O’BRIEN’S BAR", 7, 7, false)).toEqual({ start: 5, end: 14, text: "o’brien’s", selectionStart: 7, selectionEnd: 7 });
    expect(changeCase("a  b", 2, 2, true)).toEqual({ start: 2, end: 2, text: "", selectionStart: 2, selectionEnd: 2 });
  });
});
