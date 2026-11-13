import { describe, expect, it } from "vitest";
import { parse } from "@highwater/parser";
import { columnMinimum, columnWidth, DIALOGUE_WIDTH, inlineMarks, lineStyles, PAREN_WIDTH } from "../src/highland-editor/line-styles.ts";

const at = (src: string, line: string) => src.indexOf(line);

describe("Highwater Editor line styles", () => {
  it("indents and narrows each part of a speech, so wrapped lines stay in place", () => {
    const src = "INT. KITCHEN - DAY\n\nBrenda waits.\n\nBRENDA\n(whispering)\nAre you coming?\n\nCUT TO:\n";
    const doc = parse(src, { mode: "fountain" });
    const s = lineStyles(doc);
    expect(columnWidth(doc)).toBe(63);
    expect(columnMinimum(doc)).toBe(46);
    expect(s.get(0)).toMatchObject({ kind: "scene", indent: 0 });
    expect(s.get(at(src, "Brenda waits"))).toMatchObject({ kind: "action", indent: 0 });
    expect(s.get(at(src, "BRENDA"))).toMatchObject({ kind: "cue", indent: 21 });
    expect(s.get(at(src, "(whispering)"))).toEqual({ kind: "parenthetical", indent: 15, width: PAREN_WIDTH });
    expect(s.get(at(src, "Are you"))).toEqual({ kind: "dialogue", indent: 11, width: DIALOGUE_WIDTH });
    expect(s.get(at(src, "CUT TO:"))).toMatchObject({ kind: "transition", align: "right" });
  });

  it("marks title-page lines and Markdown headings and quotes", () => {
    const fountain = "Title: Test\nAuthor: Me\n\nINT. ROOM - DAY\n";
    const f = lineStyles(parse(fountain, { mode: "fountain" }));
    expect(f.get(0)?.kind).toBe("title");
    expect(f.get(at(fountain, "Author"))?.kind).toBe("title");

    const md = "# Chapter\n\nFirst paragraph.\n\n> A quote.\n";
    const doc = parse(md, { mode: "markdown" });
    const m = lineStyles(doc);
    expect(columnWidth(doc)).toBe(65);
    expect(columnMinimum(doc)).toBe(0);
    expect(m.get(0)).toMatchObject({ kind: "heading", level: 1, align: "center" });
    expect(m.get(at(md, "> A quote"))).toMatchObject({ kind: "quote", indent: 3 });
  });

  it("doesn't indent manuscript paragraphs (Highland indents them only on the page)", () => {
    const md = "# Chapter\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const m = lineStyles(parse(md, { mode: "markdown" }));
    expect(m.get(at(md, "First"))).toMatchObject({ kind: "paragraph", indent: 0 });
    expect(m.get(at(md, "Second"))).toMatchObject({ kind: "paragraph", indent: 0 });
  });

  it("finds emphasis, notes and omitted text by source offsets", () => {
    const src = "Brenda **runs** and *hides* [[check this]].\n\nBOB\nI _said_ /* cut */ no.\n";
    const marks = inlineMarks(parse(src, { mode: "fountain" }));
    const text = (kind: string) => marks.filter((m) => m.kind === kind).map((m) => src.slice(m.from, m.to));
    expect(text("bold")).toEqual(["**runs**"]);
    expect(text("italic")).toEqual(["*hides*"]);
    expect(text("note")).toEqual(["[[check this]]"]);
    expect(text("underline")).toEqual(["_said_"]);
    expect(text("omitted")).toEqual(["/* cut */"]);
  });
});
