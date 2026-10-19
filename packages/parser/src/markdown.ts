import { directivesInLine } from "./directives.ts";
import { offsetAt } from "./overlays.ts";
import type { Element, Span, Table, TextNode } from "./ast.ts";
import { CENTERED, DIRECTIVES_ONLY, PAGE_BREAK, RIGHT_ALIGNED, SYNOPSIS } from "./fountain.ts";
import { inlineText, parseInline } from "./inline.ts";
import { lineInfos, spanOf, trimmed, type L } from "./lineinfo.ts";
import { sliceLogical, stripEnd, stripStart, trimLogical } from "./logical.ts";
import type { LogicalText } from "./overlays.ts";

const HEADING = /^(#{1,6})(?:\s+|$)/;
const SCENE_BREAK = /^\*(?:\s*\*){2,}\s*$/;
const QUOTE = /^>/;
const LIST_ITEM = /^(\s*)([*-]|\d+[.)])\s+/;
const TERM = /^(.+?)\s*::\s*(.*)$/;
const LINK_DEFINITION = /^\[([^\]]+)\]:\s*(\S+)/;
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const isTerm = (t: string): boolean => t.includes("::") && TERM.test(t);

/** Pass 3 (Markdown): classifies lines into manuscript elements. Every prose line is its own paragraph. */
export function classifyMarkdown(source: string, nodes: TextNode[], hidden: Span[]): Element[] {
  const out: Element[] = [];
  for (const node of nodes) classifyNode(lineInfos(source, node.lines, hidden), out);
  return out;
}

/** Plain text: every line is a paragraph, with no inline markup. */
export function classifyPlain(source: string, nodes: TextNode[], hidden: Span[]): Element[] {
  const out: Element[] = [];
  for (const node of nodes) {
    for (const l of lineInfos(source, node.lines, hidden)) {
      if (l.text === "") continue;
      const lt = trimmed(l);
      out.push({ kind: "paragraph", text: lt.text, inline: [{ kind: "text", text: lt.text, span: spanOfLogical(lt) }], span: l.line.content, lines: [l.line] });
    }
  }
  return out;
}

