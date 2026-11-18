import { describe, expect, it } from "vitest";
import { hiddenRanges, logicalText, offsetAt, parse } from "../src/index.ts";
import { expectTiling } from "./helpers.ts";

const slice = (s: string, span: { start: number; end: number }) => s.slice(span.start, span.end);

describe("boneyard", () => {
  const src = "[[note about it]]\n/*\nThis stuff is in the boneyard\n*/\n\n+this is highlighted+\n";

  it("groups whole boneyard lines into a boneyard node", () => {
    const doc = parse(src, { mode: "fountain" });
    expect(doc.nodes.map((n) => n.kind)).toEqual(["text", "boneyard", "blank", "text"]);
    expect(slice(src, doc.nodes[1]!.span)).toBe("/*\nThis stuff is in the boneyard\n*/\n");
    expectTiling(doc);
  });

  it("keeps offsets exact after a boneyard (Better Fountain drifted here)", () => {
    const doc = parse(src, { mode: "fountain" });
    const after = doc.nodes[3]!;
    expect(slice(src, after.span)).toBe("+this is highlighted+\n");
  });

  it("records inline boneyards and leaves their line as text", () => {
    const inline = "She stops. /* cut this */ She goes.";
    const doc = parse(inline, { mode: "fountain" });
    expect(doc.nodes.map((n) => n.kind)).toEqual(["text"]);
    expect(slice(inline, doc.overlays.boneyard[0]!.span)).toBe("/* cut this */");
    expect(slice(inline, doc.overlays.boneyard[0]!.inner)).toBe(" cut this ");
  });

  it("warns about an unclosed boneyard and treats it as text", () => {
    const doc = parse("Start /* never closed\n\nMore", { mode: "fountain" });
    expect(doc.overlays.boneyard).toHaveLength(0);
    expect(doc.diagnostics[0]!.message).toMatch(/never closed/);
  });
});

describe("HTML comments in Markdown", () => {
  it("are boneyards in Markdown only: whole lines, inline, and left out of the logical text", () => {
    const src = "# Heading\n\n<!--\nA cut paragraph.\n-->\n\nShe stops. <!-- cut this --> She goes.\n\n<!-- highwater: 1a2b3c4d -->\n";
    const doc = parse(src, { mode: "markdown" });
    expect(doc.overlays.boneyard.map((b) => slice(src, b.span))).toEqual(["<!--\nA cut paragraph.\n-->", "<!-- cut this -->", "<!-- highwater: 1a2b3c4d -->"]);
    expect(slice(src, doc.overlays.boneyard[1]!.inner)).toBe(" cut this ");
    expect(doc.nodes.filter((n) => n.kind === "boneyard").map((n) => slice(src, n.span))).toEqual(["<!--\nA cut paragraph.\n-->\n", "<!-- highwater: 1a2b3c4d -->\n"]);
    const paragraphs = doc.elements.filter((e) => e.kind === "paragraph").map((e) => (e as { text: string }).text);
    expect(paragraphs).toEqual(["She stops.  She goes."]);
    expectTiling(doc);
    // A screenplay's <!-- is just text.
    expect(parse(src, { mode: "fountain" }).overlays.boneyard).toEqual([]);
  });

  it("warns about an unclosed comment and treats it as text", () => {
    const doc = parse("Start <!-- never closed\n\nMore", { mode: "markdown" });
    expect(doc.overlays.boneyard).toHaveLength(0);
    expect(doc.diagnostics[0]!.message).toMatch(/never closed/);
  });
});

