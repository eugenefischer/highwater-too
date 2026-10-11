/** Output of layout, input of rendering. Units are PDF points; y is the text baseline from the top of the page. */

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: boolean;
  /** Printed blue and underlined (manuscripts). */
  link?: boolean;
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
