import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@highwater/parser";
import { comparePages, formatReport, extractPages } from "@highwater/pdf-compare";
import { describe, expect, it } from "vitest";
import { layoutScreenplay, runsText } from "../src/index.ts";
import { bodyOnly, renderHighland, renderText } from "./helpers.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

/** Every text item of a layout as [page, x, y, text]. */
function items(text: string) {
  const layout = layoutScreenplay(parse(text, { mode: "fountain" }), { date: new Date(2026, 8, 28) });
  return layout.pages.flatMap((p, i) => p.items.map((it) => [i, it.x, it.y, runsText(it.runs)] as const));
}

describe("screenplay layout", () => {
  it("places each element at Highland's position", () => {
    const got = items("INT. HOUSE - DAY\n\nShe enters.\n\nBOB (V.O.)\n(quietly)\nHello.\n\nCUT TO:\n\n> THE END <");
    expect(got).toEqual([
      [0, 108, 81, "INT. HOUSE - DAY"],
      [0, 108, 105, "She enters."],
      [0, 249, 129, "BOB (V.O.)"],
      [0, 207, 141, "(quietly)"],
      [0, 179, 153, "Hello."],
      [0, 564 - 7 * 7.2, 177, "CUT TO:"],
      [0, 336 - 3.5 * 7.2, 201, "THE END"],
    ]);
  });

  it("puts two blank lines before a scene heading, one when it follows directly", () => {
    const got = items("Action.\n\nINT. A - DAY\n\nMore.\n\n>CUT TO:\nINT. B - DAY");
    expect(got.map(([, , y, t]) => [y, t])).toEqual([
      [81, "Action."],
      [117, "INT. A - DAY"],
      [141, "More."],
      [165, "CUT TO:"],
      [189, "INT. B - DAY"],
    ]);
  });

  it("prints a header from the page after it is set, but a footer on the page it is set on", () => {
    const got = items("Action one.\n\n{{HEADER: %p}}\n\n{{FOOTER: here}}\n\nAction two.\n\n===\n\nAction three.");
    const furniture = got.filter(([, , y]) => y < 60 || y > 740).map(([p, , y, t]) => [p, y, t]);
    expect(furniture).toEqual([
      [0, 747, "here"],
      [1, 51, "2"],
      [1, 747, "here"],
    ]);
  });

  it("prints header and footer parts with the section title and a centred middle part", () => {
    const got = items("{{HEADER: %# | %p}}\n{{FOOTER: Left | Centre | Right}}\n\n# Act One\n\nINT. A - DAY\n\nAction.");
    const furniture = got.filter(([, , y]) => y < 60 || y > 740).map(([, x, y, t]) => [x, y, t]);
    expect(furniture).toEqual([
      [72, 51, "Act One"],
      [540 - 7.2, 51, "1"],
      [72, 747, "Left"],
      [306 - 3 * 7.2, 747, "Centre"],
      [540 - 5 * 7.2, 747, "Right"],
    ]);
  });

  it("indents wrapped parentheticals by one character", () => {
    const got = items("BOB\n(quietly, and then more quietly still)\nHello.");
    expect(got.map(([, x, , t]) => [x, t])).toEqual([
      [249, "BOB"],
      [207, "(quietly, and then more"],
      [207 + 7.2, "quietly still)"],
      [179, "Hello."],
    ]);
  });

  it("takes no space for a directive line, one line for the second line of a directive paragraph", () => {
    const one = items("{{HEADER: %p}}\n\nINT. A - DAY");
    const two = items("{{HEADER: %p}}\n{{FOOTER: x}}\n\nINT. A - DAY");
    const lead = items("\n{{HEADER: %p}}\n\nINT. A - DAY");
    const y = (got: ReturnType<typeof items>) => got.find(([, , , t]) => t === "INT. A - DAY")![2];
    expect([y(one), y(two), y(lead)]).toEqual([81, 93, 117]);
  });

  it("splits a long speech after a sentence, with (MORE) and (CONT’D)", () => {
    // 26 one-line actions fill lines 1–51; the cue lands on line 53, leaving room for one line and (MORE).
    const filler = Array.from({ length: 26 }, (_, k) => `Line ${k + 1}.`).join("\n\n");
    const got = items(`${filler}\n\nBOB\nOne sentence here. Another sentence follows it. And a third one ends the speech.`);
    const row = (n: number) => 81 + (n - 1) * 12;
    expect(got.filter(([p]) => p === 0).slice(-3).map(([, x, y, t]) => [x, y, t])).toEqual([
      [249, row(53), "BOB"],
      [179, row(54), "One sentence here."],
      [214.2, row(55), "(MORE)"],
    ]);
    expect(got.filter(([p]) => p === 1).map(([, x, y, t]) => [x, y, t])).toEqual([
      [249, row(1), "BOB (CONT’D)"],
      [179, row(2), "Another sentence follows it. And a"],
      [179, row(3), "third one ends the speech."],
      [540 - 2 * 7.2, 51, "2."], // Highland's default page number when there is no {{HEADER}}
    ]);
  });

  it("never splits an action of fewer than four lines", () => {
    // 27 one-line actions fill lines 1–53; a three-line action would need lines 55–57.
    const filler = Array.from({ length: 27 }, (_, k) => `Line ${k + 1}.`).join("\n\n");
    const three = "First sentence that is long enough to fill most of one line here. Second sentence is also quite long, it fills a line. Third.";
    const got = items(`${filler}\n\n${three}`);
    expect(got.filter(([p]) => p === 1)[0]![3]).toBe("First sentence that is long enough to fill most of one line");
  });

  it("numbers {{SERIES}} and fills in {{TIMESTAMP}}", () => {
    const got = items("Part {{SERIES}}.\n\nPart {{SERIES}}, {{TIMESTAMP}}.");
    expect(got.map(([, , , t]) => t)).toEqual(["Part 1.", "Part 2, Sep 28, 2026."]);
  });
});

