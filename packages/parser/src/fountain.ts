import { directivesInLine } from "./directives.ts";
import { offsetAt } from "./overlays.ts";
import type { Dialogue, DialoguePart, Element, Span, TextNode } from "./ast.ts";
import { inlineText, parseInline, parseInlineLines } from "./inline.ts";
import { lineInfos, spanOf, trimmed, type L } from "./lineinfo.ts";
import { sliceLogical, stripEnd, stripStart, trimLogical } from "./logical.ts";

export const PAGE_BREAK = /^={3,}\s*$/;
const SECTION = /^(#+)\s*(.*)$/;
export const SYNOPSIS = /^=(?!=)\s*(.*)$/;
export const DIRECTIVES_ONLY = /^(?:\s*\{\{[^{}]*\}\})+\s*$/;
export const CENTERED = /^>\s*(.*?)\s*<$/;
const FORCED_TRANSITION = /^>\s*(.+?)\s*$/;
const FORCED_SCENE = /^\.(?![.])\s*(.+)$/;
const SCENE = /^(?:INT\.?\/EXT|INT\/EXT|I\/E|INT|EXT|EST)[.\s]/i;
const TRANSITION = /^[^\p{Ll}]*TO:$/u;
const SCENE_NUMBER = /\s*#([\w.-]+)#\s*$/;
export const RIGHT_ALIGNED = /^(.*\S)\s*>$/;
const PARENTHETICAL = /^\(.*\)$/;
/** A cue: uppercase letters (extensions in parentheses may be mixed case), optional trailing ^. */
const CUE = /^((?:[^\p{Ll}()^]*\p{Lu}[^\p{Ll}()^]*?))\s*((?:\([^)]*\)\s*)*)(\^)?\s*$/u;

/** Pass 3 (Fountain): classifies each text node's lines into screenplay elements. */
export function classifyFountain(source: string, nodes: TextNode[], hidden: Span[]): Element[] {
  const out: Element[] = [];
  for (const node of nodes) classifyNode(lineInfos(source, node.lines, hidden), out);
  pairDualDialogue(out);
  return out;
}

function classifyNode(lines: L[], out: Element[]): void {
  let i = 0;
  let atStart = true; // at the node's start, or right after a single-line element
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.text === "") {
      i++; // only tags or an inline boneyard on this line: nothing printable
      continue;
    }
    const single = classifySingle(l, atStart, lines[i + 1]);
    if (single) {
      out.push(single);
      i++;
      atStart = true;
      continue;
    }
    if (l.text.startsWith("~")) {
      while (i < lines.length && lines[i]!.text.startsWith("~")) {
        const ly = lines[i++]!;
        const inline = parseInline(stripStart(ly.lt, /~\s*/));
        out.push({ kind: "lyric", text: inlineText(inline), inline, span: ly.line.content, lines: [ly.line] });
      }
      atStart = true;
      continue;
    }
    if (atStart && i + 1 < lines.length) {
      const dialogue = readDialogue(lines, i);
      if (dialogue) {
        out.push(dialogue.element);
        i = dialogue.next;
        atStart = true;
        continue;
      }
    }
    // Action: this line and following lines until one starts a single-line element.
    const start = i;
    const forced = l.text.startsWith("!") && !l.text.startsWith("![");
    i++;
    while (i < lines.length && !breaksAction(lines[i]!)) i++;
    const block = lines.slice(start, i);
    // Leading indentation is kept (Fountain preserves it in action); trailing whitespace is not.
    const parts = block.map((b, k) => {
      const end = b.raw.trimEnd().length;
      const from = k === 0 && forced ? b.raw.indexOf("!") + 1 : 0;
      return sliceLogical(b.lt, from, Math.max(from, end));
    });
    const inline = parseInlineLines(parts);
    out.push({ kind: "action", text: inlineText(inline), inline, forced, span: spanOf(block), lines: block.map((b) => b.line) });
    atStart = false;
  }
}

function breaksAction(l: L): boolean {
  return PAGE_BREAK.test(l.text) || SECTION.test(l.text) || SYNOPSIS.test(l.text) || DIRECTIVES_ONLY.test(l.text) || CENTERED.test(l.text);
}

