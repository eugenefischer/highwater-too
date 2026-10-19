/**
 * Highland 2's prose templates, measured from its PDFs of the M10 probes (project doc
 * highland-template-measurements-m10.md). y values are baselines; line boxes stack from `top`.
 */
export interface TextSpec {
  font: string;
  size: number;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  color?: string | undefined;
}

export interface HeadingSpec {
  font?: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align: "left" | "centre";
  /** Baseline below the box top, and the box's height (with the space after it, in templates that drop empty lines). */
  ascent: number;
  height: number;
}

export interface ProseTemplate {
  name: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  body: TextSpec & { pitch: number; ascent: number; justify?: boolean };
  /** Empty source lines print as empty lines (the space between paragraphs); else they are dropped. */
  blankLines: boolean;
  indent: { first: number; rule: "none" | "afterParagraph" | "all" };
  /** The first line after a heading or scene break in small capitals (Novel). */
  smallCapsAfterHeading?: boolean;
  headings: [HeadingSpec, HeadingSpec, HeadingSpec, HeadingSpec, HeadingSpec, HeadingSpec];
  quote: { indent: number; italic?: boolean; color?: string; size?: number; font?: string };
  /** List text this far from the left margin (marker right-aligned before it); nested items further. */
  list: { text: number; nested: number };
  sceneBreak: { kind: "rule"; height: number; rule: number } | { kind: "asterism"; height: number; ascent: number };
  header: { y: number; size: number; bold?: boolean; caps?: boolean; font?: string };
  footer: { y: number; size: number; bold?: boolean; font?: string };
  /** Without a {{HEADER}}: the page number from page 2, "N" or "N." (Novel adds the title, centred). */
  pageNumber: { where: "header" | "footer"; format: string; title?: boolean };
  title: { kind: "page"; ys: [number, number, number, number]; bottom: number; size: number; font?: string; titleSize?: number; titleItalic?: boolean } | { kind: "mla" };
}

const BOX = (pitch: number, ascent: number) => ({ ascent, height: pitch });

/** Novel: Amiri, justified, indented paragraphs with no space between; centred headings. */
export const NOVEL: ProseTemplate = {
  name: "Novel",
  left: 108,
  right: 504,
  top: 72,
  bottom: 720,
  body: { font: "Amiri", size: 13, pitch: 20.8, ascent: 14, justify: true },
  blankLines: false,
  indent: { first: 18, rule: "afterParagraph" },
  smallCapsAfterHeading: true,
  headings: [
    // The first heading measured opens a page: its baseline sits 150 pt below the top.
    { size: 24, italic: true, align: "centre", ascent: 150, height: 184.8 },
    { size: 18, align: "centre", ascent: 19, height: 42.34 },
    { size: 13, align: "centre", ...BOX(20.8, 14) },
    { size: 13, align: "centre", ...BOX(20.8, 14) },
    { size: 13, align: "centre", ...BOX(20.8, 14) },
    { size: 13, align: "centre", ...BOX(20.8, 14) },
  ],
  quote: { indent: 36, italic: true },
  list: { text: 48.2, nested: 18 },
  sceneBreak: { kind: "asterism", height: 59.8, ascent: 36 },
  header: { y: 47.2, size: 13, caps: true },
  footer: { y: 739.2, size: 13 },
  pageNumber: { where: "header", format: "N", title: true },
  title: { kind: "page", ys: [238.4, 315.8, 360.2, 433.4], bottom: 715.4, size: 13, titleSize: 24, titleItalic: true },
};

/** Treatment: Highland Sans, single-spaced, plain headings. */
export const TREATMENT: ProseTemplate = {
  name: "Treatment",
  left: 72,
  right: 540,
  top: 72,
  bottom: 720,
  body: { font: "Highland Sans", size: 12, pitch: 12, ascent: 9 },
  blankLines: true,
  indent: { first: 0, rule: "none" },
  headings: [
    { size: 12, bold: true, align: "left", ...BOX(12, 9) },
    { size: 12, align: "left", ...BOX(12, 9) },
    { size: 12, align: "left", ...BOX(12, 9) },
    { size: 12, align: "left", ...BOX(12, 9) },
    { size: 12, italic: true, align: "left", ...BOX(12, 9) },
    { size: 12, align: "left", ...BOX(12, 9) },
  ],
  quote: { indent: 36 },
  list: { text: 36, nested: 18 },
  sceneBreak: { kind: "rule", height: 12, rule: 5.1 },
  header: { y: 51, size: 12 },
  footer: { y: 747, size: 12 },
  pageNumber: { where: "header", format: "N." },
  title: { kind: "page", ys: [241.4, 313.4, 356.6, 428.6], bottom: 716.6, size: 12 },
};

