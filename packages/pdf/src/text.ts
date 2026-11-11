import { formatTimestamp, hiddenRanges, inlineText, type Directive, type Document, type Inline, type RevisionRange, type Span } from "@highwater/parser";
import type { PrintMarks, Run, TextStyle } from "./types.ts";

/** Inline notes as Highland prints them (ScreenplayPrintProbe-notes). */
export const NOTE_COLOR = "#0287D0";
/** Synopses (ScreenplayPrintProbe-synopses): 50 % grey. */
export const SYNOPSIS_COLOR = "#808080";

/** What the print options need while the script's own text (not an included file's) is turned into runs. */
export interface PrintContext {
  marks: PrintMarks;
  source: string;
  revisions: RevisionRange[];
  hidden: Span[];
  /** The element being printed is from the script itself (included files keep no marks). */
  own: boolean;
}

export function printContext(doc: Document, marks: PrintMarks | undefined): PrintContext | undefined {
  if (!marks) return undefined;
  return { marks, source: doc.source, revisions: doc.overlays.revisions, hidden: hiddenRanges(doc.overlays), own: true };
}

/** The revision around a source offset, if any. */
export function revisionAt(p: PrintContext | undefined, offset: number): RevisionRange | undefined {
  if (!p?.own) return undefined;
  return p.revisions.find((r) => r.content.start <= offset && offset < r.content.end);
}

/**
 * The print marks for text at a source offset that is not built from inline content (a cue, a
 * transition): its revision colour and star, and its source for paragraph numbers.
 */
export function marked(p: PrintContext | undefined, offset: number, style: TextStyle = {}): TextStyle {
  if (!p?.own) return style;
  // Past revision tags at the start of a line ("{{/REVISION}}{{REVISION: #ee2d36}}MARA": Highland
  // closes and reopens a revision at each line).
  for (let moved = true; moved; ) {
    moved = false;
    for (const h of p.hidden)
      if (h.start <= offset && offset < h.end) {
        offset = h.end;
        moved = true;
      }
  }
  const r = revisionAt(p, offset);
  return {
    ...style,
    ...(r && p.marks.revisionColor && r.color ? { color: r.color } : {}),
    ...(r && p.marks.revisionStars ? { revised: true } : {}),
    ...(p.marks.numbers ? { src: offset } : {}),
  };
}

export interface InlineContext {
  /** Numbers each {{SERIES}} in print order. */
  series: (d: Extract<Directive, { kind: "series" }>) => number;
  date: Date;
  /** Print links blue and underlined (manuscripts); screenplays print them as plain text. */
  links?: boolean;
  /** Addresses of reference links (`[text][name]`), by lower-case name. */
  linkDefinitions?: Map<string, string>;
  /** Highland's print options: inline notes, revision colours and stars, paragraph numbers. */
  print?: PrintContext;
}

/**
 * Printable runs for inline content: notes and images are dropped (and one of the spaces around
 * a note), links print as their text, {{SERIES}} and {{TIMESTAMP}} are filled in, other
 * inline directives print nothing.
 */
