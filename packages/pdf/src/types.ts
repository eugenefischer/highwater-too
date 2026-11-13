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
 * With the source text, each line's offset is then made exact: where its first words are in the
 * source, nearest that estimate and in order (Show Page Breaks needs the very line a page starts
 * with; the estimate could be a line out). Lines whose words can't be found keep the estimate.
 * Lines the layout added to a split speech aren't looked for: "(MORE)" takes the place of the line
 * before it, the cue repeated with "(CONT’D)" that of the line after it (where the page starts).
 */
export function assignSources(lines: { range: SourceRange | undefined; items: PlacedText[]; added?: "more" | "contd" | undefined }[], source?: string): void {
  for (let i = 0; i < lines.length; ) {
    const range = lines[i]!.range;
    let j = i + 1;
    while (j < lines.length && lines[j]!.range === range) j++;
    if (range) {
      const n = j - i;
      let floor = range.start;
      // The line before: where it starts (when found) and how long it printed.
      let previous: { at: number; length: number } | null = { at: range.start, length: -1 };
      const offsets: (number | undefined)[] = [];
      for (let k = 0; k < n; k++) {
        if (lines[i + k]!.added) continue;
        const text = lines[i + k]!.items.map((it) => runsText(it.runs)).join(" ");
        const shared = range.start + Math.floor(((range.end - range.start) * k) / n);
        // Next after the line before (its printed length and a space), else the shared-out guess.
        const estimate: number = previous && previous.length >= 0 ? previous.at + previous.length + 1 : shared;
        const exact: number | null = source && k > 0 ? lineStart(source, range, text, estimate, floor) : null;
        const offset = exact ?? (k === 0 ? range.start : shared);
        if (exact !== null) floor = exact + 1;
        previous = exact !== null || k === 0 ? { at: offset, length: text.trimEnd().length } : null;
        offsets[k] = offset;
      }
      for (let k = 0; k < n; k++) {
        const line = lines[i + k]!;
        let offset = offsets[k];
        // An added line: the place of the line before it ("(MORE)") or after it (the repeated cue).
        const step = line.added === "more" ? -1 : 1;
        for (let m = k + step; offset === undefined && m >= 0 && m < n; m += step) offset = offsets[m];
        for (let m = k - step; offset === undefined && m >= 0 && m < n; m -= step) offset = offsets[m];
        for (const it of line.items) it.source = offset ?? range.start;
      }
    }
    i = j;
  }
}

/**
 * Where a printed line starts in the source: its first three words (else two, else one) found
 * with anything between them that isn't a letter or digit (markup, dashes, quotes, line breaks),
 * the occurrence at or after `floor` nearest `estimate`, moved back over the punctuation the
 * printed line opens with (an opening quote). Null if the words aren't there (text from an included file, say).
 */
function lineStart(source: string, range: SourceRange, text: string, estimate: number, floor: number): number | null {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const within = source.slice(range.start, range.end);
  for (let count = Math.min(3, words.length); count >= 1; count--) {
    const pattern = new RegExp(words.slice(0, count).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]+"), "giu");
    let best: number | null = null;
    // Step one character at a time so repeated words still match at every start.
    for (let m = pattern.exec(within); m; pattern.lastIndex = m.index + 1, m = pattern.exec(within)) {
      const at = range.start + m.index;
      if (m.index > 0 && /[\p{L}\p{N}]/u.test(within[m.index - 1]!)) continue;
      if (at < floor) continue;
      if (best === null || Math.abs(at - estimate) < Math.abs(best - estimate)) best = at;
      else if (at > estimate) break;
    }
    if (best !== null) {
      // Back over as much punctuation as the printed line opens with (a quote, a parenthesis); not
      // over a hyphen or dash that ends the line above ("eye-" then "catching").
      const opens = (text.trimStart().match(/^[^\p{L}\p{N}\s]*/u)?.[0] ?? "").length;
      let start = best;
      for (let k = 0; k < opens && start > floor && start > range.start && !/[\s\p{L}\p{N}]/u.test(source[start - 1]!); k++) start--;
      return start;
    }
  }
  return null;
}