/** Modern Standard: Avenir Next, bold headings, the page number centred at the foot. */
export const MODERN_STANDARD: ProseTemplate = {
  name: "Modern Standard",
  left: 72,
  right: 540,
  top: 72,
  bottom: 720,
  body: { font: "Avenir Next", size: 11, pitch: 16.5, ascent: 12 },
  blankLines: true,
  indent: { first: 0, rule: "none" },
  headings: [
    { size: 20, bold: true, align: "left", ascent: 22, height: 32 },
    { size: 16, bold: true, align: "left", ascent: 13, height: 16 },
    { size: 13, bold: true, align: "left", ascent: 12, height: 16 },
    { size: 11, bold: true, color: "#949494", align: "left", ...BOX(16.5, 12) },
    { size: 11, bold: true, italic: true, align: "left", ...BOX(16.5, 12) },
    { size: 11, bold: true, align: "centre", ...BOX(16.5, 12) },
  ],
  quote: { indent: 36, italic: true },
  list: { text: 26.4, nested: 18 },
  sceneBreak: { kind: "rule", height: 16.5, rule: 8 },
  header: { y: 45.5, size: 8, bold: true, caps: true },
  footer: { y: 739.5, size: 8, bold: true },
  pageNumber: { where: "footer", format: "N" },
  title: { kind: "page", ys: [230.8, 301.6, 343.6, 414.4], bottom: 716.8, size: 11 },
};

/** Article: Georgia, Lato headings, grey italic quotes. */
export const ARTICLE: ProseTemplate = {
  name: "Article",
  left: 72,
  right: 540,
  top: 72,
  bottom: 720,
  body: { font: "Georgia", size: 12, pitch: 18, ascent: 13 },
  blankLines: true,
  indent: { first: 0, rule: "none" },
  headings: [
    { font: "Lato", size: 22, align: "left", ascent: 26, height: 35.86 },
    { font: "Lato", size: 18, bold: true, align: "left", ascent: 16, height: 18 },
    // Highland prints no level-3 heading in Article (keeping its space): a quirk we fix.
    { font: "Lato", size: 14, bold: true, align: "left", ascent: 14, height: 18 },
    { font: "Lato", size: 12, bold: true, align: "left", ...BOX(18, 13) },
    { font: "Lato", size: 12, bold: true, italic: true, align: "left", ...BOX(18, 13) },
    { font: "Lato", size: 12, bold: true, align: "centre", ...BOX(18, 13) },
  ],
  quote: { indent: 36, italic: true, color: "#949494" },
  list: { text: 30.3, nested: 18 },
  sceneBreak: { kind: "rule", height: 18, rule: 9 },
  header: { y: 49, size: 12, caps: true },
  footer: { y: 742, size: 12, bold: true },
  pageNumber: { where: "header", format: "N." },
  title: { kind: "page", ys: [241.4, 313.4, 356.6, 428.6], bottom: 716.6, size: 12 },
};

/** Bulletin: SF Pro Display, a very large first heading. */
export const BULLETIN: ProseTemplate = {
  name: "Bulletin",
  left: 72,
  right: 540,
  top: 72,
  bottom: 720,
  body: { font: "SF Pro Display", size: 11, pitch: 16.5, ascent: 12 },
  blankLines: true,
  indent: { first: 0, rule: "none" },
  headings: [
    { size: 60, bold: true, align: "centre", ascent: 51, height: 60 },
    { size: 21, bold: true, align: "left", ascent: 22, height: 29.82 },
    { size: 14, bold: true, align: "left", ascent: 12, height: 14.98 },
    { size: 14, bold: true, color: "#959595", align: "left", ascent: 15, height: 21 },
    { size: 11, bold: true, italic: true, align: "left", ...BOX(16.5, 12) },
    { size: 11, bold: true, align: "centre", ...BOX(16.5, 12) },
  ],
  quote: { indent: 36, size: 10 },
  list: { text: 25.81, nested: 18 },
  sceneBreak: { kind: "rule", height: 16.5, rule: 8 },
  header: { y: 46.5, size: 8, bold: true, caps: true },
  footer: { y: 740.5, size: 8, bold: true },
  pageNumber: { where: "footer", format: "N" },
  title: { kind: "page", ys: [230.8, 301.6, 343.6, 414.4], bottom: 716.8, size: 11 },
};

