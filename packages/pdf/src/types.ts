/** Output of layout, input of rendering. Units are PDF points; y is the text baseline from the top of the page. */

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: boolean;
  /** Printed blue and underlined (manuscripts). */
  link?: boolean;
  /** The link's address, when known (used by the .docx export; the PDF prints only the text). */
  href?: string;
  /** A heavy rule under the text: 2 pt, 3 pt below the baseline (Graphic Novel's top-level sections). */
  rule?: boolean;
}

/** A piece of text in one style. */
export interface Run {
  text: string;
  style: TextStyle;
}

/** Text placed at a position. */
export interface PlacedText {
  x: number;
  y: number;
  runs: Run[];
  /** Offset in the script's source this line was printed from (for scroll sync and click-to-jump). */
  source?: number;
  /** Highlight box relative to the baseline: top offset and height (default: the screenplay's -9.5, 12.5). */
  highlightBox?: { top: number; height: number; color: string };
}

/** A filled rectangle (table rules) or an image; y is the top edge. */
export type Graphic =
  | { kind: "rect"; x: number; y: number; width: number; height: number; gray: number }
  | { kind: "image"; x: number; y: number; width: number; height: number; data: Uint8Array };

export interface Page {
  /** The page number to show (title page: null). */
  number: number | null;
  items: PlacedText[];
  graphics?: Graphic[];
}

export interface Layout {
  /** Letter: 612 × 792. */
  width: number;
  height: number;
  pages: Page[];
}

/** Courier Prime at 12 pt: every character is 7.2 pt wide. */
export const CHAR = 7.2;

export function runsText(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

/** Where in the script a block of printed lines comes from. */
export interface SourceRange {
  start: number;
  end: number;
}

/**
 * Gives every printed line a source offset: consecutive lines from the same range (one element,
 * maybe split across pages) share it out by line, so a long paragraph's middle maps to its middle.
 */
export function assignSources(lines: { range: SourceRange | undefined; items: PlacedText[] }[]): void {
  for (let i = 0; i < lines.length; ) {
    const range = lines[i]!.range;
    let j = i + 1;
    while (j < lines.length && lines[j]!.range === range) j++;
    if (range) {
      const n = j - i;
      for (let k = 0; k < n; k++) {
        const offset = range.start + Math.floor(((range.end - range.start) * k) / n);
        for (const it of lines[i + k]!.items) it.source = offset;
      }
    }
    i = j;
  }
}
