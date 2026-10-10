import { describe, expect, it } from "vitest";
import type { Inline } from "../src/index.ts";
import { inlineText, logicalText, parseInline } from "../src/index.ts";

const inl = (s: string) => parseInline(logicalText(s, { start: 0, end: s.length }, []));
const shape = (nodes: Inline[]): unknown[] =>
  nodes.map((n) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "styled":
        return { [n.style]: shape(n.children) };
      case "link":
        return { link: shape(n.children), url: n.url, ref: n.reference };
      case "note":
        return { note: n.text };
      case "image":
        return { image: n.src, alt: n.alt };
      case "directive":
        return { directive: n.text };
      case "lineBreak":
        return "⏎";
    }
  });

describe("emphasis", () => {
  it("reads Highland's styles", () => {
    expect(shape(inl("*italic* **bold** ***both*** _under_ ~~strike~~ +high+"))).toEqual([
      { italic: ["italic"] }, " ", { bold: ["bold"] }, " ", { boldItalic: ["both"] }, " ",
      { underline: ["under"] }, " ", { strike: ["strike"] }, " ", { highlight: ["high"] },
    ]);
  });

  it("nests", () => {
    expect(shape(inl("**bold and *italic* inside**"))).toEqual([{ bold: ["bold and ", { italic: ["italic"] }, " inside"] }]);
  });

  it("ignores delimiters that do not open or close", () => {
    expect(shape(inl("2 * 3 * 4"))).toEqual(["2 * 3 * 4"]);
    expect(shape(inl("snake_case_name"))).toEqual(["snake_case_name"]);
    expect(shape(inl("1+1+1 = 3"))).toEqual(["1+1+1 = 3"]);
    expect(shape(inl("*unclosed"))).toEqual(["*unclosed"]);
  });

  it("honours backslash escapes", () => {
    expect(shape(inl("\\*not italic\\*"))).toEqual(["*not italic*"]);
  });
});

describe("notes, links, images, directives", () => {
  it("reads notes, which are omitted from plain text", () => {
    const n = inl("a [[note]] b");
    expect(shape(n)).toEqual(["a ", { note: "note" }, " b"]);
    expect(inlineText(n)).toBe("a  b");
  });

  it("reads inline and reference links", () => {
    expect(shape(inl("[Highland 2](https://highland2.app)"))).toEqual([{ link: ["Highland 2"], url: "https://highland2.app", ref: null }]);
    expect(shape(inl("[Writing App][Highland 2] and [Highland]"))).toEqual([
      { link: ["Writing App"], url: null, ref: "Highland 2" }, " and [Highland]",
    ]);
  });

  it("reads images and inline directives", () => {
    expect(shape(inl("![Test image](assets/test-image.png)"))).toEqual([{ image: "assets/test-image.png", alt: "Test image" }]);
    expect(shape(inl("Chapter {{SERIES}}"))).toEqual(["Chapter ", { directive: "{{SERIES}}" }]);
  });
});

describe("source spans", () => {
  it("map every node back to the source, skipping hidden revision tags", () => {
    const src = "She {{REVISION: #ff0000}}**runs**{{/REVISION}} home.";
    const hidden = [
      { start: 4, end: 25 },
      { start: 33, end: 46 },
    ];
    const nodes = parseInline(logicalText(src, { start: 0, end: src.length }, hidden));
    const bold = nodes.find((n) => n.kind === "styled")!;
    expect(src.slice(bold.span.start, bold.span.end)).toBe("**runs**");
    expect(inlineText(nodes)).toBe("She runs home.");
  });
});
