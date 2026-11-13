import type { Document } from "@highwater/parser";
import { MARGINS } from "../syntax/margins.ts";

/**
 * How the Highwater Editor shows each source line: a kind, for its look, and an indent
 * in characters from the left of the page column. Unlike Live Margins (inlay hints, first visual
 * line only), the indent applies to the whole line, so wrapped lines stay indented, as in Highland.
 * Pure: used by the webview's script and by tests.
 */
export type LineKind =
  | "scene"
  | "action"
  | "cue"
  | "parenthetical"
  | "dialogue"
  | "lyric"
  | "transition"
  | "centered"
  | "section"
  | "synopsis"
  | "pageBreak"
  | "directive"
  | "title"
  | "heading"
  | "quote"
  | "list"
  | "paragraph"
  | "boneyard";

export interface LineStyle {
  kind: LineKind;
  /** Characters from the page column's left edge. */
  indent: number;
  /** Characters the line may run to before wrapping, if narrower than the column. */
  width?: number;
  /** Heading level (Markdown) or section depth. */
  level?: number;
  /** Right-aligned (transitions) or centred. */
  align?: "right" | "center";
}

/** Dialogue wraps after 34 characters and parentheticals after 28, as the printed page. */
export const DIALOGUE_WIDTH = 34;
export const PAREN_WIDTH = 28;

/** The page column's width in characters, as the printed page: 63 for scripts, 65 for prose. */
export function columnWidth(doc: Document): number {
  return doc.mode === "fountain" ? MARGINS.width : MARGINS.manuscriptWidth;
}

/**
 * The narrowest the page column may get, in characters: as in Highland, a narrow window takes the
 * space between dialogue and the right edge first, and stops where dialogue would have to reflow.
 * Prose has no such limit.
 */
export function columnMinimum(doc: Document): number {
  return doc.mode === "fountain" ? MARGINS.dialogue + DIALOGUE_WIDTH : 0;
}

/** Each source line's style, keyed by the offset where the line starts. Lines not listed are plain. */
export function lineStyles(doc: Document): Map<number, LineStyle> {
  const out = new Map<number, LineStyle>();
  const set = (at: number, style: LineStyle) => out.set(at, style);
  if (doc.titlePage) {
    for (let at = doc.titlePage.span.start; at < doc.titlePage.span.end; ) {
      set(at, { kind: "title", indent: 0 });
      const nl = doc.source.indexOf("\n", at);
      if (nl < 0) break;
      at = nl + 1;
    }
  }
  for (const e of doc.elements) {
    const each = (kind: LineKind, extra: Partial<LineStyle> = {}) => {
      for (const l of e.lines) set(l.span.start, { kind, indent: 0, ...extra });
    };
    switch (e.kind) {
      case "sceneHeading":
        each("scene");
        break;
      case "action":
        each("action");
        break;
      case "dialogue": {
        const first = e.lines[0];
        if (first) set(first.span.start, { kind: "cue", indent: MARGINS.cue });
        for (const p of e.parts) {
          if (p.kind === "empty") continue;
          set(p.line.span.start, p.kind === "parenthetical" ? { kind: "parenthetical", indent: MARGINS.parenthetical, width: PAREN_WIDTH } : { kind: p.kind === "lyric" ? "lyric" : "dialogue", indent: MARGINS.dialogue, width: DIALOGUE_WIDTH });
        }
        break;
      }
      case "lyric":
        each("lyric", { indent: MARGINS.dialogue, width: DIALOGUE_WIDTH });
        break;
      case "transition":
        each("transition", { align: "right" });
        break;
      case "centered":
        each("centered", { align: "center" });
        break;
      case "rightAligned":
        each("transition", { align: "right" });
        break;
      case "section":
        each("section", { level: e.level });
        break;
      case "synopsis":
        each("synopsis");
        break;
      case "pageBreak":
        each("pageBreak");
        break;
      case "directiveLine":
        each("directive");
        break;
      case "heading":
        each("heading", { level: e.level });
        break;
      case "blockQuote":
        each("quote", { indent: MARGINS.quote }); // Highland's editor (EJ's screenshot): "> " three characters in
        break;
      case "list":
        each("list", { indent: 4 });
        break;
      case "paragraph":
        each("paragraph");
        break;
      case "sceneBreak":
        each("centered", { align: "center" });
        break;
      default:
        break;
    }
  }
  // Manuscript paragraphs are not indented here: Highland indents them only on the page.
  return out;
}

