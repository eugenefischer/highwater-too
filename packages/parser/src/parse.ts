import type { BlankNode, BoneyardNode, Document, Element, Line, Mode, TextNode, TopNode } from "./ast.ts";
import { collectDirectives } from "./directives.ts";
import { isBlank, lineText, splitLines } from "./lines.ts";
import { classifyFountain } from "./fountain.ts";
import { classifyMarkdown, classifyPlain } from "./markdown.ts";
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
 * Parses a document: overlays, title page and line structure, then elements (Fountain, Markdown
 * or plain text), inline content and directives.
 */
export function parse(source: string, options: ParseOptions): Document {
  const { overlays, diagnostics } = findOverlays(source);
  const lines = splitLines(source);
  const nodes: TopNode[] = [];

  // Per line: lies entirely inside a boneyard (from its first to its last character, or it is an
  // empty line strictly within one), and is blank. One sweep over the sorted boneyards.
  const inBone: boolean[] = new Array(lines.length);
  const blank: boolean[] = new Array(lines.length);
  let b = 0;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    while (b < overlays.boneyard.length && overlays.boneyard[b]!.span.end <= line.span.start) b++;
    const by = overlays.boneyard[b];
    inBone[k] =
      by !== undefined &&
      ((line.content.end > line.content.start && by.span.start <= line.content.start && line.content.end <= by.span.end) ||
        (by.span.start < line.span.start && line.span.end <= by.span.end));
    blank[k] = isBlank(lineText(source, line));
  }
  const insideBoneyard = (k: number): boolean => inBone[k]!;
  const isBlankLine = (k: number): boolean => blank[k]! && !inBone[k]!;

  let i = 0;
  // Leading blank lines, then an optional title page.
  const leading = takeWhile(lines, i, isBlankLine);
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
    if (insideBoneyard(i)) {
      const end = takeWhile(lines, i, insideBoneyard);
      nodes.push(group("boneyard", lines, i, end));
      i = end;
    } else if (blank[i]) {
      const end = takeWhile(lines, i, isBlankLine);
      nodes.push(group("blank", lines, i, end));
      i = end;
    } else {
      const end = takeWhile(lines, i, (k) => !blank[k] && !inBone[k]);
      nodes.push(group("text", lines, i, end));
      i = end;
    }
  }
  // Drop a zero-length trailing blank node (source ends without a final empty line).
  const tail = nodes.at(-1);
  if (tail && tail.span.start === tail.span.end && nodes.length > 1) nodes.pop();

  const textNodes = nodes.filter((n): n is TextNode => n.kind === "text");
  const hidden = hiddenRanges(overlays);
  const elements: Element[] =
    options.mode === "fountain"
      ? classifyFountain(source, textNodes, hidden)
      : options.mode === "markdown"
        ? classifyMarkdown(source, textNodes, hidden)
        : classifyPlain(source, textNodes, hidden);

  const directives = collectDirectives(elements);
  for (const d of directives) {
    const warn = (message: string) => diagnostics.push({ severity: "warning", message, span: d.span });
    if (d.directive.kind === "pageNumber" && d.directive.value === null) warn("PAGENUMBER needs a whole number, e.g. {{PAGENUMBER: 10}}");
    if (d.directive.kind === "include" && d.inline) warn("INCLUDE only works on a line of its own");
    if (d.directive.kind === "include" && d.directive.path === "") warn("INCLUDE needs a file path");
  }

  return { mode: options.mode, source, nodes, titlePage, overlays, elements, directives, diagnostics };
}

function takeWhile(lines: Line[], from: number, test: (index: number) => boolean): number {
  let i = from;
  while (i < lines.length && test(i)) i++;
  return i;
}

function group<K extends "blank" | "boneyard" | "text">(kind: K, lines: Line[], from: number, to: number): BlankNode | BoneyardNode | TextNode {
  const slice = lines.slice(from, to);
  return { kind, span: { start: slice[0]!.span.start, end: slice.at(-1)!.span.end }, lines: slice } as BlankNode | BoneyardNode | TextNode;
}
