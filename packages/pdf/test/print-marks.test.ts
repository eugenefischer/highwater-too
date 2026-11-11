import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { layoutManuscript, layoutScreenplay, NOTE_COLOR, NUMBER, runsText, SYNOPSIS_COLOR, type Layout, type PrintMarks } from "../src/index.ts";

// The cases of ScreenplayPrintProbe and ManuscriptPrintProbe (Example Highland Files/Print Option
// Probes), whose Highland 2 exports these positions were measured from.

const SCRIPT = [
  "= Section synopsis.",
  "",
  "INT. LIGHTHOUSE - NIGHT",
  "",
  "Rain lashes the glass.",
  "",
  "[[Own-line note.]]",
  "",
  "Mara opens the logbook. [[Inline note.]] The pages are wet.",
  "",
  "{{REVISION: #ee2d36}}A red revision.{{/REVISION}}",
  "",
  "{{REVISION: #ee2d36}}Into",
  "",
  "{{/REVISION}}{{REVISION: #ee2d36}}MARA",
  "dialogue.{{/REVISION}}",
  "",
  "{{REVISION}}A bare revision.{{/REVISION}}",
].join("\n");

/** Every text item on the body pages as [x, y, text, colour]. */
function items(layout: Layout) {
  return layout.pages.flatMap((p) => p.items.map((it) => [it.x, it.y, runsText(it.runs), it.runs.map((r) => r.style.color ?? "").join("|")] as const));
}
const screenplay = (print?: PrintMarks) => items(layoutScreenplay(parse(SCRIPT, { mode: "fountain" }), print ? { print } : {}));
/** Each numbered line's start offset, numbered from 1 as Highland does (notes alone not numbered). */
function numbersOf(source: string): Map<number, number> {
  const out = new Map<number, number>();
  let at = 0;
  let n = 0;
  for (const line of source.split("\n")) {
    if (line.trim() && !/^\[\[.*\]\]$/.test(line.trim())) out.set(at, ++n);
    at += line.length + 1;
  }
  return out;
}

describe("print options (screenplay)", () => {
  it("print nothing extra by default, with one space where a note was", () => {
    const text = screenplay().map((i) => i[2]);
    expect(text).toContain("Mara opens the logbook. The pages are wet.");
    expect(text.some((t) => t.includes("[[") || t.includes("synopsis") || t === "*")).toBe(false);
  });

  it("notes: in blue, brackets kept; one on its own line sits between its neighbours", () => {
    const out = screenplay({ notes: true });
    const rain = out.find((i) => i[2] === "Rain lashes the glass.")!;
    const note = out.find((i) => i[2] === " [[Own-line note.]]")!;
    const mara = out.find((i) => i[2].startsWith("Mara opens"))!;
    expect([note[0], note[1] - rain[1], mara[1] - note[1]]).toEqual([108, 12, 12]);
    expect(mara[2]).toBe("Mara opens the logbook. [[Inline note.]] The pages are wet.");
    expect(mara[3]).toContain(NOTE_COLOR);
  });

  it("synopses: grey, half an inch in, a paragraph of their own", () => {
    const out = screenplay({ synopses: true });
    expect(out[0]).toEqual([144, 81, "Section synopsis.", SYNOPSIS_COLOR]);
    expect(out[1]!.slice(1, 3)).toEqual([117, "INT. LIGHTHOUSE - NIGHT"]);
  });

  it("revision colour: the tag's colour, the cue too; a bare tag has none", () => {
    const out = screenplay({ revisionColor: true });
    expect(out.find((i) => i[2] === "A red revision.")![3]).toBe("#ee2d36");
    expect(out.find((i) => i[2] === "MARA")![3]).toBe("#ee2d36");
    expect(out.find((i) => i[2] === "A bare revision.")![3]).toBe("");
  });

  it("revision stars: at 576, 1 pt above each revised line's baseline", () => {
    const out = screenplay({ revisionStars: true });
    const stars = out.filter((i) => i[2] === "*").map((i) => [i[0], i[1]]);
    const revised = ["A red revision.", "Into", "MARA", "dialogue.", "A bare revision."].map((t) => out.find((i) => i[2] === t)![1]);
    expect(stars).toEqual(revised.map((y) => [576, y - 1]));
  });

  it("paragraph numbers: Helvetica 9 pt in blue, right edge at 36, 3 pt up, by source line", () => {
    const doc = parse(SCRIPT, { mode: "fountain" });
    const layout = layoutScreenplay(doc, { print: { numbers: numbersOf(SCRIPT) } });
    const nums = layout.pages[0]!.items.filter((it) => it.runs[0]!.style.font === NUMBER.font);
    const at = (t: string) => layout.pages[0]!.items.find((it) => runsText(it.runs) === t)!.y;
    expect(nums.map((n) => [runsText(n.runs), n.y])).toEqual([
      ["2", at("INT. LIGHTHOUSE - NIGHT") - 3],
      ["3", at("Rain lashes the glass.") - 3],
      ["4", at("Mara opens the logbook. The pages are wet.") - 3],
      ["5", at("A red revision.") - 3],
      ["6", at("Into") - 3],
      ["7", at("MARA") - 3],
      ["8", at("dialogue.") - 3],
      ["9", at("A bare revision.") - 3],
    ]);
    expect(nums[0]!.x + 9 * 0.556).toBeCloseTo(36);
    expect(nums[0]!.runs[0]!.style).toMatchObject({ size: 9, color: NUMBER.color });
  });
});

describe("print options (manuscript)", () => {
  const MD = ["# Chapter One", "", "= A synopsis.", "", "The ferry docked.", "", "[[Own-line note.]]", "", "Next paragraph."].join("\n");
  const layout = (print: PrintMarks) => items(layoutManuscript(parse(MD, { mode: "markdown" }), { print }));

  it("synopses print indented in grey, and the paragraph after still opens unindented", () => {
    const out = layout({ synopses: true });
    expect(out.find((i) => i[2] === "A synopsis.")!.slice(0, 1)).toEqual([108]);
    expect(out.find((i) => i[2] === "The ferry docked.")![0]).toBe(72);
  });

  it("a note on its own line opens the next paragraph", () => {
    const out = layout({ notes: true });
    expect(out.find((i) => i[2].startsWith("[[Own-line note.]]"))![2]).toBe("[[Own-line note.]]Next paragraph.");
  });

  it("stars sit 6.32 pt below the double-spaced line's baseline", () => {
    const md = "Plain.\n\n{{REVISION: #ee2d36}}Revised.{{/REVISION}}";
    const out = items(layoutManuscript(parse(md, { mode: "markdown" }), { print: { revisionStars: true } }));
    const line = out.find((i) => i[2] === "Revised.")!;
    const star = out.find((i) => i[2] === "*")!;
    expect([star[0], star[1] - line[1]]).toEqual([576, expect.closeTo(6.32, 5)]);
  });
});
