import { formatTimestamp, inlineText, type Directive, type Inline } from "@highwater/parser";
import type { Run, TextStyle } from "./types.ts";

export interface InlineContext {
  /** Numbers each {{SERIES}} in print order. */
  series: (d: Extract<Directive, { kind: "series" }>) => number;
  date: Date;
  /** Print links blue and underlined (manuscripts); screenplays print them as plain text. */
  links?: boolean;
  /** Addresses of reference links (`[text][name]`), by lower-case name. */
  linkDefinitions?: Map<string, string>;
}

/**
 * Printable runs for inline content: notes and images are dropped (Highland keeps the spaces
 * around a note), links print as their text, {{SERIES}} and {{TIMESTAMP}} are filled in, other
 * inline directives print nothing.
 */
export function toRuns(nodes: Inline[], ctx: InlineContext, style: TextStyle = {}): Run[] {
  const out: Run[] = [];
  const push = (text: string, s: TextStyle) => {
    if (text === "") return;
    const last = out.at(-1);
    if (last && sameStyle(last.style, s)) last.text += text;
    else out.push({ text, style: s });
  };
  const walk = (ns: Inline[], s: TextStyle): void => {
    for (const n of ns) {
      switch (n.kind) {
        case "text":
          push(n.text, s);
          break;
        case "lineBreak":
          push("\n", s);
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
          if (n.directive.kind === "series") push(String(ctx.series(n.directive)), s);
          else if (n.directive.kind === "timestamp") push(formatTimestamp(ctx.date), s);
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
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline && !!a.strike === !!b.strike && !!a.highlight === !!b.highlight && !!a.link === !!b.link && a.href === b.href;
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
