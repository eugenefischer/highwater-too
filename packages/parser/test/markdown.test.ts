import { describe, expect, it } from "vitest";
import type { Element } from "../src/index.ts";
import { parse } from "../src/index.ts";

const md = (src: string) => parse(src, { mode: "markdown" }).elements;
const kinds = (src: string) => md(src).map((e) => e.kind);
const only = <K extends Element["kind"]>(src: string, kind: K) => md(src).find((e) => e.kind === kind) as Extract<Element, { kind: K }>;

describe("Markdown blocks", () => {
  it("makes every prose line its own paragraph (as Highland prints them)", () => {
    expect(kinds("First line.\nSecond line.")).toEqual(["paragraph", "paragraph"]);
  });

  it("reads headings followed directly by text", () => {
    const els = md("## Subheading\nHow are we doing now?");
    expect(els.map((e) => e.kind)).toEqual(["heading", "paragraph"]);
    expect(els[0]).toMatchObject({ level: 2, text: "Subheading" });
  });

  it("reads a block quote even without a blank line before it, with an empty > line between paragraphs", () => {
    expect(kinds("This is a sample\n> Quoted.")).toEqual(["paragraph", "blockQuote"]);
    expect(only("> One.\n>\n> Two.", "blockQuote").paragraphs.map((p) => p.text)).toEqual(["One.", "Two."]);
  });

  it("joins wrapped lines within one quoted paragraph", () => {
    expect(only("> One\n> continued.", "blockQuote").paragraphs.map((p) => p.text)).toEqual(["One continued."]);
  });

  it("reads * * * as a scene break, not a list", () => {
    expect(kinds("* * *")).toEqual(["sceneBreak"]);
    expect(kinds("***")).toEqual(["sceneBreak"]);
  });

  it("reads *, - and numbered lists with nesting", () => {
    const list = only("* one\n  * nested\n- dash\n1. first\n2. second", "list");
    expect(list.items.map((i) => [i.marker, i.level, i.ordered, i.text])).toEqual([
      ["*", 0, false, "one"],
      ["*", 1, false, "nested"],
      ["-", 0, false, "dash"],
      ["1.", 0, true, "first"],
      ["2.", 0, true, "second"],
    ]);
  });

  it("reads term lists", () => {
    expect(only("Term :: Definition\nOther :: More", "termList").items.map((i) => [i.term, i.definition])).toEqual([
      ["Term", "Definition"],
      ["Other", "More"],
    ]);
  });

  it("reads pipe tables with alignment, and needs a separator row", () => {
    const t = only("| A | B | C |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |", "table");
    expect(t.align).toEqual(["left", "center", "right"]);
    expect(t.header.map((c) => c.text)).toEqual(["A", "B", "C"]);
    expect(t.rows.map((r) => r.map((c) => c.text))).toEqual([["1", "2", "3"]]);
    expect(kinds("a | b")).toEqual(["paragraph"]);
  });

  it("reads link definitions, synopses, page breaks, directive lines, centred and right-aligned text", () => {
    expect(only("[Highland]: https://highland2.app", "linkDefinition")).toMatchObject({ label: "Highland", url: "https://highland2.app" });
    expect(kinds("= synopsis\n===\n{{TOC}}\n> centred <\n*An aside.*>")).toEqual(["synopsis", "pageBreak", "directiveLine", "centered", "rightAligned"]);
  });

  it("keeps inline directives in headings", () => {
    expect(only("# Chapter {{SERIES}}", "heading").inline.map((n) => n.kind)).toEqual(["text", "directive"]);
  });
});

describe("plain text", () => {
  it("makes each line a paragraph with no markup", () => {
    const els = parse("Line *one*\n\nLine two", { mode: "plain" }).elements;
    expect(els.map((e) => (e.kind === "paragraph" ? e.text : e.kind))).toEqual(["Line *one*", "Line two"]);
  });
});
