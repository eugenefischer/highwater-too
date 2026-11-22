import type { Span } from "./ast.ts";

/**
 * A YAML front matter block's top-level entries, read with the little YAML a title page needs:
 * `key: value` (plain, "double" or 'single' quoted), `key: |` or `key: >` blocks, `key: [a, b]`,
 * and lists of `- item` lines under a key. Nested mappings and anything fancier are kept as their
 * lines, unparsed. `#` comments are skipped. Spans are offsets in the source.
 */
export interface YamlEntry {
  key: string;
  keySpan: Span;
  /** The value's lines (a block's or list's lines one by one; a scalar is one). */
  values: { text: string; span: Span }[];
  /** From the key to the end of its last line. */
  span: Span;
}

interface RawLine {
  text: string;
  start: number;
  end: number;
}

export function yamlEntries(source: string, inner: Span): YamlEntry[] {
  const lines: RawLine[] = [];
  for (let at = inner.start; at < inner.end; ) {
    const nl = source.indexOf("\n", at);
    const end = nl < 0 || nl > inner.end ? inner.end : nl;
    const text = source.slice(at, end).replace(/\r$/, "");
    lines.push({ text, start: at, end: at + text.length });
    at = end + 1;
  }
  const entries: YamlEntry[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    const m = /^([^\s:#'"-][^:]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/.exec(line.text);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    const keySpan = { start: line.start, end: line.start + key.length };
    const rest = stripComment(m[2] ?? "");
    const restStart = line.start + line.text.indexOf(rest, key.length + 1);
    // The lines that belong to this key: indented ones, list items and blanks before the next key.
    let j = i + 1;
    while (j < lines.length && (lines[j]!.text.trim() === "" || /^[ \t]/.test(lines[j]!.text) || /^-(?:[ \t]|$)/.test(lines[j]!.text))) j++;
    let last = j;
    while (last > i + 1 && lines[last - 1]!.text.trim() === "") last--;
    const body = lines.slice(i + 1, last);
    const values: YamlEntry["values"] = [];
    if (/^[|>][+-]?$/.test(rest)) {
      // A block: its lines with their common indentation removed; ">" folds lines into paragraphs.
      const indent = Math.min(...body.filter((l) => l.text.trim() !== "").map((l) => /^[ \t]*/.exec(l.text)![0].length));
      const cut = body.map((l) => ({ text: l.text.trim() === "" ? "" : l.text.slice(Number.isFinite(indent) ? indent : 0).replace(/[ \t]+$/, ""), start: l.start + (l.text.trim() === "" ? 0 : Number.isFinite(indent) ? indent : 0) }));
      if (rest.startsWith(">")) {
        let para: { text: string; span: Span } | null = null;
        for (const l of cut) {
          if (l.text === "") {
            if (para) values.push(para);
            para = null;
          } else if (para) {
            para.text += ` ${l.text}`;
            para.span.end = l.start + l.text.length;
          } else para = { text: l.text, span: { start: l.start, end: l.start + l.text.length } };
        }
        if (para) values.push(para);
      } else for (const l of cut) values.push({ text: l.text, span: { start: l.start, end: l.start + l.text.length } });
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      let at = restStart + 1;
      for (const part of splitFlow(rest.slice(1, -1))) {
        const lead = part.length - part.trimStart().length;
        values.push({ text: unquote(part.trim()), span: { start: at + lead, end: at + lead + part.trim().length } });
        at += part.length + 1;
      }
    } else if (rest !== "") {
      values.push({ text: unquote(rest), span: { start: restStart, end: restStart + rest.length } });
    } else {
      for (const l of body) {
        const item = /^([ \t]*)-(?:[ \t]+(.*?))?[ \t]*$/.exec(l.text);
        const text = item ? stripComment(item[2] ?? "") : l.text.trim();
        if (text === "" && !item) continue;
        const start = l.start + (item ? l.text.indexOf(text, item[1]!.length + 1) : l.text.indexOf(text));
        values.push({ text: item ? unquote(text) : text, span: { start, end: start + text.length } });
      }
    }
    const endLine = body.at(-1) ?? line;
    entries.push({ key, keySpan, values, span: { start: line.start, end: endLine.end } });
    i = j;
  }
  return entries;
}

/** Without a trailing ` # comment` (outside quotes). */
function stripComment(text: string): string {
  let quote: string | null = null;
  for (let k = 0; k < text.length; k++) {
    const c = text[k]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (k === 0 || /\s/.test(text[k - 1]!)) quote = c;
    } else if (c === "#" && (k === 0 || /\s/.test(text[k - 1]!))) return text.slice(0, k).replace(/[ \t]+$/, "");
  }
  return text;
}

function splitFlow(text: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let from = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ",") {
      parts.push(text.slice(from, k));
      from = k + 1;
    }
  }
  parts.push(text.slice(from));
  return parts.filter((p) => p.trim() !== "");
}

/** A scalar's text: quotes removed (with their escapes), plain text as it is. */
export function unquote(text: string): string {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"'))
    return text.slice(1, -1).replace(/\\(["\\/nt]|u([0-9a-fA-F]{4}))/g, (_m, c: string, hex?: string) => (hex ? String.fromCharCode(parseInt(hex, 16)) : c === "n" ? "\n" : c === "t" ? "\t" : c));
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

/** A value written as a YAML scalar: plain when that reads back the same, else double-quoted. */
export function yamlScalar(text: string): string {
  const plainOk =
    text !== "" &&
    text === text.trim() &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) &&
    !/: |:$| #/.test(text) &&
    !/^(?:true|false|yes|no|on|off|null|~|[-+]?[0-9][0-9_.,:eE+-]*)$/i.test(text);
  return plainOk ? text : `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
