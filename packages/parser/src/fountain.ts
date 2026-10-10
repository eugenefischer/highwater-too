import type { Dialogue, DialoguePart, Element, Line, Span, TextNode } from "./ast.ts";
import { logicalText } from "./overlays.ts";

const PAGE_BREAK = /^={3,}\s*$/;
const SECTION = /^(#+)\s*(.*)$/;
const SYNOPSIS = /^=(?!=)\s*(.*)$/;
const DIRECTIVES_ONLY = /^(?:\s*\{\{[^{}]*\}\})+\s*$/;
const CENTERED = /^>\s*(.*?)\s*<$/;
const FORCED_TRANSITION = /^>\s*(.+?)\s*$/;
const FORCED_SCENE = /^\.(?![.])\s*(.+)$/;
const SCENE = /^(?:INT\.?\/EXT|INT\/EXT|I\/E|INT|EXT|EST)[.\s]/i;
const TRANSITION = /^[^\p{Ll}]*TO:$/u;
const SCENE_NUMBER = /\s*#([\w.-]+)#\s*$/;
const RIGHT_ALIGNED = /^(.*\S)\s*>$/;
const PARENTHETICAL = /^\(.*\)$/;
/** A cue: uppercase letters (extensions in parentheses may be mixed case), optional trailing ^. */
const CUE = /^((?:[^\p{Ll}()^]*\p{Lu}[^\p{Ll}()^]*?))\s*((?:\([^)]*\)\s*)*)(\^)?\s*$/u;

interface L {
  line: Line;
  /** Logical text with leading/trailing whitespace removed. */
  text: string;
  raw: string;
}

/** Elements that occupy exactly one line; after one, classification starts afresh on the next line. */
type Single = "sceneHeading" | "transition" | "section" | "synopsis" | "pageBreak" | "directiveLine" | "centered" | "rightAligned";

/** Pass 3 (Fountain): classifies each text node's lines into screenplay elements. */
export function classifyFountain(source: string, nodes: TextNode[], hidden: Span[]): Element[] {
  const out: Element[] = [];
  for (const node of nodes) {
    const lines: L[] = node.lines.map((line) => {
      const raw = logicalText(source, line.content, hidden).text;
      return { line, raw, text: raw.trim() };
    });
    classifyNode(lines, out);
  }
  pairDualDialogue(out);
  return out;
}

function classifyNode(lines: L[], out: Element[]): void {
  let i = 0;
  let atStart = true; // at the node's start, or right after a single-line element
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.text === "") {
      // Only tags or an inline boneyard on this line: nothing printable.
      i++;
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
      const start = i;
      while (i < lines.length && lines[i]!.text.startsWith("~")) i++;
      for (const ly of lines.slice(start, i)) out.push({ kind: "lyric", text: ly.text.slice(1).trim(), span: ly.line.content, lines: [ly.line] });
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
    const text = block
      .map((b, k) => (k === 0 && forced ? b.raw.replace(/^\s*!/, "") : b.raw).replace(/\s+$/, ""))
      .join("\n");
    out.push({ kind: "action", text, forced, span: spanOf(block), lines: block.map((b) => b.line) });
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
  if (DIRECTIVES_ONLY.test(t)) return { kind: "directiveLine", text: t, ...base };
  let m = SECTION.exec(t);
  if (m) return { kind: "section", level: m[1]!.length, text: m[2]!.trim(), ...base };
  m = SYNOPSIS.exec(t);
  if (m) return { kind: "synopsis", text: m[1]!.trim(), ...base };
  m = CENTERED.exec(t);
  if (m) return { kind: "centered", text: m[1]!, ...base };
  m = FORCED_TRANSITION.exec(t);
  if (m) return { kind: "transition", text: m[1]!.toUpperCase(), forced: true, ...base };
  m = FORCED_SCENE.exec(t);
  if (m) return sceneHeading(l, m[1]!, true);
  if (atStart && SCENE.test(t)) return sceneHeading(l, t, false);
  if (atStart && TRANSITION.test(t) && (!next || next.text === "" || SCENE.test(next.text) || FORCED_SCENE.test(next.text))) {
    return { kind: "transition", text: t, forced: false, ...base };
  }
  m = RIGHT_ALIGNED.exec(t);
  if (m && !t.startsWith(">")) return { kind: "rightAligned", text: m[1]!, ...base };
  return null;
}

function sceneHeading(l: L, text: string, forced: boolean): Element {
  const m = SCENE_NUMBER.exec(text);
  let sceneNumber: { text: string; span: Span } | null = null;
  if (m) {
    const at = l.line.content.start + l.raw.lastIndexOf(`#${m[1]}#`);
    sceneNumber = { text: m[1]!, span: { start: at, end: at + m[1]!.length + 2 } };
    text = text.slice(0, m.index);
  }
  return { kind: "sceneHeading", text: text.trim(), forced, sceneNumber, span: l.line.content, lines: [l.line] };
}

function readDialogue(lines: L[], i: number): { element: Dialogue; next: number } | null {
  const cueLine = lines[i]!;
  let t = cueLine.text;
  const forced = t.startsWith("@");
  if (forced) t = t.slice(1);
  else if (SCENE.test(t) || TRANSITION.test(t) || /^[\d\s.,:;!?'"-]+$/.test(t)) return null;
  const m = CUE.exec(t);
  let character: string;
  let extensionsText: string;
  let dual: string | undefined;
  if (m) {
    [, character = "", extensionsText = "", dual] = m;
  } else if (forced) {
    const f = /^(.*?)\s*((?:\([^)]*\)\s*)*)(\^)?\s*$/.exec(t)!;
    [, character = "", extensionsText = "", dual] = f;
  } else return null;
  const parts: DialoguePart[] = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const l = lines[j]!;
    if (/^ {2,}$/.test(l.raw)) parts.push({ kind: "empty", line: l.line });
    else if (l.text === "") continue;
    else if (PARENTHETICAL.test(l.text)) parts.push({ kind: "parenthetical", text: l.text, line: l.line });
    else if (l.text.startsWith("~")) parts.push({ kind: "lyric", text: l.text.slice(1).trim(), line: l.line });
    else parts.push({ kind: "line", text: l.text, line: l.line });
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

function spanOf(block: L[]): Span {
  return { start: block[0]!.line.content.start, end: block.at(-1)!.line.content.end };
}
