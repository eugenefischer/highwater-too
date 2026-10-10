import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderPdf, type Layout } from "../src/index.ts";

/** Line segments (moveto/lineto pairs) in the page content, in PDFKit's top-down coordinates. */
function strokes(pdf: Uint8Array): number[][] {
  const text = Buffer.from(pdf).toString("latin1");
  const out: number[][] = [];
  for (const m of text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let s: string;
    try {
      s = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const l of s.matchAll(/([\d.]+) ([\d.]+) m\n([\d.]+) ([\d.]+) l/g)) out.push([Number(l[1]), Number(l[2]), Number(l[3]), Number(l[4])]);
  }
  return out;
}

describe("renderPdf", () => {
  it("underlines 2.1 pt below the baseline, as Highland does, and strikes through the middle", async () => {
    const layout: Layout = {
      width: 612,
      height: 792,
      pages: [{ number: null, items: [{ x: 100, y: 300, runs: [{ text: "under", style: { underline: true } }, { text: " plain ", style: {} }, { text: "gone", style: { strike: true } }] }] }],
    };
    const lines = strokes(await renderPdf(layout, { creationDate: new Date(0) }));
    expect(lines).toEqual([
      [100, 302.1, 136, 302.1],
      [100 + 12 * 7.2, 297, 100 + 16 * 7.2, 297],
    ]);
  });
});
