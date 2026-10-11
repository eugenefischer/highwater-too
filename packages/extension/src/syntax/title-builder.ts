import type { Document, TitleField } from "@highwater/parser";

/** The Title Page Builder's fields, as in Highland's dialog, with the keys each one reads. */
export const BUILDER_FIELDS = [
  { label: "Title", key: "Title", names: ["title"] },
  { label: "Credit", key: "Credit", names: ["credit"] },
  { label: "Author(s)", key: "Author", names: ["author", "authors"] },
  { label: "Source", key: "Source", names: ["source"] },
  { label: "Contact info", key: "Contact", names: ["contact", "contact info"] },
  { label: "Draft date", key: "Draft date", names: ["draft date", "date"] },
  { label: "Revision", key: "Revision", names: ["revision"] },
] as const;

export type BuilderValues = Record<(typeof BUILDER_FIELDS)[number]["label"], string>;

const valueOf = (f: TitleField) => {
  const lines = f.values.map((v) => v.text);
  while (lines.length && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines.at(-1)!.trim() === "") lines.pop();
  return lines.join("\n");
};

/** The builder's fields from the document's title page (empty when absent). */
export function readBuilderValues(doc: Document): BuilderValues {
  const fields = doc.titlePage?.fields ?? [];
  return Object.fromEntries(
    BUILDER_FIELDS.map((b) => {
      const f = fields.find((x) => (b.names as readonly string[]).includes(x.name));
      return [b.label, f ? valueOf(f) : ""];
    }),
  ) as BuilderValues;
}

/**
 * The edit that writes the builder's values: the builder's fields in Highland's order, then any
 * other fields the title page already had (TL, Notes, Copyright…) exactly as written. Removes the
 * title page when nothing is left.
 */
export function titlePageEdit(doc: Document, values: BuilderValues): { start: number; end: number; text: string } {
  const src = doc.source;
  const known = new Set<string>(BUILDER_FIELDS.flatMap((b) => [...b.names]));
  const lines: string[] = [];
  for (const b of BUILDER_FIELDS) {
    const v = values[b.label].replace(/\r\n?/g, "\n").replace(/^\n+|\n+$/g, "");
    if (v.trim() === "") continue;
    const parts = v.split("\n");
    if (parts.length === 1) lines.push(`${b.key}: ${parts[0]!.trim()}`);
    else lines.push(`${b.key}:`, ...parts.map((p) => `\t${p.trim()}`));
  }
  const others = (doc.titlePage?.fields ?? []).filter((f) => !known.has(f.name)).map((f) => src.slice(f.span.start, f.span.end).replace(/\s+$/, ""));
  const text = [...lines, ...others].join("\n");

  if (!doc.titlePage) return text ? { start: 0, end: 0, text: `${text}\n\n` } : { start: 0, end: 0, text: "" };
  const { start, end } = doc.titlePage.span;
  const body = src.slice(end);
  if (text) return { start, end: start + src.slice(start, end).replace(/\s+$/, "").length, text };
  // Nothing left: remove the title page and the empty lines after it.
  return { start, end: end + (body.length - body.replace(/^\s*\n/, "").length), text: "" };
}
