import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** One printed line: text items that share a baseline on a page. */
export interface PdfLine {
  page: number;
  /** Left edge of the first item, in points from the page's left edge. */
  x: number;
  /** Baseline, in points from the page's top edge. */
  y: number;
  text: string;
  /** Font of the first item (pdf.js internal name). */
  font: string;
  /** Runs of the line separated by a gap of more than two spaces, e.g. the two columns of dual dialogue. */
  segments: { x: number; text: string }[];
}

export interface PdfPage {
  page: number;
  width: number;
  height: number;
  lines: PdfLine[];
}

interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  font: string;
}

const BASELINE_EPSILON = 0.5;
/** Gaps wider than about two Courier characters (7.2 pt each) start a new segment. */
const SEGMENT_GAP = 15;

/** Extracts every non-blank printed line of a PDF, top to bottom, left to right. */
export async function extractPages(path: string): Promise<PdfPage[]> {
  const data = new Uint8Array(await readFile(path));
  const task = getDocument({ data, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || raw.str.trim() === "") continue;
        const [, , , , e, f] = raw.transform as number[];
        items.push({ str: raw.str, x: e ?? 0, y: viewport.height - (f ?? 0), width: raw.width, font: raw.fontName });
      }
      pages.push({ page: n, width: viewport.width, height: viewport.height, lines: groupLines(n, items) });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function groupLines(page: number, items: Item[]): PdfLine[] {
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const item of items) {
    const row = rows.at(-1);
    const first = row?.at(0);
    if (row && first && Math.abs(first.y - item.y) <= BASELINE_EPSILON) row.push(item);
    else rows.push([item]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    let end = Number.NEGATIVE_INFINITY;
    for (const item of row) {
      if (text !== "" && item.x - end > 1 && !text.endsWith(" ") && !item.str.startsWith(" ")) text += " ";
      text += item.str;
      end = item.x + item.width;
    }
    const first = row[0]!;
    const segments: { x: number; text: string }[] = [];
    let segEnd = Number.NEGATIVE_INFINITY;
    for (const item of row) {
      const last = segments.at(-1);
      const gap = item.x - segEnd;
      if (last && gap <= SEGMENT_GAP) last.text += (gap > 1 && !last.text.endsWith(" ") && !item.str.startsWith(" ") ? " " : "") + item.str;
      else segments.push({ x: item.x, text: item.str });
      segEnd = item.x + item.width;
    }
    for (const seg of segments) seg.text = seg.text.trim();
    return { page, x: first.x, y: first.y, text: text.trim(), font: first.font, segments: segments.filter((s) => s.text !== "") };
  });
}