/** Speech: New York, 18 pt on a 32.4 pt line, for reading aloud. */
export const SPEECH: ProseTemplate = {
  name: "Speech",
  left: 72,
  right: 540,
  top: 84,
  bottom: 720,
  body: { font: "New York Medium", size: 18, pitch: 32.4, ascent: 23 },
  blankLines: true,
  indent: { first: 0, rule: "none" },
  headings: [
    { size: 27, bold: true, align: "left", ascent: 27, height: 34.56 },
    { size: 24, bold: true, italic: true, align: "left", ascent: 26, height: 36 },
    { size: 18, bold: true, align: "centre", ...BOX(32.4, 23) },
    { size: 18, bold: true, align: "left", ...BOX(32.4, 23) },
    { size: 18, bold: true, italic: true, align: "left", ...BOX(32.4, 23) },
    { size: 18, bold: true, align: "centre", ...BOX(32.4, 23) },
  ],
  quote: { indent: 36 },
  list: { text: 46.58, nested: 18 },
  sceneBreak: { kind: "rule", height: 32.4, rule: 16 },
  header: { y: 53.6, size: 18, caps: true },
  // Highland prints the footer at 724.6, over the text: moved below it.
  footer: { y: 760, size: 18, bold: true },
  pageNumber: { where: "header", format: "N" },
  title: { kind: "page", ys: [235.4, 314.6, 365, 444.2], bottom: 703.4, size: 18 },
};

/** MLA Report: Times New Roman, double-spaced, every paragraph indented; the heading block on page 1. */
export const MLA_REPORT: ProseTemplate = {
  name: "MLA Report",
  left: 72,
  right: 540,
  top: 72,
  bottom: 720,
  body: { font: "Times New Roman", size: 12, pitch: 24.51, ascent: 16 },
  blankLines: false,
  indent: { first: 36, rule: "all" },
  headings: [
    { size: 12, align: "centre", ascent: 28, height: 48.51 },
    { size: 12, align: "left", ascent: 28, height: 48.51 },
    { size: 12, align: "left", ascent: 28, height: 48.51 },
    { size: 12, align: "left", ascent: 28, height: 48.51 },
    { size: 12, align: "left", ascent: 28, height: 48.51 },
    { size: 12, align: "left", ascent: 28, height: 48.51 },
  ],
  quote: { indent: 36 },
  list: { text: 29.34, nested: 18 },
  sceneBreak: { kind: "rule", height: 24.51, rule: 12 },
  header: { y: 46, size: 12 },
  footer: { y: 736, size: 12 },
  pageNumber: { where: "header", format: "N." },
  title: { kind: "mla" },
};

/** Wiki: Georgia, graded headings, reference style. */
export const WIKI: ProseTemplate = {
  name: "Wiki",
  left: 72,
  right: 540,
  top: 72,
  bottom: 720,
  body: { font: "Georgia", size: 12, pitch: 19.2, ascent: 14 },
  blankLines: true,
  indent: { first: 0, rule: "none" },
  headings: [
    { size: 23.75, align: "left", ascent: 28, height: 38.24 },
    { size: 17.75, align: "left", ascent: 16, height: 19.17 },
    { size: 14.75, bold: true, align: "left", ascent: 15, height: 19.17 },
    { size: 13.25, bold: true, color: "#959595", align: "centre", ascent: 14, height: 19.08 },
    { size: 12, bold: true, italic: true, align: "left", ...BOX(19.2, 14) },
    { size: 12, bold: true, align: "centre", ...BOX(19.2, 14) },
  ],
  quote: { indent: 36 },
  list: { text: 30.29, nested: 18 },
  sceneBreak: { kind: "rule", height: 19.2, rule: 9.6 },
  header: { y: 48.8, size: 12, caps: true },
  footer: { y: 740.8, size: 12, bold: true },
  pageNumber: { where: "header", format: "N." },
  title: { kind: "page", ys: [241.4, 313.4, 356.6, 428.6], bottom: 716.6, size: 12 },
};

/** The prose templates, by the name Highland stores in info.json. */
export const PROSE_TEMPLATES: Record<string, ProseTemplate> = {
  Novel: NOVEL,
  Treatment: TREATMENT,
  "Modern Standard": MODERN_STANDARD,
  Article: ARTICLE,
  Bulletin: BULLETIN,
  Speech: SPEECH,
  "MLA Report": MLA_REPORT,
  Wiki: WIKI,
};