describe("rendered PDFs match Highland's", () => {
  it("draws text Highland's PDF extractor reads back at the same places, in bold where Highland uses bold", async () => {
    const pages = await renderText("INT. HOUSE - DAY\n\nShe enters.");
    expect(pages[0]!.lines.map((l) => [l.x, l.y, l.text])).toEqual([
      [108, 81, "INT. HOUSE - DAY"],
      [108, 105, "She enters."],
    ]);
    expect(pages[0]!.lines[0]!.font).not.toBe(pages[0]!.lines[1]!.font);
  });

  // Headers and footers differ on purpose: we print %# and centre a three-part footer's middle.
  // Highland did not print the INCLUDE (no macOS bookmark), so neither do we here.
  it("ScreenplayEdgeCases: every page matches line for line (headers and footers aside)", async () => {
    const expected = bodyOnly(await extractPages(join(generated, "ScreenplayEdgeCases.pdf")));
    const actual = bodyOnly(await renderHighland(join(generated, "ScreenplayEdgeCases.highland")));
    const r = comparePages(expected, actual);
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it.each(["FirstLineTests", "SpeechFitTests", "StartTest1-LeadingBlankLine", "StartTest2-TabBlankLines", "StartTest3-Both"])("%s matches line for line", async (name) => {
    const r = comparePages(await extractPages(join(generated, `${name}.pdf`)), await renderHighland(join(generated, `${name}.highland`)));
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  // Astounding_fresh.pdf: exported by EJ with Highland 2 in October 2026 (the February 2024 export
  // in "Files with exports" comes from an older Highland).
  it.runIf(priv)("Astounding: all 57 pages match line for line", async () => {
    const expected = await extractPages(join(priv!, "AI Generated Test Files", "Astounding_fresh.pdf"));
    const actual = await renderHighland(join(priv!, "Files with exports", "Astounding_date_EJ draft 2 copy.highland"));
    const r = comparePages(expected, actual);
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("screenplay source offsets", () => {
  it("tags every printed line, keeping a speech split across pages on its own range", () => {
    const src = "INT. HOUSE - DAY\n\nBOB\nHello there.\n\nShe leaves.";
    const l = layoutScreenplay(parse(src, { mode: "fountain" }));
    expect(l.pages[0]!.items.map((it) => it.source)).toEqual([0, src.indexOf("BOB"), src.indexOf("Hello"), src.indexOf("She")]);
  });

  it("gives a split speech's (MORE) the line before's place, and its (CONT’D) cue the next line's, where the page starts", () => {
    const filler = Array.from({ length: 24 }, (_, i) => `Action line ${i + 1}.`).join("\n\n");
    const speech = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} goes on.`).join(" ");
    const src = `INT. HOUSE - DAY\n\n${filler}\n\nBOB\n${speech}\n\nShe leaves.`;
    const l = layoutScreenplay(parse(src, { mode: "fountain" }));
    const text = (it: { runs: { text: string }[] }) => it.runs.map((r) => r.text).join("");
    const body = l.pages.map((p) => p.items.filter((it) => it.source !== undefined && !/^\d+\.$/.test(text(it))));
    const at = body.findIndex((items) => items.some((it) => text(it) === "(MORE)"));
    expect(at).toBeGreaterThanOrEqual(0);
    const page = body[at]!;
    const more = page.findIndex((it) => text(it) === "(MORE)");
    expect(page[more]!.source).toBe(page[more - 1]!.source);
    const next = body[at + 1]!;
    expect(text(next[0]!)).toBe("BOB (CONT’D)");
    expect(next[0]!.source).toBe(next[1]!.source);
    expect(src.slice(next[1]!.source!)).toMatch(new RegExp(`^${text(next[1]!).split(" ").slice(0, 3).join(" ")}`));
    // In order throughout.
    const sources = body.flat().map((it) => it.source!);
    expect(sources).toEqual([...sources].sort((x, y) => x - y));
  });
});

describe("markers", () => {
  it("print nothing, the text laid out as if they were not there (Highland's line breaks at markers are not copied)", async () => {
    const { readFileSync } = await import("node:fs");
    const { HighlandBundle } = await import("@highwater/bundle");
    const { parse } = await import("@highwater/parser");
    const { layoutScreenplay, runsText } = await import("../src/index.ts");
    const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(new URL("../../../fixtures/generated/MarkerTest.highland", import.meta.url)))).text;
    const page = layoutScreenplay(parse(text, { mode: "fountain" })).pages[1]!;
    const lines = page.items.map((it) => [it.y, runsText(it.runs)]);
    expect(lines).toEqual(
      expect.arrayContaining([
        [201, "A marker inside dialogue in the"],
        [213, "middle of a line."],
        [237, "An action line with a marker at its end."],
        [261, "INSERT A MARKER WITH CONTROL-M ON THE EMPTY LINE BELOW, LABEL"],
      ]),
    );
    expect(lines.some(([, t]) => String(t).includes("{{"))).toBe(false);
  });
});

describe("Document settings", () => {
  const speech = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} goes on.`).join(" ");
  const script = (n: number) => `INT. HOUSE - DAY\n\nShe waits.\n\nEXT. GARDEN - NIGHT\n\n${Array.from({ length: n }, (_, i) => `Action line ${i + 1}.`).join("\n\n")}\n\nBOB\n${speech}\n\nShe leaves.`;
  const text = (it: { runs: { text: string }[] }) => it.runs.map((r) => r.text).join("");
  // Enough action that the speech breaks across the first page.
  const n = Array.from({ length: 20 }, (_, i) => 15 + i).find((k) => layoutScreenplay(parse(script(k), { mode: "fountain" })).pages.some((p) => p.items.some((it) => text(it) === "(MORE)")))!;
  const src = script(n);
  const lay = (document = {}) => layoutScreenplay(parse(src, { mode: "fountain" }), { document });
  const find = (l: ReturnType<typeof lay>, t: string) => l.pages.flatMap((p) => p.items).find((it) => text(it) === t)!;

  it("prints scene headings bold by default, and plain, underlined or both as set", () => {
    expect(find(lay(), "INT. HOUSE - DAY").runs[0]!.style).toEqual({ bold: true });
    expect(find(lay({ sceneHeadingBold: false, sceneHeadingUnderline: true }), "INT. HOUSE - DAY").runs[0]!.style).toEqual({ underline: true });
  });

  it("prints synopses in italics when set (with synopses printed)", () => {
    const doc = () => parse("INT. HOUSE - DAY\n\n= The synopsis.\n\nShe waits.", { mode: "fountain" });
    const style = (synopsesItalic: boolean) => layoutScreenplay(doc(), { print: { synopses: true }, document: { synopsesItalic } }).pages.flatMap((p) => p.items).find((it) => text(it) === "The synopsis.")!.runs[0]!.style;
    expect(style(false).italic).toBeUndefined();
    expect(style(true).italic).toBe(true);
  });

  it("puts one blank line before a scene heading instead of two when Double-Spaced is off", () => {
    const gap = (l: ReturnType<typeof lay>) => find(l, "EXT. GARDEN - NIGHT").y - find(l, "She waits.").y;
    expect(gap(lay())).toBe(36);
    expect(gap(lay({ sceneHeadingDoubleSpaced: false }))).toBe(24);
  });

  it("leaves out (MORE) and (CONT’D) when set, breaking the speech in the same place", () => {
    const on = lay();
    const off = lay({ moreContd: false });
    const lines = (l: ReturnType<typeof lay>) => l.pages.map((p) => p.items.map(text));
    const printed = lines(on).flat();
    expect(printed).toContain("(MORE)");
    expect(printed).toContain("BOB (CONT’D)");
    expect(lines(off).flat()).not.toContain("(MORE)");
    expect(lines(off).flat()).not.toContain("BOB (CONT’D)");
    // The same lines on each page, less the two.
    expect(lines(off)).toEqual(lines(on).map((p) => p.filter((t) => t !== "(MORE)").map((t) => (t === "BOB (CONT’D)" ? "BOB" : t))));
  });
});
