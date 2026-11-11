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
  /** Font family (prose templates; default Courier Prime), size in points (default 12) and colour. */
  font?: string;
  size?: number;
  color?: string;
  /** Inside a {{REVISION}} (marked with a star in the margin when revision stars are printed). */
  revised?: boolean;
  /**
   * Where the run starts in the script's source: set only when paragraph numbers are printed,
   * which go beside the first printed line of each numbered source line.
   */
  src?: number;
}

/**
 * Highland's print options (its preview's bottom bar), apart from the title page. Paragraph numbers
 * are given by the source offset where each numbered line starts.
 */
export interface PrintMarks {
  notes?: boolean;
  synopses?: boolean;
  revisionColor?: boolean;
  revisionStars?: boolean;
  numbers?: Map<number, number>;
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
  /** Justified to this width: the spaces stretch (Novel). */
  justify?: number;
  /** Highland prints no paragraph number here (a paragraph opening on a manuscript page's last line). */
  unnumbered?: boolean;
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
  /** Font files for runs that name a font (prose templates), by `${family}/${variant}`. */
  fonts?: Record<string, { path: string; postscriptName?: string }>;
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
