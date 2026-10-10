import type { BlankNode, BoneyardNode, Document, Element, Line, Mode, TextNode, TopNode } from "./ast.ts";
import { isBlank, lineText, splitLines } from "./lines.ts";
import { classifyFountain } from "./fountain.ts";
import { findOverlays, hiddenRanges } from "./overlays.ts";
import { readTitlePage } from "./title-page.ts";

export interface ParseOptions {
  mode: Mode;
}

/** Fountain for .fountain, Markdown for .md / .markdown, plain text otherwise (the template never decides). */
export function modeFromFileName(name: string): Mode {
  const lower = name.toLowerCase();
  if (lower.endsWith(".fountain") || lower.endsWith(".spmd")) return "fountain";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  return "plain";
}

/**
 * Parses a document. Step 1 of M2: overlays, title page, and the line structure
 * (blank runs, whole-line boneyards, runs of text lines). Later steps classify text nodes.
 */
export function parse(source: string, options: ParseOptions): Document {
  const { overlays, diagnostics } = findOverlays(source);
  const lines = splitLines(source);
  const nodes: TopNode[] = [];

  // Lines lying entirely inside a boneyard (from their first to their last character).
  const insideBoneyard = (line: Line): boolean =>
    overlays.boneyard.some((b) => b.span.start <= line.content.start && line.content.end <= b.span.end && line.content.end > line.content.start) ||
    overlays.boneyard.some((b) => b.span.start < line.span.start && line.span.end <= b.span.end);

  let i = 0;
  // Leading blank lines, then an optional title page.
  const leading = takeWhile(lines, i, (l) => isBlank(lineText(source, l)) && !insideBoneyard(l));
  if (leading > i) {
    nodes.push(group("blank", lines, i, leading));
    i = leading;
  }
  let titlePage = null;
  const title = readTitlePage(source, lines, i);
  if (title) {
    titlePage = title.node;
    nodes.push(title.node);
    i = title.next;
  }

  while (i < lines.length) {
    const line = lines[i]!;
    // A final empty line after a trailing newline is part of nothing visible; keep coverage by grouping it as blank.
    if (insideBoneyard(line)) {
      const end = takeWhile(lines, i, insideBoneyard);
      nodes.push(group("boneyard", lines, i, end));
      i = end;
    } else if (isBlank(lineText(source, line))) {
      const end = takeWhile(lines, i, (l) => isBlank(lineText(source, l)) && !insideBoneyard(l));
      nodes.push(group("blank", lines, i, end));
      i = end;
    } else {
      const end = takeWhile(lines, i, (l) => !isBlank(lineText(source, l)) && !insideBoneyard(l));
      nodes.push(group("text", lines, i, end));
      i = end;
    }
  }
  // Drop a zero-length trailing blank node (source ends without a final empty line).
  const tail = nodes.at(-1);
  if (tail && tail.span.start === tail.span.end && nodes.length > 1) nodes.pop();

  const textNodes = nodes.filter((n): n is TextNode => n.kind === "text");
  const elements: Element[] = options.mode === "fountain" ? classifyFountain(source, textNodes, hiddenRanges(overlays)) : [];

  return { mode: options.mode, source, nodes, titlePage, overlays, elements, diagnostics };
}

function takeWhile(lines: Line[], from: number, test: (line: Line) => boolean): number {
  let i = from;
  while (i < lines.length && test(lines[i]!)) i++;
  return i;
}

function group<K extends "blank" | "boneyard" | "text">(kind: K, lines: Line[], from: number, to: number): BlankNode | BoneyardNode | TextNode {
  const slice = lines.slice(from, to);
  return { kind, span: { start: slice[0]!.span.start, end: slice.at(-1)!.span.end }, lines: slice } as BlankNode | BoneyardNode | TextNode;
}
