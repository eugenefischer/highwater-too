import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HighlandBundle } from "@highwater/bundle";
import { parse, resolveIncludes, type IncludeFile, type IncludeLoader } from "@highwater/parser";
import { layoutManuscript, layoutPlainText, layoutProse, layoutScreenplay, PROSE_TEMPLATES, manuscriptDocx, renderPdf, SCREENPLAY, SCRIPT_TEMPLATES, type DocxFont, type Layout, type PrintMarks, type SourceRange } from "@highwater/pdf";
import type { Document, Element, MergedElement } from "@highwater/parser";
import { paragraphNumbers } from "./highland-editor/line-styles.ts";

export interface ExportOptions {
  /** The script text (the editor's, so unsaved edits are included). */
  text: string;
  /** The .highland or .fountain file the text belongs to; includes resolve relative to it. */
  path: string;
  fontDir: string;
  titlePage?: boolean;
  /** Highland's other print options. */
  print?: PrintFlags;
  /** False: lay out only, for the page count (no PDF is drawn; `pdf` comes back empty). */
  render?: boolean;
  date?: Date;
}

export interface PrintFlags {
  notes: boolean;
  synopses: boolean;
  revisionColor: boolean;
  revisionStars: boolean;
  paragraphNumbers: boolean;
}

/** The layouts' print marks for the options that are on (none: undefined, so nothing changes). */
function marksOf(doc: Document, print: PrintFlags | undefined, prose = false): { print: PrintMarks } | Record<string, never> {
  if (!print || !Object.values(print).some(Boolean)) return {};
  const { paragraphNumbers: numbered, ...rest } = print;
  return { print: { ...rest, ...(numbered ? { numbers: paragraphNumbers(doc, { notes: prose && print.notes }) } : {}) } };
}

export interface ScriptExportOptions extends ExportOptions {
  /** A script template's name (Screenplay, Stage Play, Graphic Novel); default Screenplay. */
  template?: string;
  /** The template's font option; default Courier Prime. */
  font?: string;
  /** Multi-Cam's Uppercase action option (on by default). */
  uppercaseAction?: boolean;
}

export interface ManuscriptExportOptions extends ExportOptions {
  /** The template's font option; default Courier Prime. */
  font?: string;
  /** Image bytes for `![alt](src)`: the bundle's assets, or files next to a plain Markdown file. */
  image?: (src: string) => Uint8Array | null;
}

/** Reads an included file by path relative to the including one; .highland files give their script text. */
export const includeLoader: IncludeLoader = async (path, from) => {
  const full = resolve(dirname(from.id), path);
  try {
    const source = full.toLowerCase().endsWith(".highland") ? HighlandBundle.fromZip(new Uint8Array(await readFile(full))).text : await readFile(full, "utf8");
    return { id: full, name: path, source };
  } catch {
    return null;
  }
};

/** Lays out and renders a screenplay, with {{INCLUDE}} files merged in. */
export async function exportScreenplay(options: ScriptExportOptions): Promise<ExportResult> {
  const root: IncludeFile = { id: options.path, name: options.path, source: options.text };
  const merged = await resolveIncludes(root, "fountain", includeLoader);
  const doc = parse(options.text, { mode: "fountain" });
  const layout = layoutScreenplay(doc, {
    elements: merged.elements.map((m) => m.element),
    sourceOf: sourceMap(merged.elements, root),
    ...(options.date ? { date: options.date } : {}),
    ...(options.titlePage === false ? { titlePage: false } : {}),
    template: script(options),
    ...(options.font ? { font: options.font, fontDir: options.fontDir } : {}),
    ...marksOf(doc, options.print),
  });
  const title = doc.titlePage?.fields.find((f) => f.name === "title")?.values.map((v) => v.text).filter(Boolean).join(" ") ?? "";
  const pdf = options.render === false ? new Uint8Array() : await renderPdf(layout, { fontDir: options.fontDir, title });
  return { pdf, pages: layout.pages.length, problems: [...merged.problems.map((p) => p.message), ...missingFonts(layout.substituted, options.template ?? "Screenplay")], anchors: anchors(layout) };
}

function script(options: ScriptExportOptions) {
  const t = SCRIPT_TEMPLATES[options.template ?? "Screenplay"] ?? SCREENPLAY;
  return options.uppercaseAction === false ? { ...t, uppercaseAction: false } : t;
}

/** A warning for each template font that isn't installed. */
function missingFonts(substituted: Record<string, string>, template: string): string[] {
  return Object.entries(substituted).map(([font, sub]) => `${font} isn't installed on this computer, so ${template} prints in ${sub} instead; lines and pages may fall differently from Highland 2's.`);
}

export interface ProseExportOptions extends ExportOptions {
  /** A prose template's name (Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report, Wiki). */
  template: string;
  /** The template's font options. */
  fonts?: { headers?: string; body?: string };
  image?: (src: string) => Uint8Array | null;
}

