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
  diagnostics: Diagnostic[];
}