export function toRuns(nodes: Inline[], ctx: InlineContext, style: TextStyle = {}): Run[] {
  const out: Run[] = [];
  const p = ctx.print?.own ? ctx.print : undefined;
  /** After a line break, with paragraph numbers: the next source line starts a run of its own. */
  let fresh = false;
  const push = (text: string, s: TextStyle) => {
    if (text === "") return;
    const last = out.at(-1);
    if (last && !fresh && sameStyle(last.style, s)) last.text += text;
    else out.push({ text, style: s });
    fresh = false;
  };
  /** Text from the source: split where revisions start and end, each piece marked. */
  const pushText = (text: string, span: Span, s: TextStyle) => {
    if (!p || !(p.marks.revisionColor || p.marks.revisionStars || p.marks.numbers)) return push(text, s);
    const at = sourceOffsets(p, text, span.start);
    let i = 0;
    while (i < text.length) {
      const r = revisionAt(p, at[i]!);
      let j = i + 1;
      while (j < text.length && revisionAt(p, at[j]!) === r) j++;
      push(text.slice(i, j), marked(p, at[i]!, s));
      i = j;
    }
  };
  /** After a marker with a space before it: the space after it goes too, as if it were never there. */
  let dropSpace = false;
  const walk = (ns: Inline[], s: TextStyle): void => {
    for (const n of ns) {
      if (n.kind !== "text" && n.kind !== "directive") dropSpace = false;
      switch (n.kind) {
        case "text": {
          const drop = dropSpace && /^[ \t]/.test(n.text);
          pushText(drop ? n.text.slice(1) : n.text, drop ? { start: n.span.start + 1, end: n.span.end } : n.span, s);
          dropSpace = false;
          break;
        }
        case "lineBreak":
          push("\n", s);
          if (p?.marks.numbers) fresh = true;
          break;
        case "note":
          // Printed as written, brackets and all, in blue (ScreenplayPrintProbe-notes).
          if (p?.marks.notes) push(p.source.slice(n.span.start, n.span.end), marked(p, n.span.start, { ...s, color: NOTE_COLOR }));
          else if (ctx.print?.marks.notes) push(`[[${n.text}]]`, { ...s, color: NOTE_COLOR });
          // Not printed: with a space before it, the space after it goes too ("logbook. [[…]] The
          // pages" prints "logbook. The pages": ScreenplayPrintProbe-nothing).
          else dropSpace = out.length === 0 || /[ \t]$/.test(out.at(-1)!.text);
          break;
        case "styled":
          walk(n.children, { ...s, ...STYLE[n.style] });
          break;
        case "link":
          if (ctx.links) {
            const href = n.url ?? (n.reference !== null ? ctx.linkDefinitions?.get(n.reference.toLowerCase()) : undefined);
            walk(n.children, { ...s, link: true, ...(href ? { href } : {}) });
          } else walk(n.children, s);
          break;
        case "directive":
          dropSpace = false;
          if (n.directive.kind === "series") push(String(ctx.series(n.directive)), s);
          else if (n.directive.kind === "timestamp") push(formatTimestamp(ctx.date), s);
          // Markers print nothing (Highland breaks the line at one: a bug, not copied).
          else if (n.directive.kind === "marker") dropSpace = out.length === 0 || /[ \t]$/.test(out.at(-1)!.text);
          break;
        default:
          break;
      }
    }
  };
  walk(nodes, style);
  return out;
}

const STYLE: Record<string, TextStyle> = {
  italic: { italic: true },
  bold: { bold: true },
  boldItalic: { bold: true, italic: true },
  underline: { underline: true },
  strike: { strike: true },
  highlight: { highlight: true },
};

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.strike === !!b.strike && !!a.highlight === !!b.highlight && !!a.link === !!b.link && a.href === b.href && a.color === b.color && !!a.revised === !!b.revised;
}

/** The source offset of each character of a text node's text (revision tags and escapes skipped). */
function sourceOffsets(p: PrintContext, text: string, start: number): number[] {
  const out: number[] = [];
  let at = start;
  let h = 0;
  for (const c of text) {
    for (;;) {
      while (h < p.hidden.length && p.hidden[h]!.end <= at) h++;
      const hid = p.hidden[h];
      if (hid && hid.start <= at) at = hid.end;
      else break;
    }
    if (p.source[at] === "\\" && p.source[at + 1] === c) at++;
    for (let k = 0; k < c.length; k++) out.push(at + k);
    at += c.length;
  }
  return out;
}

export function plain(runs: Run[]): string {
  return runs.map((r) => r.text).join("");
}

export function mapRuns(runs: Run[], f: (text: string) => string): Run[] {
  return runs.map((r) => ({ text: f(r.text), style: r.style }));
}

/**
 * Wraps runs into lines of at most `width` characters, as Highland does: breaks at spaces and
 * after hyphens, a hard line break ("\n") always breaks, a word longer than the line is split.
 * Spaces at a break are dropped.
 */
