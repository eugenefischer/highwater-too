import { wrapRuns } from "./text.ts";
import type { Layout, PlacedText } from "./types.ts";

/**
 * Highland 2's Plain Text template (M10, PlainTextProbe): the text printed exactly as typed, in
 * Courier Prime 12 from x 72, 65 characters wide (broken at spaces, words longer than the line
 * broken at 65), 12 pt apart from baseline 81, 54 lines a page. No title page, header, footer or
 * page numbers; markup, directives and "===" print as typed. Each empty line prints as an empty
 * line, except that a page never starts with one, and one falling on line 55 is dropped.
 */
export const PLAIN_TEXT = { width: 612, height: 792, x: 72, chars: 65, firstLineY: 81, lineHeight: 12, linesPerPage: 54 } as const;

export function layoutPlainText(source: string): Layout {
  const P = PLAIN_TEXT;
  const pages: { number: number; items: PlacedText[] }[] = [];
  let items: PlacedText[] = [];
  let used = 0;
  const flush = () => {
    pages.push({ number: pages.length + 1, items });
    items = [];
    used = 0;
  };
  let offset = 0;
  for (const raw of source.split("\n")) {
    const text = raw.replace(/\r$/, "");
    const start = offset;
    offset += raw.length + 1;
    if (text.trim() === "") {
      // A blank line on a full page (line 55) or at the top of a page takes no line.
      if (used > 0 && used < P.linesPerPage) used++;
      continue;
    }
    for (const runs of wrapRuns([{ text, style: {} }], P.chars)) {
      if (used >= P.linesPerPage) flush();
      items.push({ x: P.x, y: P.firstLineY + used * P.lineHeight, runs, source: start });
      used++;
    }
  }
  if (items.length || pages.length === 0) flush();
  return { width: P.width, height: P.height, pages };
}
