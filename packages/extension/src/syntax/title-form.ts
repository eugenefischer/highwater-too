import { frontMatterAt, yamlEntries, yamlKeyName, yamlScalar, TITLE_PAGE_KEYS, type Document, type TitleField } from "@highwater/parser";

/**
 * A manuscript's title page in either form, and converting between them (EJ, 2026-11-23):
 * Highland's `Key: value` lines, or YAML front matter whose keys are Highland's field names in
 * lower case with "_" for spaces (title, credit, author, source, contact, notes, copyright,
 * draft_date, date, revision; tl, tr, cc, bl, br for the corners). Field for field, nothing lost.
 */

/** One replacement in the document, by offsets in its text as it is now. */
export interface FormEdit {
  start: number;
  end: number;
  text: string;
}

/** Highland's spelling of each field's key. */
const HIGHLAND_KEY: Record<string, string> = {
  title: "Title",
  credit: "Credit",
  author: "Author",
  authors: "Authors",
  source: "Source",
  "draft date": "Draft date",
  date: "Date",
  contact: "Contact",
  "contact info": "Contact info",
  revision: "Revision",
  copyright: "Copyright",
  notes: "Notes",
  watermark: "Watermark",
  font: "Font",
  tl: "TL",
  tc: "TC",
  tr: "TR",
  cc: "CC",
  bl: "BL",
  br: "BR",
};

/** A field's lines: Highland's value after the key (if any) and its continuation lines; trailing empty lines dropped. */
export function fieldLines(field: TitleField): string[] {
  const lines = field.values.map((v) => v.text);
  if (lines.length > 1 && lines[0]!.trim() === "") lines.shift();
  while (lines.length && lines.at(-1)!.trim() === "") lines.pop();
  return lines;
}

/** A field as YAML: one line as a scalar, several as a `|` block that keeps them as written. */
export function yamlField(key: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [`${key}: ""`];
  if (lines.length === 1) return [`${key}: ${yamlScalar(lines[0]!)}`];
  return [`${key}: |`, ...lines.map((l) => (l === "" ? "" : `  ${l}`))];
}

/** A field in Highland's form: `Key: value`, or the key alone with its lines indented by a tab. */
export function highlandField(key: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [`${key}:`];
  if (lines.length === 1) return [`${key}: ${lines[0]}`];
  return [`${key}:`, ...lines.map((l) => `\t${l}`)];
}

/** The YAML key for a field name ("draft date" → draft_date). */
export const yamlKeyFor = (name: string) => name.replace(/ /g, "_");
/** Highland's key for a field name. */
export const highlandKeyFor = (name: string, written: string) => HIGHLAND_KEY[name] ?? written;

/**
 * Where the text after the title page begins: after the front matter or Highland title page,
 * whichever ends later, and the blank lines that follow.
 */
function bodyStart(doc: Document): number {
  let end = 0;
  if (doc.frontMatter) end = doc.frontMatter.end;
  if (doc.titlePage && !doc.titlePage.yaml) end = Math.max(end, doc.titlePage.span.end);
  const rest = doc.source.slice(end);
  return end + (rest.length - rest.replace(/^(?:[ \t]*\r?\n)+/, "").length);
}

/** The front matter's own lines that aren't title-page fields (other keys, comments), as written. */
function otherYamlLines(doc: Document): string[] {
  const front = frontMatterAt(doc.source);
  if (!front) return [];
  const src = doc.source;
  const title = yamlEntries(src, front.inner).filter((e) => TITLE_PAGE_KEYS.has(yamlKeyName(e.key)));
  const out: string[] = [];
  for (let at = front.inner.start; at < front.inner.end; ) {
    const nl = src.indexOf("\n", at);
    const end = nl < 0 || nl >= front.inner.end ? front.inner.end : nl;
    if (!title.some((e) => at >= e.span.start && at <= e.span.end)) out.push(src.slice(at, end).replace(/\r$/, ""));
    at = end + 1;
  }
  while (out.length && out.at(-1)!.trim() === "") out.pop();
  return out;
}

/** A byte-order mark the document starts with, kept at the start. */
const bom = (doc: Document) => (doc.source.charCodeAt(0) === 0xfeff ? "﻿" : "");

/**
 * The edit that makes the document's head YAML front matter holding these title lines (YAML),
 * after the front matter's other lines, followed by the text. No title lines and nothing else:
 * no front matter at all.
 */
export function yamlHead(doc: Document, titleYaml: readonly string[]): FormEdit {
  const lines = [...otherYamlLines(doc), ...titleYaml];
  const head = lines.length ? `${bom(doc)}---\n${lines.join("\n")}\n---\n\n` : bom(doc);
  return { start: 0, end: bodyStart(doc), text: head };
}

/** The edit that makes the document's head Highland's title page (these lines), after any front matter left over. */
function highlandHead(doc: Document, titleLines: readonly string[]): FormEdit {
  const other = otherYamlLines(doc);
  const front = other.length ? `---\n${other.join("\n")}\n---\n\n` : "";
  // Without a byte-order mark before Highland's first key: the title page wouldn't be read after one.
  return { start: 0, end: bodyStart(doc), text: `${front ? bom(doc) : ""}${front}${titleLines.length ? `${titleLines.join("\n")}\n\n` : ""}` };
}

/** Highland's title page as YAML front matter (other front matter kept). Null if there's none, or it is YAML already. */
export function toYamlTitlePage(doc: Document): FormEdit | null {
  const tp = doc.titlePage;
  if (!tp || tp.yaml) return null;
  return yamlHead(doc, tp.fields.flatMap((f) => yamlField(yamlKeyFor(f.name), fieldLines(f))));
}

/** A YAML title page as Highland's lines (the front matter's other keys kept). Null if there's none, or it is Highland's already. */
export function toHighlandTitlePage(doc: Document): FormEdit | null {
  const tp = doc.titlePage;
  if (!tp?.yaml) return null;
  return highlandHead(doc, tp.fields.flatMap((f) => highlandField(highlandKeyFor(f.name, f.key), fieldLines(f))));
}
