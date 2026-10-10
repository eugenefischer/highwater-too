import { readFileSync } from "node:fs";
import { HighlandBundle } from "@highwater/bundle";
import { extractPages } from "@highwater/pdf-compare";
import { parse } from "../src/index.ts";

const norm = (s: string) => s.replace(/’/g, "'").replace(/\s+/g, " ").trim();

/**
 * Compares the parser's screenplay structure with what Highland printed:
 * every dialogue cue (single at x 249, dual at 179 / 404), scene heading count and transition count.
 */
export async function crossCheck(highlandPath: string, pdfPath: string) {
  const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(highlandPath)));
  const doc = parse(bundle.text, { mode: bundle.mode });
  const ours: string[] = [];
  for (const e of doc.elements) {
    if (e.kind === "dialogue") ours.push(norm([e.dual ? `${e.dual}:` : "", e.character, ...e.extensions].join(" ")));
  }
  const pages = await extractPages(pdfPath);
  const theirs: string[] = [];
  let afterMore = false;
  for (const page of pages.slice(1)) {
    for (const line of page.lines) {
      if (line.text === "(MORE)") afterMore = true;
      else if (Math.abs(line.x - 249) < 1.5) {
        if (afterMore) afterMore = false;
        else theirs.push(norm(line.text));
      } else {
        // Dual dialogue: both cues on one baseline, at x 179 and x ~404.
        const left = line.segments.find((g) => Math.abs(g.x - 179) < 1.5);
        const right = line.segments.find((g) => Math.abs(g.x - 404) < 2);
        const isCue = (t: string) => /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t.replace(/\([^)]*\)/g, "")) && !t.startsWith("(");
        if (left && right && isCue(left.text) && isCue(right.text)) theirs.push(norm(`left: ${left.text}`), norm(`right: ${right.text}`));
      }
    }
  }
  const headingsInPdf = pages.slice(1).flatMap((p) => p.lines).filter((l) => Math.abs(l.x - 108) < 1.5 && /^(INT|EXT|EST|I\/E)[ .]/.test(l.text)).length;
  return {
    ours,
    theirs,
    intExtHeadings: { ours: doc.elements.filter((e) => e.kind === "sceneHeading" && !e.forced).length, theirs: headingsInPdf },
  };
}
