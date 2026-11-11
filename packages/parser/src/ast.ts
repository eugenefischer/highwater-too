/**
 * The parser's document tree.
 *
 * Every offset is a UTF-16 index into the source string (what `String.prototype.slice` uses),
 * end-exclusive. The top-level nodes tile the source exactly: concatenating
 * `source.slice(node.span.start, node.span.end)` over `document.nodes` reproduces the source.
 */

export interface Span {
  start: number;
  end: number;
}

export type Mode = "fountain" | "markdown" | "plain";

/** One physical line. `content` excludes the line terminator; `span` includes it. */
export interface Line {
  span: Span;
  content: Span;
}

export interface BlankNode {
  kind: "blank";
  span: Span;
  lines: Line[];
}

/** Lines that lie entirely inside a boneyard (`/* … *\/`). Omitted from output. */
export interface BoneyardNode {
  kind: "boneyard";
  span: Span;
  lines: Line[];
}

/** A run of non-blank lines, classified into elements. */
export interface TextNode {
  kind: "text";
  span: Span;
  lines: Line[];
}

export interface TitlePageNode {
  kind: "titlePage";
  span: Span;
  fields: TitleField[];
}

export interface TitleField {
  /** The key as written, e.g. "Draft date" or "TL". */
  key: string;
  /** Lower-case key with single spaces, e.g. "draft date", "tl". */
  name: string;
  keySpan: Span;
  /** The value on the key's own line (possibly empty), then each continuation line, indentation removed. */
  values: TitleValue[];
  span: Span;
}

export interface TitleValue {
  text: string;
  span: Span;
}

export type TopNode = BlankNode | BoneyardNode | TextNode | TitlePageNode;

/** `/* … *\/`, possibly inside a line or across lines. */
export interface BoneyardRange {
  span: Span;
  /** Between the delimiters. */
  inner: Span;
}

/** `{{REVISION: #rrggbb}} … {{/REVISION}}`; may cross line and block boundaries. */
export interface RevisionRange {
  /** Colour as written, e.g. "#ee2d36"; empty for a bare `{{REVISION}}`. */
  color: string;
  openTag: Span;
  /** Null when the document ends before the closing tag. */
  closeTag: Span | null;
  /** The revised text, between the tags. */
  content: Span;
}

export interface Overlays {
  boneyard: BoneyardRange[];
  revisions: RevisionRange[];
}

export interface Diagnostic {
  severity: "warning" | "error";
  message: string;
  span: Span;
}

