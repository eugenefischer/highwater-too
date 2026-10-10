import type { Document, Element, Inline, Span } from "@highwater/parser";

/**
 * Semantic token types, in legend order. package.json maps each to TextMate scopes
 * (`semanticTokenScopes`), so every colour theme styles them.
 */
export const TOKEN_TYPES = [
  "sceneHeading",
  "sceneNumber",
  "character",
  "parenthetical",
  "transition",
  "centered",
  "lyric",
  "section",
  "synopsis",
  "pageBreak",
  "heading",
  "quote",
  "listMarker",
  "term",
  "tableHeader",
  "linkDefinition",
  "titleKey",
  "titleValue",
  "bold",
  "italic",
  "boldItalic",
  "underline",
  "strike",
  "highlight",
  "link",
  "note",
  "directive",
  "markup",
  "revisionTag",
  "boneyard",
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

export interface TokenRange {
  start: number;
  end: number;
  type: TokenType;
}

const INDEX = new Map<TokenType, number>(TOKEN_TYPES.map((t, i) => [t, i + 1]));

/**
 * Non-overlapping highlight ranges for a parsed document, in source order. Built by painting
 * layers from the broadest (element kinds) to the most specific (inline styles, notes, boneyards),
 * each layer overwriting the one below.
 */
export function highlightRanges(doc: Document): TokenRange[] {
  const { source } = doc;
  const canvas = new Uint8Array(source.length);
  const paint = (span: Span | { start: number; end: number }, type: TokenType): void => {
    if (span.end > span.start) canvas.fill(INDEX.get(type)!, span.start, span.end);
  };
  const lineOf = (span: Span): string => source.slice(span.start, span.end);

  if (doc.titlePage) {
    for (const field of doc.titlePage.fields) {
      paint(field.keySpan, "titleKey");
      for (const v of field.values) paint(v.span, "titleValue");
    }
  }

  for (const e of doc.elements) paintElement(e);

  for (const r of doc.overlays.revisions) {
    paint(r.openTag, "revisionTag");
    if (r.closeTag) paint(r.closeTag, "revisionTag");
  }
  for (const b of doc.overlays.boneyard) paint(b.span, "boneyard");

  return runs(canvas);

  function paintElement(e: Element): void {
    switch (e.kind) {
      case "sceneHeading":
        withMarkers(e.span, e.inline, "sceneHeading");
        if (e.sceneNumber) paint(e.sceneNumber.span, "sceneNumber");
        return;
      case "transition":
        return withMarkers(e.span, e.inline, "transition");
      case "centered":
      case "rightAligned":
        return withMarkers(e.span, e.inline, "centered");
      case "lyric":
        return withMarkers(e.span, e.inline, "lyric");
      case "section":
        return withMarkers(e.span, e.inline, "section");
      case "synopsis":
        return withMarkers(e.span, e.inline, "synopsis");
      case "heading":
        return withMarkers(e.span, e.inline, "heading");
      case "action":
      case "paragraph":
        return withMarkers(e.span, e.inline, null);
      case "pageBreak":
      case "sceneBreak":
        return paint(e.span, "pageBreak");
      case "directiveLine":
        return paint(e.span, "directive");
      case "linkDefinition":
        return paint(e.span, "linkDefinition");
      case "dialogue": {
        const cue = e.lines[0]!.content;
        paint(cue, "character");
        const text = lineOf(cue);
        const lead = text.length - text.trimStart().length;
        if (text.trimStart().startsWith("@")) paint({ start: cue.start + lead, end: cue.start + lead + 1 }, "markup");
        const trail = /\^\s*$/.exec(text);
        if (trail) paint({ start: cue.start + trail.index, end: cue.start + trail.index + 1 }, "markup");
        for (const p of e.parts) {
          if (p.kind === "empty") continue;
          if (p.kind === "parenthetical") paint(p.line.content, "parenthetical");
          withMarkers(p.line.content, p.inline, p.kind === "lyric" ? "lyric" : null);
        }
        return;
      }
      case "blockQuote":
        paint(e.span, "quote");
        for (const line of e.lines) {
          const m = /^\s*>\s?/.exec(lineOf(line.content));
          if (m) paint({ start: line.content.start, end: line.content.start + m[0].length }, "markup");
        }
        for (const p of e.paragraphs) paintInline(p.inline);
        return;
      case "list":
        for (const item of e.items) {
          const m = /^\s*([*-]|\d+[.)])/.exec(lineOf(item.line.content));
          if (m) paint({ start: item.line.content.start + m[0].length - m[1]!.length, end: item.line.content.start + m[0].length }, "listMarker");
          paintInline(item.inline);
        }
        return;
      case "termList":
        for (const item of e.items) {
          const t = lineOf(item.line.content);
          const at = t.indexOf("::");
          if (at >= 0) paint({ start: item.line.content.start + at, end: item.line.content.start + at + 2 }, "markup");
          const first = item.termInline[0];
          const last = item.termInline.at(-1);
          if (first && last) paint({ start: first.span.start, end: last.span.end }, "term");
          paintInline(item.termInline);
          paintInline(item.definitionInline);
        }
        return;
      case "table": {
        for (const [k, line] of e.lines.entries()) {
          const t = lineOf(line.content);
          if (k === 0) paint(line.content, "tableHeader");
          if (k === 1) {
            paint(line.content, "markup");
            continue;
          }
          for (let i = t.indexOf("|"); i >= 0; i = t.indexOf("|", i + 1)) paint({ start: line.content.start + i, end: line.content.start + i + 1 }, "markup");
        }
        for (const c of e.header) paintInline(c.inline);
        for (const row of e.rows) for (const c of row) paintInline(c.inline);
        return;
      }
    }
  }

  /**
   * Paints an element's text: `type` over the whole span (if any), its inline content, and the
   * characters outside the inline content (forcing marks like "!", ">", "#", "~") as markup.
   */
  function withMarkers(span: Span, inline: Inline[], type: TokenType | null): void {
    if (type) paint(span, type);
    const first = inline[0];
    const last = inline.at(-1);
    if (first && last) {
      const lead = { start: span.start, end: first.span.start };
      const trail = { start: last.span.end, end: span.end };
      for (const r of [lead, trail]) if (source.slice(r.start, r.end).trim() !== "") paintTrimmed(r, "markup");
    }
    paintInline(inline);
  }

  function paintTrimmed(r: { start: number; end: number }, type: TokenType): void {
    const text = source.slice(r.start, r.end);
    const a = r.start + (text.length - text.trimStart().length);
    const b = r.start + text.trimEnd().length;
    paint({ start: a, end: b }, type);
  }

  function paintInline(nodes: Inline[]): void {
    for (const n of nodes) {
      switch (n.kind) {
        case "styled":
          paint(n.span, n.style);
          markDelimiters(n.span, n.children);
          paintInline(n.children);
          break;
        case "link":
          paint(n.span, "link");
          markDelimiters(n.span, n.children);
          paintInline(n.children);
          break;
        case "image":
          paint(n.span, "link");
          break;
        case "note":
          paint(n.span, "note");
          break;
        case "directive":
          paint(n.span, "directive");
          break;
        default:
          break;
      }
    }
  }

  /** The parts of a styled span outside its children: "**", "[", "](url)" and so on. */
  function markDelimiters(span: Span, children: Inline[]): void {
    const first = children[0];
    const last = children.at(-1);
    if (!first || !last) return paint(span, "markup");
    paint({ start: span.start, end: first.span.start }, "markup");
    paint({ start: last.span.end, end: span.end }, "markup");
  }
}

function runs(canvas: Uint8Array): TokenRange[] {
  const out: TokenRange[] = [];
  let i = 0;
  while (i < canvas.length) {
    const t = canvas[i]!;
    let j = i + 1;
    while (j < canvas.length && canvas[j] === t) j++;
    if (t !== 0) out.push({ start: i, end: j, type: TOKEN_TYPES[t - 1]! });
    i = j;
  }
  return out;
}