function classifySingle(l: L, atStart: boolean, next: L | undefined): Element | null {
  const t = l.text;
  const base = { span: l.line.content, lines: [l.line] };
  if (t.startsWith("!")) return null;
  if (PAGE_BREAK.test(t)) return { kind: "pageBreak", ...base };
  if (DIRECTIVES_ONLY.test(t)) return { kind: "directiveLine", text: t, directives: directivesInLine(l.lt), ...base };
  let m = SECTION.exec(t);
  if (m) {
    const inline = parseInline(stripStart(l.lt, /#+\s*/));
    return { kind: "section", level: m[1]!.length, text: inlineText(inline).trim(), inline, ...base };
  }
  if (SYNOPSIS.test(t)) {
    const inline = parseInline(stripStart(l.lt, /=\s*/));
    return { kind: "synopsis", text: inlineText(inline).trim(), inline, ...base };
  }
  if (CENTERED.test(t)) {
    const inline = parseInline(stripEnd(stripStart(l.lt, />\s*/), /\s*</));
    return { kind: "centered", text: inlineText(inline), inline, ...base };
  }
  if (FORCED_TRANSITION.test(t)) {
    const inline = parseInline(stripStart(l.lt, />\s*/));
    return { kind: "transition", text: inlineText(inline).toUpperCase(), inline, forced: true, ...base };
  }
  m = FORCED_SCENE.exec(t);
  if (m) return sceneHeading(l, true);
  if (atStart && SCENE.test(t)) return sceneHeading(l, false);
  if (atStart && TRANSITION.test(t) && (!next || next.text === "" || SCENE.test(next.text) || FORCED_SCENE.test(next.text))) {
    const inline = parseInline(trimmed(l));
    return { kind: "transition", text: t, inline, forced: false, ...base };
  }
  if (t.endsWith(">") && RIGHT_ALIGNED.test(t) && !t.startsWith(">")) {
    const inline = parseInline(stripEnd(l.lt, /\s*>/));
    return { kind: "rightAligned", text: inlineText(inline), inline, ...base };
  }
  return null;
}

function sceneHeading(l: L, forced: boolean): Element {
  let lt = forced ? stripStart(l.lt, /\.\s*/) : trimmed(l);
  const m = SCENE_NUMBER.exec(lt.text);
  let sceneNumber: { text: string; span: Span } | null = null;
  if (m) {
    const hashAt = lt.text.lastIndexOf(`#${m[1]}#`);
    sceneNumber = { text: m[1]!, span: { start: offsetAt(lt, hashAt), end: offsetAt(lt, hashAt + m[1]!.length + 1) + 1 } };
    lt = trimLogical(sliceLogical(lt, 0, m.index));
  }
  const inline = parseInline(lt);
  return { kind: "sceneHeading", text: inlineText(inline), inline, forced, sceneNumber, span: l.line.content, lines: [l.line] };
}

function readDialogue(lines: L[], i: number): { element: Dialogue; next: number } | null {
  const cueLine = lines[i]!;
  let t = cueLine.text;
  const forced = t.startsWith("@");
  if (forced) t = t.slice(1);
  else if (SCENE.test(t) || TRANSITION.test(t) || /^[\d\s.,:;!?'"-]+$/.test(t)) return null;
  const m = CUE.exec(t) ?? (forced ? /^(.*?)\s*((?:\([^)]*\)\s*)*)(\^)?\s*$/.exec(t) : null);
  if (!m) return null;
  const [, character = "", extensionsText = "", dual] = m;
  const parts: DialoguePart[] = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const l = lines[j]!;
    if (/^ {2,}$/.test(l.raw)) parts.push({ kind: "empty", line: l.line });
    else if (l.text === "") continue;
    else if (PARENTHETICAL.test(l.text)) {
      const inline = parseInline(trimmed(l));
      parts.push({ kind: "parenthetical", text: inlineText(inline), inline, line: l.line });
    } else if (l.text.startsWith("~")) {
      const inline = parseInline(stripStart(l.lt, /~\s*/));
      parts.push({ kind: "lyric", text: inlineText(inline), inline, line: l.line });
    } else {
      const inline = parseInline(trimmed(l));
      parts.push({ kind: "line", text: inlineText(inline), inline, line: l.line });
    }
  }
  if (!parts.some((p) => p.kind !== "parenthetical")) return null;
  const block = lines.slice(i, j);
  return {
    element: {
      kind: "dialogue",
      character: character.trim(),
      extensions: extensionsText.match(/\([^)]*\)/g) ?? [],
      forced,
      dual: dual ? "right" : null,
      parts,
      span: spanOf(block),
      lines: block.map((b) => b.line),
    },
    next: j,
  };
}

/** A cue ending in ^ is the right half of a pair; the dialogue just before it becomes the left half. */
function pairDualDialogue(elements: Element[]): void {
  for (let k = 1; k < elements.length; k++) {
    const right = elements[k]!;
    const left = elements[k - 1]!;
    if (right.kind === "dialogue" && right.dual === "right") {
      if (left.kind === "dialogue" && left.dual === null) left.dual = "left";
      else right.dual = null;
    }
  }
}