function classifyNode(lines: L[], out: Element[]): void {
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    const t = l.text;
    const base = { span: l.line.content, lines: [l.line] };
    if (t === "") {
      i++;
      continue;
    }
    if (PAGE_BREAK.test(t)) {
      out.push({ kind: "pageBreak", ...base });
      i++;
    } else if (DIRECTIVES_ONLY.test(t)) {
      out.push({ kind: "directiveLine", text: t, directives: directivesInLine(l.lt), ...base });
      i++;
    } else if (SYNOPSIS.test(t)) {
      const inline = parseInline(stripStart(l.lt, /=\s*/));
      out.push({ kind: "synopsis", text: inlineText(inline).trim(), inline, ...base });
      i++;
    } else if (HEADING.test(t)) {
      const level = HEADING.exec(t)![1]!.length;
      const inline = parseInline(stripStart(l.lt, /#+\s*/));
      out.push({ kind: "heading", level, text: inlineText(inline).trim(), inline, ...base });
      i++;
    } else if (SCENE_BREAK.test(t)) {
      out.push({ kind: "sceneBreak", ...base });
      i++;
    } else if (LINK_DEFINITION.test(t)) {
      const m = LINK_DEFINITION.exec(t)!;
      out.push({ kind: "linkDefinition", label: m[1]!, url: m[2]!, ...base });
      i++;
    } else if (CENTERED.test(t)) {
      const inline = parseInline(stripEnd(stripStart(l.lt, />\s*/), /\s*</));
      out.push({ kind: "centered", text: inlineText(inline), inline, ...base });
      i++;
    } else if (QUOTE.test(t)) {
      const start = i;
      while (i < lines.length && QUOTE.test(lines[i]!.text)) i++;
      out.push(blockQuote(lines.slice(start, i)));
    } else if (t.includes("|") && lines[i + 1] && TABLE_SEPARATOR.test(lines[i + 1]!.text) && lines[i + 1]!.text.includes("-")) {
      const start = i;
      i += 2;
      while (i < lines.length && lines[i]!.text.includes("|")) i++;
      out.push(table(lines.slice(start, i)));
    } else if (LIST_ITEM.test(l.raw)) {
      const start = i;
      while (i < lines.length && LIST_ITEM.test(lines[i]!.raw)) i++;
      const block = lines.slice(start, i);
      out.push({
        kind: "list",
        items: block.map((b) => {
          const m = LIST_ITEM.exec(b.raw)!;
          const inline = parseInline(trimLogical(sliceLogical(b.lt, m[0].length)));
          return { marker: m[2]!, ordered: /\d/.test(m[2]!), level: Math.floor(m[1]!.replace(/\t/g, "    ").length / 2), text: inlineText(inline), inline, line: b.line };
        }),
        span: spanOf(block),
        lines: block.map((b) => b.line),
      });
    } else if (isTerm(t)) {
      const start = i;
      while (i < lines.length && isTerm(lines[i]!.text)) i++;
      const block = lines.slice(start, i);
      out.push({
        kind: "termList",
        items: block.map((b) => {
          const lt = trimmed(b);
          const sep = lt.text.indexOf("::");
          const termInline = parseInline(trimLogical(sliceLogical(lt, 0, sep)));
          const definitionInline = parseInline(trimLogical(sliceLogical(lt, sep + 2)));
          return { term: inlineText(termInline), definition: inlineText(definitionInline), termInline, definitionInline, line: b.line };
        }),
        span: spanOf(block),
        lines: block.map((b) => b.line),
      });
    } else if (t.endsWith(">") && RIGHT_ALIGNED.test(t)) {
      const inline = parseInline(stripEnd(l.lt, /\s*>/));
      out.push({ kind: "rightAligned", text: inlineText(inline), inline, ...base });
      i++;
    } else {
      const inline = parseInline(trimmed(l));
      out.push({ kind: "paragraph", text: inlineText(inline), inline, ...base });
      i++;
    }
  }
}

function blockQuote(block: L[]): Element {
  const paragraphs: { text: string; inline: ReturnType<typeof parseInline> }[] = [];
  let current: LogicalText[] = [];
  const flush = () => {
    if (current.length === 0) return;
    // Lines inside one quoted paragraph each start a line, as in Highland's print (an
    // attribution line under a quote stays on its own line: NovelProbe).
    for (const lt of current) {
      const inline = parseInline(lt);
      const prev = paragraphs.at(-1);
      if (prev && current.indexOf(lt) > 0) {
        prev.inline.push({ kind: "lineBreak", span: { start: offsetAt(lt, 0), end: offsetAt(lt, 0) } }, ...inline);
        prev.text = inlineText(prev.inline);
      } else paragraphs.push({ text: inlineText(inline), inline });
    }
    current = [];
  };
  for (const b of block) {
    const content = stripStart(b.lt, />\s?/);
    if (content.text.trim() === "") flush();
    else current.push(content);
  }
  flush();
  return { kind: "blockQuote", paragraphs, span: spanOf(block), lines: block.map((b) => b.line) };
}

function table(block: L[]): Table {
  const cells = (b: L) => {
    let lt = trimmed(b);
    lt = stripEnd(stripStart(lt, /\|/), /\|/);
    const out: LogicalText[] = [];
    let from = 0;
    for (let k = 0; k <= lt.text.length; k++) {
      if (k === lt.text.length || (lt.text[k] === "|" && lt.text[k - 1] !== "\\")) {
        out.push(trimLogical(sliceLogical(lt, from, k)));
        from = k + 1;
      }
    }
    return out.map((c) => {
      const inline = parseInline(c);
      return { text: inlineText(inline), inline };
    });
  };
  const sep = trimmed(block[1]!).text.replace(/^\||\|$/g, "").split("|");
  return {
    kind: "table",
    align: sep.map((s) => {
      const v = s.trim();
      if (v.startsWith(":") && v.endsWith(":")) return "center";
      if (v.endsWith(":")) return "right";
      if (v.startsWith(":")) return "left";
      return null;
    }),
    header: cells(block[0]!),
    rows: block.slice(2).map(cells),
    span: spanOf(block),
    lines: block.map((b) => b.line),
  };
}

function spanOfLogical(lt: LogicalText): Span {
  return { start: offsetAt(lt, 0), end: offsetAt(lt, lt.text.length) };
}
