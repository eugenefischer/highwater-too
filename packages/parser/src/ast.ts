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

/** A run of non-blank lines. Step 2 and 3 classify these into scene headings, dialogue, paragraphs, … */
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
  /** Colour as written, e.g. "#ee2d36". */
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
  /** Classified content in reading order (Fountain from step 2; Markdown from step 3). */
  elements: Element[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------------------------
// Elements (step 2: Fountain). Text fields are logical text: boneyards and revision tags removed,
// forcing characters and scene numbers stripped. `span` covers the element's lines in the source.

export interface ElementBase {
  span: Span;
  lines: Line[];
}

export interface SceneHeading extends ElementBase {
  kind: "sceneHeading";
  text: string;
  forced: boolean;
  sceneNumber: { text: string; span: Span } | null;
}

export interface Action extends ElementBase {
  kind: "action";
  text: string;
  forced: boolean;
}

export interface Transition extends ElementBase {
  kind: "transition";
  text: string;
  forced: boolean;
}

export interface Centered extends ElementBase {
  kind: "centered";
  text: string;
}

/** Highland: a line ending in ">" (without a leading ">") prints right-aligned. */
export interface RightAligned extends ElementBase {
  kind: "rightAligned";
  text: string;
}

export interface Lyric extends ElementBase {
  kind: "lyric";
  text: string;
}

export interface Section extends ElementBase {
  kind: "section";
  level: number;
  text: string;
}

export interface Synopsis extends ElementBase {
  kind: "synopsis";
  text: string;
}

export interface PageBreak extends ElementBase {
  kind: "pageBreak";
}

/** A line holding only `{{…}}` directives, e.g. {{HEADER: %p}}. Parsed in step 4. */
export interface DirectiveLine extends ElementBase {
  kind: "directiveLine";
  text: string;
}

export type DialoguePart =
  | { kind: "parenthetical"; text: string; line: Line }
  | { kind: "line"; text: string; line: Line }
  | { kind: "lyric"; text: string; line: Line }
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

export type Element =
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