/** Lays out and renders a prose template, with {{INCLUDE}} files merged in. */
export async function exportProse(options: ProseExportOptions): Promise<ExportResult> {
  const root: IncludeFile = { id: options.path, name: options.path, source: options.text };
  const merged = await resolveIncludes(root, "markdown", includeLoader);
  const doc = parse(options.text, { mode: "markdown" });
  const layout = layoutProse(doc, PROSE_TEMPLATES[options.template]!, {
    elements: merged.elements.map((m) => m.element),
    sourceOf: sourceMap(merged.elements, root),
    fontDir: options.fontDir,
    ...(options.fonts ? { fonts: options.fonts } : {}),
    ...(options.date ? { date: options.date } : {}),
    ...(options.titlePage === false ? { titlePage: false } : {}),
    ...(options.image ? { image: options.image } : {}),
    ...marksOf(doc, options.print, true),
  });
  const title = doc.titlePage?.fields.find((f) => f.name === "title")?.values.map((v) => v.text).filter(Boolean).join(" ") ?? "";
  const pdf = options.render === false ? new Uint8Array() : await renderPdf(layout, { fontDir: options.fontDir, title });
  const missing = missingFonts(layout.substituted, options.template);
  return { pdf, pages: layout.pages.length, problems: [...merged.problems.map((p) => p.message), ...missing], anchors: anchors(layout) };
}

/** The Plain Text template: the text as typed (includes and directives print as written). */
export async function exportPlainText(options: ExportOptions): Promise<ExportResult> {
  const layout = layoutPlainText(options.text);
  const pdf = options.render === false ? new Uint8Array() : await renderPdf(layout, { fontDir: options.fontDir, title: "" });
  return { pdf, pages: layout.pages.length, problems: [], anchors: anchors(layout) };
}

/** Lays out and renders a manuscript, with {{INCLUDE}} files merged in. */
export async function exportManuscript(options: ManuscriptExportOptions): Promise<ExportResult> {
  const root: IncludeFile = { id: options.path, name: options.path, source: options.text };
  const merged = await resolveIncludes(root, "markdown", includeLoader);
  const doc = parse(options.text, { mode: "markdown" });
  const layout = layoutManuscript(doc, {
    elements: merged.elements.map((m) => m.element),
    sourceOf: sourceMap(merged.elements, root),
    ...(options.date ? { date: options.date } : {}),
    ...(options.titlePage === false ? { titlePage: false } : {}),
    ...(options.image ? { image: options.image } : {}),
    ...(options.font ? { font: options.font, fontDir: options.fontDir } : {}),
    ...marksOf(doc, options.print),
  });
  const cc = doc.titlePage?.fields.find((f) => f.name === "cc" || f.name === "title");
  const title = cc?.values.map((v) => v.text.trim()).find(Boolean) ?? "";
  const pdf = options.render === false ? new Uint8Array() : await renderPdf(layout, { fontDir: options.fontDir, title });
  return { pdf, pages: layout.pages.length, problems: [...merged.problems.map((p) => p.message), ...missingFonts(layout.substituted, "Manuscript")], anchors: anchors(layout) };
}

/** A Word document of a manuscript, with {{INCLUDE}} files merged in. */
export async function exportManuscriptDocx(options: ManuscriptExportOptions & { font: DocxFont }): Promise<{ docx: Uint8Array; problems: string[] }> {
  const root: IncludeFile = { id: options.path, name: options.path, source: options.text };
  const merged = await resolveIncludes(root, "markdown", includeLoader);
  const doc = parse(options.text, { mode: "markdown" });
  const cc = doc.titlePage?.fields.find((f) => f.name === "cc" || f.name === "title");
  const docx = manuscriptDocx(doc, {
    elements: merged.elements.map((m) => m.element),
    font: options.font,
    fontDir: options.fontDir,
    title: cc?.values.map((v) => v.text.trim()).find(Boolean) ?? "",
    ...(options.date ? { date: options.date } : {}),
    ...(options.titlePage === false ? { titlePage: false } : {}),
    ...(options.image ? { image: options.image } : {}),
  });
  return { docx, problems: merged.problems.map((p) => p.message) };
}

/** Reads every image a manuscript names, so layout (which is synchronous) can look them up. */
export async function loadImages(text: string, read: (src: string) => Promise<Uint8Array | null>): Promise<(src: string) => Uint8Array | null> {
  const found = new Map<string, Uint8Array | null>();
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    const src = m[1]!;
    if (!found.has(src)) found.set(src, await read(src).catch(() => null));
  }
  return (src) => found.get(src) ?? null;
}

export interface ExportResult {
  pdf: Uint8Array;
  pages: number;
  problems: string[];
  /** Printed lines as [page index, baseline y, source offset] triples, in print order. */
  anchors: number[];
}

/** Elements from included files map to the include line in the script that pulled them in. */
function sourceMap(elements: MergedElement[], root: IncludeFile): (e: Element) => SourceRange {
  const map = new Map<Element, SourceRange>();
  let last: SourceRange = { start: 0, end: 0 };
  for (const m of elements) {
    if (m.file === root || m.file.id === root.id) last = m.element.span;
    map.set(m.element, m.file === root || m.file.id === root.id ? m.element.span : { start: last.start, end: last.start });
  }
  return (e) => map.get(e) ?? e.span;
}

function anchors(layout: Layout): number[] {
  const out: number[] = [];
  layout.pages.forEach((p, i) => {
    let lastY = -1;
    for (const it of p.items) {
      if (it.source === undefined || it.y === lastY) continue;
      out.push(i, it.y, it.source);
      lastY = it.y;
    }
  });
  return out;
}