export interface Document {
  mode: Mode;
  source: string;
  nodes: TopNode[];
  titlePage: TitlePageNode | null;
  overlays: Overlays;
  /** Classified content in reading order. */
  elements: Element[];
  /** Every `{{…}}` directive outside the title page, in source order (directive lines and inline). */
  directives: PlacedDirective[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------------------------
// Elements. Text fields are logical text: boneyards and revision tags removed,
// forcing characters and scene numbers stripped. `span` covers the element's lines in the source.

export interface ElementBase {
  span: Span;
  lines: Line[];
}

export interface SceneHeading extends ElementBase {
  inline: Inline[];
  kind: "sceneHeading";
  text: string;
  forced: boolean;
  sceneNumber: { text: string; span: Span } | null;
}

export interface Action extends ElementBase {
  inline: Inline[];
  kind: "action";
  text: string;
  forced: boolean;
}

export interface Transition extends ElementBase {
  inline: Inline[];
  kind: "transition";
  text: string;
  forced: boolean;
}

export interface Centered extends ElementBase {
  inline: Inline[];
  kind: "centered";
  text: string;
}

/** Highland: a line ending in ">" (without a leading ">") prints right-aligned. */
export interface RightAligned extends ElementBase {
  inline: Inline[];
  kind: "rightAligned";
  text: string;
}

export interface Lyric extends ElementBase {
  inline: Inline[];
  kind: "lyric";
  text: string;
}

export interface Section extends ElementBase {
  inline: Inline[];
  kind: "section";
  level: number;
  text: string;
}

export interface Synopsis extends ElementBase {
  inline: Inline[];
  kind: "synopsis";
  text: string;
}

export interface PageBreak extends ElementBase {
  kind: "pageBreak";
}

/** A line holding only `{{…}}` directives, e.g. {{HEADER: %p}}. */
export interface DirectiveLine extends ElementBase {
  kind: "directiveLine";
  text: string;
  directives: PlacedDirective[];
}

export type DialoguePart =
  | { kind: "parenthetical"; text: string; inline: Inline[]; line: Line }
  | { kind: "line"; text: string; inline: Inline[]; line: Line }
  | { kind: "lyric"; text: string; inline: Inline[]; line: Line }
  /** Fountain's two-space line: an intentional empty line inside dialogue. */
  | { kind: "empty"; line: Line };

export interface Dialogue extends ElementBase {
  kind: "dialogue";
  /** The cue without extensions, forcing "@" or dual "^", e.g. "BOB". */
  character: string;
  /** Parenthesised extensions on the cue line, e.g. ["(V.O.)", "(CONT'D)"]. */
  extensions: string[];
  forced: boolean;
  /** Set on both halves of a dual-dialogue pair. */
  dual: "left" | "right" | null;
  parts: DialoguePart[];
}

// Markdown (and plain-text) elements.

export interface Heading extends ElementBase {
  kind: "heading";
  level: number;
  text: string;
  inline: Inline[];
}

/** One line of prose: in Highland's Markdown every line is its own paragraph. */
export interface Paragraph extends ElementBase {
  kind: "paragraph";
  text: string;
  inline: Inline[];
}

export interface BlockQuote extends ElementBase {
  kind: "blockQuote";
  /** One entry per quoted paragraph; an empty ">" line separates paragraphs. */
  paragraphs: { text: string; inline: Inline[] }[];
}

/** `* * *`, printed as a centred "#". */
export interface SceneBreak extends ElementBase {
  kind: "sceneBreak";
}

export interface ListBlock extends ElementBase {
  kind: "list";
  items: { marker: string; ordered: boolean; level: number; text: string; inline: Inline[]; line: Line }[];
}

export interface TermList extends ElementBase {
  kind: "termList";
  items: { term: string; definition: string; termInline: Inline[]; definitionInline: Inline[]; line: Line }[];
}

export interface Table extends ElementBase {
  kind: "table";
  align: ("left" | "center" | "right" | null)[];
  header: { text: string; inline: Inline[] }[];
  rows: { text: string; inline: Inline[] }[][];
}

/** `[name]: url`, used by reference links; not printed. */
export interface LinkDefinition extends ElementBase {
  kind: "linkDefinition";
  label: string;
  url: string;
}

export type Element =
  | Heading
  | Paragraph
  | BlockQuote
  | SceneBreak
  | ListBlock
  | TermList
  | Table
  | LinkDefinition
  | SceneHeading
  | Action
  | Transition
  | Centered
  | RightAligned
  | Lyric
  | Section
  | Synopsis
  | PageBreak
  | DirectiveLine
  | Dialogue;

// ---------------------------------------------------------------------------------------------
// Inline content. Spans are source offsets; a node's span may contain hidden ranges
// (revision tags, inline boneyards) that its text omits.

export type InlineStyle = "italic" | "bold" | "boldItalic" | "underline" | "strike" | "highlight";

export type Inline =
  | { kind: "text"; text: string; span: Span }
  | { kind: "styled"; style: InlineStyle; children: Inline[]; span: Span }
  | { kind: "note"; text: string; span: Span }
  | { kind: "link"; children: Inline[]; url: string | null; reference: string | null; span: Span }
  | { kind: "image"; alt: string; src: string; span: Span }
  /** An inline `{{…}}`, e.g. {{SERIES}} inside a heading. */
  | { kind: "directive"; text: string; directive: Directive; span: Span }
  /** Between the physical lines of one element. */
  | { kind: "lineBreak"; span: Span };

// ---------------------------------------------------------------------------------------------
// Directives (step 4). The parser reads them; numbering, dates, includes and page furniture are
// applied later (series counter and include resolver in this package, the rest in the PDF engine).

/** One piece of a header or footer slot. */
export type PageTextPart =
  | { kind: "text"; text: string }
  /** %p */
  | { kind: "page" }
  /** %pp */
  | { kind: "pageCount" }
  /** %#: the current section (screenplay) or heading (manuscript) title */
  | { kind: "section" };

/** Null slots print nothing. */
export interface PageTextSlots {
  left: PageTextPart[] | null;
  center: PageTextPart[] | null;
  right: PageTextPart[] | null;
}

export type Directive =
  /** `{{HEADER: …}}` / `{{FOOTER: …}}`; `off` for %none. */
  | { kind: "header" | "footer"; off: boolean; slots: PageTextSlots }
  /** `{{PAGENUMBER: n}}`; `value` is null when n is not a whole number. */
  | { kind: "pageNumber"; value: number | null }
  | { kind: "include"; path: string }
  /**
   * `{{SERIES}}` adds 1 to the document's one counter; `{{SERIES: 5}}` sets it to 5. Any other
   * value is kept in `label` but ignored, as Highland does.
   */
  | { kind: "series"; start: number | null; label: string | null }
  | { kind: "timestamp"; format: string | null }
  /** `{{TOC}}`, `{{TOC: # ###}}`; `levels` null means every heading level. */
  | { kind: "toc"; levels: number[] | null }
  /** `{{%m:label}}` */
  | { kind: "marker"; label: string }
  /** Anything else: preserved and shown dimmed. */
  | { kind: "other"; name: string; value: string | null };

export interface PlacedDirective {
  directive: Directive;
  /** As written, braces included. */
  text: string;
  span: Span;
  /** True inside a line of other text; false on a line holding only directives. */
  inline: boolean;
}
