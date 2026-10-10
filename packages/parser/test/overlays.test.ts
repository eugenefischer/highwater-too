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
