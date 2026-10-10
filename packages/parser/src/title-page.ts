import type { Line, TitleField, TitlePageNode } from "./ast.ts";
import { lineText } from "./lines.ts";

/** Keys that may open a title page (case-insensitive). Later fields may use any key. */
export const TITLE_PAGE_KEYS = new Set([
  "title",
  "credit",
  "author",
  "authors",
  "source",
  "draft date",
  "date",
  "contact",
  "contact info",
  "revision",
  "copyright",
  "notes",
  "watermark",
  "font",
  "tl",
  "tc",
  "tr",
  "cc",
  "bl",
  "br",
]);

const KEY_LINE = /^([A-Za-z][A-Za-z0-9 ]{0,30}?)[ \t]*:[ \t]*(.*)$/;
/** Continuation: indented by a tab or 3+ spaces (whitespace-only indented lines included). */
const CONTINUATION = /^(?:\t| {3,})[ \t]*(.*)$/;

export function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Pass 2: reads a title page starting at `lines[first]`, if that line is a known title-page key.
 * Returns the node and the index of the first line after it, or null.
 */
export function readTitlePage(source: string, lines: Line[], first: number): { node: TitlePageNode; next: number } | null {
  const opener = lines[first];
  if (!opener) return null;
  const m = KEY_LINE.exec(lineText(source, opener));
  if (!m || !TITLE_PAGE_KEYS.has(normalizeKey(m[1]!))) return null;

  const fields: TitleField[] = [];
  let i = first;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const text = lineText(source, line);
    const key = KEY_LINE.exec(text);
    if (key && !/^[ \t]/.test(text)) {
      const keyText = key[1]!;
      const valueStart = line.content.start + text.length - key[2]!.length;
      fields.push({
        key: keyText,
        name: normalizeKey(keyText),
        keySpan: { start: line.content.start, end: line.content.start + keyText.length },
        values: [{ text: key[2]!.replace(/[ \t]+$/, ""), span: { start: valueStart, end: valueStart + key[2]!.replace(/[ \t]+$/, "").length } }],
        span: { ...line.span },
      });
      continue;
    }
    const cont = CONTINUATION.exec(text);
    const field = fields.at(-1);
    if (cont && field) {
      const value = cont[1]!.replace(/[ \t]+$/, "");
      const start = line.content.start + text.length - cont[1]!.length;
      field.values.push({ text: value, span: { start, end: start + value.length } });
      field.span.end = line.span.end;
      continue;
    }
    break;
  }
  const last = fields.at(-1)!;
  return {
    node: { kind: "titlePage", span: { start: opener.span.start, end: last.span.end }, fields },
    next: i,
  };
}

/** Field values joined with newlines, e.g. a multi-line Author. Blank continuation lines stay as empty lines. */
export function fieldText(field: TitleField): string {
  const values = field.values.map((v) => v.text);
  if (values[0] === "") values.shift();
  return values.join("\n");
}