/** A run of text styled where it stands: emphasis, a note, or omitted (boneyard) text. */
export interface InlineMark {
  from: number;
  to: number;
  kind: "bold" | "italic" | "boldItalic" | "underline" | "strike" | "highlight" | "note" | "omitted";
}

/**
 * The emphasis, notes and omitted text in the document, by source offsets, so the editor can show
 * **bold** in bold and a [[note]] dimmed, as Highland does. Pure, for tests.
 */
export function inlineMarks(doc: Document): InlineMark[] {
  const out: InlineMark[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as { kind?: string; style?: InlineMark["kind"]; span?: { start: number; end: number } };
    if (node.kind === "styled" && node.style && node.span && node.span.end > node.span.start) out.push({ from: node.span.start, to: node.span.end, kind: node.style });
    else if (node.kind === "note" && node.span && node.span.end > node.span.start) out.push({ from: node.span.start, to: node.span.end, kind: "note" });
    for (const [key, v] of Object.entries(value)) if (key !== "span" && typeof v === "object") visit(v);
  };
  visit(doc.elements);
  for (const b of doc.overlays.boneyard) if (b.span.end > b.span.start) out.push({ from: b.span.start, to: b.span.end, kind: "omitted" });
  return out;
}

/**
 * Highland 2's paragraph numbers: every line with text gets the next number (a wrapped line counts
 * once; a cue, a parenthetical and each line of dialogue count separately), except the title page,
 * a note or omitted (boneyard) text on a line of its own, and directive lines such as {{HEADER}}
 * and markers. Keyed by the offset where the line starts. Pure, for tests.
 */
export function paragraphNumbers(doc: Document, options: { notes?: boolean } = {}): Map<number, number> {
  const out = new Map<number, number>();
  const src = doc.source;
  const skip = new Set<number>();
  // Directive lines, and link definitions ([ref]: url), which Highland doesn't number (NovelProbe-Default).
  doc.elements.forEach((e, i) => {
    // Lines of lyrics typed one after another are one paragraph to Highland (ScreenplayProbe-Default).
    const before = doc.elements[i - 1];
    if (e.kind === "lyric" && before?.kind === "lyric" && !/\n[ \t]*\r?\n/.test(src.slice(before.span.end, e.span.start)))
      for (const l of e.lines) skip.add(l.span.start);
    if (e.kind === "directiveLine" || e.kind === "linkDefinition") for (const l of e.lines) skip.add(l.span.start);
    // Each paragraph of a quote is numbered once, however many lines it's typed on (an empty ">"
    // line separates them, and isn't numbered): WikiProbe-Default.
    if (doc.mode === "markdown" && e.kind === "blockQuote")
      e.lines.forEach((l, k) => {
        const quoted = (line: typeof l) => src.slice(line.content.start, line.content.end).replace(/^\s*>/, "").trim();
        const prev = e.lines[k - 1];
        if (quoted(l) === "" || (prev && quoted(prev) !== "")) skip.add(l.span.start);
      });
  });
  const inBoneyard = (from: number, to: number) => doc.overlays.boneyard.some((b) => b.span.start <= from && b.span.end >= to);
  let n = 0;
  for (let at = 0; at <= src.length; ) {
    const nl = src.indexOf("\n", at);
    const end = nl < 0 ? src.length : nl;
    const text = src.slice(at, end).replace(/\r$/, "");
    const trimmed = text.trim();
    const first = at + text.length - text.trimStart().length;
    const last = at + text.trimEnd().length;
    const titlePage = doc.titlePage !== null && at >= doc.titlePage.span.start && at < doc.titlePage.span.end;
    const noteOnly = /^\[\[[\s\S]*\]\]$/.test(trimmed) && !trimmed.slice(2, -2).includes("]]");
    // A printed note on a line of its own is numbered in the prose templates (SpeechProbe-Default).
    if (trimmed && !titlePage && !skip.has(at) && (!noteOnly || options.notes) && !inBoneyard(first, last)) out.set(at, ++n);
    if (nl < 0) break;
    at = nl + 1;
  }
  return out;
}
