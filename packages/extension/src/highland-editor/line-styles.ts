import type { Document } from "@highwater/parser";
import { liveMargins, MARGINS } from "../syntax/margins.ts";

/**
 * How the Highland-style editor (M15) shows each source line: a kind, for its look, and an indent
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

/** Dialogue wraps after 35 characters and parentheticals after 28, as Highland's editor shows them. */
export const DIALOGUE_WIDTH = 35;
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
        each("heading", { level: e.level, align: "center" });
        break;
      case "blockQuote":
        each("quote", { indent: MARGINS.paragraph });
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
  // Manuscript paragraphs after a paragraph are indented, as Live Margins shows them.
  if (doc.mode === "markdown") for (const m of liveMargins(doc)) {
    const s = out.get(m.at);
    if (s && s.kind === "paragraph") out.set(m.at, { ...s, indent: m.indent });
  }
  return out;
}
