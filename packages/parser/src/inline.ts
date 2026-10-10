import type { Inline, InlineStyle, Span } from "./ast.ts";
import { parseDirective } from "./directives.ts";
import { offsetAt, type LogicalText } from "./overlays.ts";

const DELIMITERS: { open: string; style: InlineStyle }[] = [
  { open: "***", style: "boldItalic" },
  { open: "**", style: "bold" },
  { open: "~~", style: "strike" },
  { open: "*", style: "italic" },
  { open: "_", style: "underline" },
  { open: "+", style: "highlight" },
];

const PUNCT = /[\s\p{P}\p{S}]/u;

/** Characters that can start inline markup; every other character is skipped without trying a match. */
const NEXT_CANDIDATE = /[[{!*_~+\\]/g;
const ESCAPABLE = new Set(["*", "_", "+", "~", "\\", "[", "]", "{", "}", "#", ">", "!"]);

/** Parses the inline content of an element's lines, inserting line breaks between lines. */
export function parseInlineLines(lines: LogicalText[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((lt, k) => {
    if (k > 0) {
      const prev = lines[k - 1]!;
      const at = offsetAt(prev, prev.text.length);
      out.push({ kind: "lineBreak", span: { start: at, end: offsetAt(lt, 0) } });
    }
    out.push(...parseInline(lt));
  });
  return out;
}

export function parseInline(lt: LogicalText): Inline[] {
  return parseRange(lt, 0, lt.text.length);
}

/** Plain text of inline content (notes omitted, links as their text, images as nothing). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
          return n.text;
        case "styled":
        case "link":
          return inlineText(n.children);
        case "lineBreak":
          return "\n";
        case "directive":
          return n.text;
        default:
          return "";
      }
    })
    .join("");
}

function span(lt: LogicalText, a: number, b: number): Span {
  return { start: offsetAt(lt, a), end: b > a ? offsetAt(lt, b - 1) + 1 : offsetAt(lt, a) };
}

function parseRange(lt: LogicalText, from: number, to: number): Inline[] {
  const s = lt.text;
  const out: Inline[] = [];
  let textStart = from;
  const flush = (end: number) => {
    if (end > textStart) {
      const text = unescape(s.slice(textStart, end));
      const last = out.at(-1);
      if (last?.kind === "text") {
        last.text += text;
        last.span.end = span(lt, textStart, end).end;
      } else out.push({ kind: "text", text, span: span(lt, textStart, end) });
    }
  };
  let i = from;
  while (i < to) {
    NEXT_CANDIDATE.lastIndex = i;
    const next = NEXT_CANDIDATE.exec(s);
    if (!next || next.index >= to) break;
    i = next.index;
    const c = s[i]!;
    if (c === "\\" && i + 1 < to && ESCAPABLE.has(s[i + 1]!)) {
      i += 2; // escaped: stays in the text run, the backslash is removed by unescape()
      continue;
    }
    if (c === "\\") {
      i++;
      continue;
    }
    const node = matchAt(lt, i, to);
    if (node) {
      flush(i);
      out.push(node.inline);
      i = node.end;
      textStart = i;
      continue;
    }
    i++;
  }
  flush(to);
  return out;
}

function matchAt(lt: LogicalText, i: number, to: number): { inline: Inline; end: number } | null {
  const s = lt.text;
  // [[note]]
  if (s.startsWith("[[", i)) {
    const close = s.indexOf("]]", i + 2);
    if (close >= 0 && close + 2 <= to) return { inline: { kind: "note", text: s.slice(i + 2, close).trim(), span: span(lt, i, close + 2) }, end: close + 2 };
  }
  // {{directive}}
  if (s.startsWith("{{", i)) {
    const close = s.indexOf("}}", i + 2);
    if (close >= 0 && close + 2 <= to) {
      const text = s.slice(i, close + 2);
      return { inline: { kind: "directive", text, directive: parseDirective(text), span: span(lt, i, close + 2) }, end: close + 2 };
    }
  }
  // ![alt](src)
  if (s.startsWith("![", i)) {
    const m = /^!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(s.slice(i, to));
    if (m) return { inline: { kind: "image", alt: m[1]!, src: m[2]!, span: span(lt, i, i + m[0].length) }, end: i + m[0].length };
  }
  // [text](url), [text][ref], [ref]
  if (s[i] === "[") {
    const rest = s.slice(i, to);
    const m = /^\[([^\]]+)\](?:\(([^)\s]*)(?:\s+"[^"]*")?\)|\[([^\]]*)\])/.exec(rest);
    if (m) {
      const label = i + 1;
      const children = parseRange(lt, label, label + m[1]!.length);
      const reference = m[2] === undefined ? (m[3] || m[1]!) : null;
      return { inline: { kind: "link", children, url: m[2] ?? null, reference, span: span(lt, i, i + m[0].length) }, end: i + m[0].length };
    }
  }
  // Emphasis delimiters
  for (const d of DELIMITERS) {
    if (!s.startsWith(d.open, i)) continue;
    const n = d.open.length;
    const before = i > 0 ? s[i - 1]! : " ";
    const after = s[i + n];
    if (after === undefined || /\s/.test(after) || s.startsWith(d.open, i + n)) continue;
    if ((d.open === "_" || d.open === "+") && !PUNCT.test(before)) continue; // snake_case, 1+1
    const close = findCloser(s, d.open, i + n, to);
    if (close < 0) continue;
    return {
      inline: { kind: "styled", style: d.style, children: parseRange(lt, i + n, close), span: span(lt, i, close + n) },
      end: close + n,
    };
  }
  return null;
}

function findCloser(s: string, delim: string, from: number, to: number): number {
  for (let j = from + 1; j + delim.length <= to; j++) {
    if (s[j - 1] === "\\") continue;
    if (!s.startsWith(delim, j)) continue;
    if (/\s/.test(s[j - 1]!)) continue;
    const after = s[j + delim.length];
    // A longer run of the same character belongs to a different delimiter (e.g. ** inside *…*).
    if (delim.length === 1 && (s[j + 1] === delim || s[j - 1] === delim)) continue;
    if ((delim === "_" || delim === "+") && after !== undefined && !PUNCT.test(after)) continue;
    return j;
  }
  return -1;
}

function unescape(text: string): string {
  if (!text.includes("\\")) return text;
  return text.replace(/\\([*_+~\\[\]{}#>!])/g, "$1");
}