export function wrapRuns(runs: Run[], width: number, restWidth = width): Run[][] {
  // Flatten to characters with their run index, then work on the plain text.
  const text = plain(runs);
  const owner: number[] = [];
  runs.forEach((r, i) => {
    for (let k = 0; k < r.text.length; k++) owner.push(i);
  });
  const firstWidth = width;
  const lines: [number, number][] = [];
  let pos = 0;
  for (const para of text.split("\n")) {
    const start = pos;
    const end = pos + para.length;
    pos = end + 1;
    let lineStart = start;
    // Skip leading spaces only on continuation lines; the first line keeps its indentation.
    while (lineStart < end) {
      const width = lines.length === 0 ? firstWidth : restWidth;
      if (end - lineStart <= width) {
        lines.push([lineStart, end]);
        lineStart = end;
        break;
      }
      // Last break opportunity within width: a space at or before lineStart+width, or just after a hyphen.
      let brk = -1;
      for (let i = lineStart + width; i > lineStart; i--) {
        if (text[i] === " ") {
          brk = i;
          break;
        }
        if ((text[i - 1] === "-" || text[i - 1] === "—") && i - 1 > lineStart && text[i] !== "-") {
          brk = i;
          break;
        }
        // Apple also breaks after "!" or "?" run into the next word ("availability!Come", Astounding).
        if ((text[i - 1] === "!" || text[i - 1] === "?") && i - 1 > lineStart && /[\p{L}\p{N}]/u.test(text[i]!)) {
          brk = i;
          break;
        }
      }
      let lineEnd = brk > lineStart ? brk : lineStart + width;
      while (lineEnd > lineStart && text[lineEnd - 1] === " ") lineEnd--;
      lines.push([lineStart, lineEnd]);
      lineStart = brk > lineStart ? brk : lineStart + width;
      while (lineStart < end && text[lineStart] === " ") lineStart++;
    }
    if (start === end) lines.push([start, end]);
  }
  return lines.map(([a, b]) => slice(runs, owner, text, a, b));
}

function slice(runs: Run[], owner: number[], text: string, a: number, b: number): Run[] {
  const out: Run[] = [];
  let i = a;
  while (i < b) {
    const o = owner[i]!;
    let j = i;
    while (j < b && owner[j] === o) j++;
    out.push({ text: text.slice(i, j), style: runs[o]!.style });
    i = j;
  }
  // Trailing spaces never print.
  const last = out.at(-1);
  if (last) last.text = last.text.replace(/\s+$/, "");
  return out.filter((r) => r.text !== "");
}

/** Inline content that prints nothing but notes (a note on a line of its own). */
export function onlyNotes(nodes: Inline[]): boolean {
  return (
    nodes.some((n) => n.kind === "note") &&
    nodes.every((n) => n.kind === "note" || n.kind === "lineBreak" || (n.kind === "text" && n.text.trim() === "") || (n.kind === "directive" && n.directive.kind !== "series" && n.directive.kind !== "timestamp"))
  );
}

export function plainText(nodes: Inline[]): string {
  return inlineText(nodes.filter((n) => n.kind !== "note"));
}

/** The runs between character offsets `a` and `b` of their plain text. */
export function sliceRuns(runs: Run[], a: number, b = Infinity): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const s = Math.max(a, pos);
    const e = Math.min(b, pos + r.text.length);
    if (e > s) out.push({ text: r.text.slice(s - pos, e - pos), style: r.style });
    pos += r.text.length;
  }
  return out;
}

/** Drops leading whitespace. */
export function trimStartRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && out[0]!.text.trimStart() === "") out.shift();
  if (out[0]) out[0].text = out[0].text.trimStart();
  return out;
}

/**
 * Offsets where a page may split a paragraph: after a sentence ends (".", "?" or "!", with any
 * closing quotes or brackets) and at hard line breaks. Highland only splits there.
 */
export function sentenceEnds(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/[.?!]+[’”'")\]]*(?=\s)|\n/g)) {
    const end = m[0] === "\n" ? m.index : m.index + m[0].length;
    if (end > 0 && end < text.trimEnd().length) out.push(end);
  }
  return out;
}