describe("YAML front matter in Markdown", () => {
  const yaml = "---\ntitle: The Story\ntags:\n  - draft\n- second\n# a comment\n\nauthor: \"E. F.\"\n---\n\n# Chapter One\n\nShe walked.\n\n---\n\nLater.\n";

  it("is hidden like a boneyard, at the very top of a Markdown file only", () => {
    const doc = parse(yaml, { mode: "markdown" });
    const end = yaml.indexOf("---\n\n# Chapter") + 3;
    expect(doc.frontMatter).toEqual({ start: 0, end });
    expect(doc.overlays.boneyard[0]).toMatchObject({ span: { start: 0, end }, frontMatter: true });
    expect(doc.nodes[0]).toMatchObject({ kind: "boneyard", span: { start: 0, end: end + 1 } });
    // The text after it is as usual, including a later --- (a page break or rule).
    expect(doc.elements.map((e) => e.kind)).toContain("heading");
    expect(doc.elements.filter((e) => e.kind === "paragraph").map((e) => (e as { text: string }).text)).toEqual(["She walked.", "---", "Later."]);
    expectTiling(doc);
    expect(parse(yaml, { mode: "fountain" }).frontMatter).toBeNull();
  });

  it("ends at --- or ..., and allows a byte-order mark first", () => {
    expect(parse("---\ntitle: A\n...\nText.\n", { mode: "markdown" }).frontMatter).toEqual({ start: 0, end: 16 });
    expect(parse("\ufeff---\ntitle: A\n---\n", { mode: "markdown" }).frontMatter).toEqual({ start: 0, end: 17 });
  });

  it("is not taken for scene breaks, a blank line after the first ---, or an unclosed block", () => {
    for (const src of ["---\nShe walked to the pier.\n---\n", "---\n\ntitle: A\n---\n", "---\ntitle: A\n\nMore\n", "Text\n---\ntitle: A\n---\n", "---\n---\n"]) {
      expect(parse(src, { mode: "markdown" }).frontMatter, src).toBeNull();
    }
  });
});

describe("revision tags", () => {
  // From the MaximalScreenplay sample: a revision crosses a paragraph break, and a second starts right after it.
  const src =
    "Now I am in a sprint I will stop early{{REVISION: #ee2d36}} here is a revision.\n\n{{/REVISION}}{{REVISION: #07a04a}}here is another revision{{/REVISION}}";

  it("finds both revisions with colours and exact content", () => {
    const doc = parse(src, { mode: "fountain" });
    expect(doc.overlays.revisions.map((r) => [r.color, slice(src, r.content)])).toEqual([
      ["#ee2d36", " here is a revision.\n\n"],
      ["#07a04a", "here is another revision"],
    ]);
    expect(doc.diagnostics).toEqual([]);
    expectTiling(doc);
  });

  it("reads lines without tags or boneyard through logicalText, mapping back to the source", () => {
    const doc = parse(src, { mode: "fountain" });
    const hidden = hiddenRanges(doc.overlays);
    const second = doc.nodes.at(-1)!;
    const lt = logicalText(src, second.span, hidden);
    expect(lt.text).toBe("here is another revision");
    expect(src[offsetAt(lt, 0)]).toBe("h");
    expect(offsetAt(lt, 0)).toBe(src.indexOf("here is another"));
  });

  it("warns about a stray close tag and an unclosed revision", () => {
    expect(parse("text{{/REVISION}}", { mode: "fountain" }).diagnostics[0]!.message).toMatch(/without a matching/);
    const open = parse("{{REVISION: #ff0000}}to the end", { mode: "fountain" });
    expect(open.overlays.revisions[0]!.closeTag).toBeNull();
    expect(open.diagnostics[0]!.message).toMatch(/never closed/);
  });

  it("ignores revision tags inside a boneyard", () => {
    const doc = parse("/* {{REVISION: #ff0000}} */ text", { mode: "fountain" });
    expect(doc.overlays.revisions).toEqual([]);
  });
});

describe("bare revision tag", () => {
  it("opens a revision without a colour", () => {
    const doc = parse("Plain {{REVISION}}revised{{/REVISION}} text.", { mode: "fountain" });
    expect(doc.overlays.revisions).toHaveLength(1);
    expect(doc.overlays.revisions[0]!.color).toBe("");
    expect(doc.elements[0]!.kind === "action" && doc.elements[0].text).toBe("Plain revised text.");
    expect(doc.diagnostics).toEqual([]);
  });
});
