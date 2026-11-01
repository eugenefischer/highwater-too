import { describe, expect, it } from "vitest";
import { parse } from "@highwater/parser";
import { columnMinimum, columnWidth, DIALOGUE_WIDTH, lineStyles, PAREN_WIDTH } from "../src/highland-editor/line-styles.ts";

const at = (src: string, line: string) => src.indexOf(line);

describe("Highland-style editor line styles", () => {
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
    expect(m.get(at(md, "> A quote"))).toMatchObject({ kind: "quote", indent: 5 });
  });
});
