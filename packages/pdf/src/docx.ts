import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { seriesCounter, type Directive, type Document, type Element, type PageTextPart, type PageTextSlots, type TitleField } from "@highwater/parser";
import { imageSize, manuscriptHeadingPages, MANUSCRIPT, type ManuscriptOptions } from "./manuscript.ts";
import { extraBlankLines, styledValue } from "./screenplay.ts";
import { plain, toRuns, type InlineContext } from "./text.ts";
import type { Run } from "./types.ts";

/**
 * A Word document of a manuscript that looks like its PDF, made the way a careful writer would
 * make it by hand in Word: styles, a real header and footer with page-number fields, page breaks,
 * real lists and tables. Word does its own line and page breaking, so pages can differ a little.
 */

export const DOCX_FONTS = ["Courier New", "Courier Prime"] as const;
export type DocxFont = (typeof DOCX_FONTS)[number];

export interface DocxOptions extends Pick<ManuscriptOptions, "elements" | "date" | "titlePage" | "image"> {
  /** Courier New (default; on every computer), or Courier Prime embedded in the file, as in the PDF. */
  font?: DocxFont;
  /** Where Courier Prime's .ttf files are (needed to embed it). */
  fontDir?: string;
  /** Document title for the file's properties. */
  title?: string;
}

// Twentieths of a point.
const TW = 20;
const tw = (pt: number) => Math.round(pt * TW);
const TEXT_WIDTH = MANUSCRIPT.right - MANUSCRIPT.left; // 468 pt
const TITLE_LINE = MANUSCRIPT.title.pitch; // 14.4 pt, set exactly on the title page
const TITLE_ASCENT = 11.5; // baseline below the top of a 14.4 pt line, about

type PageTextDirective = Extract<Directive, { slots: PageTextSlots }>;

interface Section {
  header: PageTextDirective | null;
  footer: PageTextDirective | null;
  /** The first body section: page 1 carries no number when there is no {{HEADER}}. */
  first: boolean;
  start?: number;
}

export function manuscriptDocx(doc: Document, options: DocxOptions = {}): Uint8Array {
  const font: DocxFont = options.font ?? "Courier New";
  const elements = options.elements ?? doc.elements;
  const linkDefinitions = new Map<string, string>();
  for (const e of elements) if (e.kind === "linkDefinition") linkDefinitions.set(e.label.toLowerCase(), e.url);
  const ctx: InlineContext = { series: seriesCounter(), date: options.date ?? new Date(), links: true, linkDefinitions };
  const parts = new Parts();
  const body: string[] = [];
  const hasTitle = doc.titlePage !== null && options.titlePage !== false;

  if (hasTitle) {
    body.push(...titlePage(doc.titlePage!.fields, { ...ctx, links: false }));
    // The section break on a 1 pt line, so it never pushes the title page's last line over.
    body.push(`<w:p><w:pPr><w:pStyle w:val="TitlePage"/><w:spacing w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>${sectPr(parts, { header: null, footer: null, first: false }, { empty: true })}</w:pPr></w:p>`);
  }

  // Heading levels and pages, for {{TOC}} and %#.
  const headingTexts: { text: string; level: number }[] = [];
  {
    const c: InlineContext = { ...ctx, series: seriesCounter() };
    for (const e of elements) if (e.kind === "heading") headingTexts.push({ text: plain(toRuns(e.inline, c)).trim(), level: e.level });
  }
  const levels = headingTexts.map((h) => h.level);
  const chapterLevel = levels.length ? Math.min(...levels) : 1;
  const headingPages = elements.some((e) => e.kind === "directiveLine" && e.directives.some((d) => d.directive.kind === "toc"))
    ? manuscriptHeadingPages(doc, { ...options, ...(options.titlePage === false ? { titlePage: false } : {}) })
    : [];

  let section: Section = { header: null, footer: null, first: true };
  let bodyStarted = false;
  let printed = false;
  let afterParagraph = false;
  let afterBreak = false;
  let pageBreakNext = false;
  let headingId = 0;
  const sections: Section[] = [];
  const out: string[] = [];
  /** A paragraph; its properties written in the order Word requires. */
  const para = (pp: { style: string; numPr?: string; before?: number; jc?: string }, content: string) => {
    const pPr =
      `<w:pStyle w:val="${pp.style}"/>` +
      (pageBreakNext ? "<w:pageBreakBefore/>" : "") +
      (pp.numPr ?? "") +
      (pp.before !== undefined ? `<w:spacing w:before="${tw(pp.before)}"/>` : "") +
      (pp.jc ? `<w:jc w:val="${pp.jc}"/>` : "");
    pageBreakNext = false;
    out.push(`<w:p><w:pPr>${pPr}</w:pPr>${content}</w:p>`);
    bodyStarted = true;
    afterBreak = false;
  };
  const empty = () => para({ style: "Normal" }, "");
  /** A header, footer or page-number change after text: a new section from the next page. */
  const closeSection = (change: Partial<Section>) => {
    if (!bodyStarted) {
      section = { ...section, ...change };
      return;
    }
    // The section's properties ride on its last paragraph (after a table, an empty one).
    if (out.at(-1)!.startsWith("<w:tbl")) out.push(`<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>`);
    sections.push(section);
    const last = out.length - 1;
    out[last] = out[last]!.replace("</w:pPr>", `${sectPr(parts, section, { continuous: !section.first, single: false })}</w:pPr>`);
    const { start: _start, ...rest } = section;
    section = { ...rest, first: false, ...change };
  };

  const leading = Math.max(0, (/^(?:[ \t]*\r?\n)*/.exec(doc.source)![0].match(/\n/g) ?? []).length - 1);
  for (let k = 0; k < leading; k++) empty();
  printed = leading > 0;

  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]!;
    if (printed && e.kind !== "directiveLine") for (let k = extraBlankLines(doc.source, e.span.start); k > 0; k--) empty();
    switch (e.kind) {
      case "paragraph": {
        const img = e.inline.length === 1 && e.inline[0]!.kind === "image" ? e.inline[0] : null;
        if (img && img.kind === "image") {
          const data = options.image?.(img.src) ?? null;
          const size = data ? imageSize(data) : null;
          if (data && size) {
            const scale = Math.min(1, TEXT_WIDTH / size.width, (MANUSCRIPT.lastBaseline - MANUSCRIPT.top) / size.height);
            para({ style: "Image" }, parts.image(data, size.width * scale, size.height * scale, img.alt));
            printed = true;
            afterParagraph = false;
          }
          break;
        }
        const runs = toRuns(e.inline, ctx);
        if (plain(runs).trim() === "") break;
        para({ style: afterParagraph ? "BodyText" : "FirstParagraph" }, runsXml(runs, parts));
        printed = true;
        afterParagraph = true;
        break;
      }
      case "heading": {
        const drop = (!printed && !hasTitle) || afterBreak;
        const level = Math.min(3, Math.max(1, e.level - chapterLevel + 1));
        para({ style: `Heading${level}`, ...(drop ? { before: MANUSCRIPT.dropHeading } : {}) }, runsXml(toRuns(e.inline, ctx), parts));
        headingId++;
        printed = true;
        afterParagraph = false;
        break;
      }
      case "sceneBreak":
        para({ style: "SceneBreak" }, run("#"));
        printed = true;
        afterParagraph = false;
        break;
      case "blockQuote":
        e.paragraphs.forEach((p, k) => {
          if (k > 0) para({ style: "Quote" }, "");
          para({ style: "Quote" }, runsXml(toRuns(p.inline, ctx, { italic: true }), parts));
        });
        printed = true;
        afterParagraph = false;
        break;
      case "centered":
      case "rightAligned":
        para({ style: "FirstParagraph", jc: e.kind === "centered" ? "center" : "right" }, runsXml(toRuns(e.inline, ctx), parts));
        printed = true;
        afterParagraph = false;
        break;
      case "list": {
        const numId = parts.list(e.items);
        for (const item of e.items) para({ style: "ListParagraph", numPr: `<w:numPr><w:ilvl w:val="${Math.min(8, item.level)}"/><w:numId w:val="${numId}"/></w:numPr>` }, runsXml(toRuns(item.inline, ctx), parts));
        printed = true;
        afterParagraph = false;
        break;
      }
      case "termList":
        for (const item of e.items) para({ style: "Term" }, `<w:r><w:tab/></w:r>${runsXml(toRuns(item.termInline, ctx), parts)}<w:r><w:tab/></w:r>${runsXml(toRuns(item.definitionInline, ctx), parts)}`);
        printed = true;
        afterParagraph = false;
        break;
      case "table": {
        const aligned = e.align.some((a) => a !== null);
        const rows: { cells: Run[][]; head: boolean }[] = [];
        rows.push({ cells: e.header.map((c) => toRuns(c.inline, ctx, aligned ? {} : { bold: true })), head: !aligned });
        if (aligned) {
          const sep = e.lines[1];
          const cells = sep ? doc.source.slice(sep.content.start, sep.content.end).trim().replace(/^\|/, "").replace(/\|$/, "").split("|") : [];
          rows.push({ cells: cells.map((c) => [{ text: c.trim(), style: {} }]), head: false });
        }
        for (const r of e.rows) rows.push({ cells: r.map((c) => toRuns(c.inline, ctx)), head: false });
        if (pageBreakNext) para({ style: "Normal" }, "");
        out.push(table(rows, parts));
        bodyStarted = true;
        printed = true;
        afterParagraph = false;
        break;
      }
      case "pageBreak":
        pageBreakNext = true;
        afterParagraph = false;
        afterBreak = true;
        continue;
      case "directiveLine": {
        for (const { directive: d } of e.directives) {
          if (d.kind === "header") closeSection({ header: d });
          else if (d.kind === "footer") closeSection({ footer: d });
          else if (d.kind === "pageNumber" && d.value !== null) closeSection({ start: d.value });
          else if (d.kind === "toc") {
            const entries = headingTexts.map((h, id) => ({ ...h, page: headingPages[id] })).filter((h) => !d.levels || d.levels.includes(h.level));
            const lv = (d.levels ?? levels).map((l) => l - chapterLevel + 1);
            const lo = Math.max(1, Math.min(...lv, 3));
            const hi = Math.min(3, Math.max(...lv, 1));
            if (entries.length) {
              entries.forEach((h, k) => {
                const begin = k === 0 ? `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "${lo}-${hi}" \\h \\z </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` : "";
                const end = k === entries.length - 1 ? `<w:r><w:fldChar w:fldCharType="end"/></w:r>` : "";
                const level = Math.min(3, Math.max(1, h.level - chapterLevel + 1));
                para({ style: `TOC${level}` }, `${begin}${run(h.text)}<w:r><w:tab/></w:r>${run(String(h.page ?? ""))}${end}`);
              });
              empty();
              printed = true;
              afterParagraph = false;
            }
          }
        }
        break;
      }
      case "action":
      case "lyric":
        para({ style: "FirstParagraph" }, runsXml(toRuns(e.inline, ctx), parts));
        printed = true;
        break;
      default:
        break;
    }
  }
  if (out.length === 0) out.push(`<w:p><w:pPr><w:pStyle w:val="FirstParagraph"/></w:pPr></w:p>`);
  sections.push(section);
  const singleBody = sections.length === 1;
  body.push(...out);
  // A section's type says how it starts: the first after the title page on a new page, later ones
  // (a changed header, footer or page number) continuing the page they start on.
  body.push(sectPr(parts, section, { single: singleBody, continuous: !section.first }));
  // A section's %pp: its page count when the body is one section, else the document's.
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join("")}</w:body></w:document>`;
  return parts.zip(documentXml, font, options);
}

// ---------------------------------------------------------------------------------------------
// Title page: the PDF's blocks in the same places, placed with paragraph spacing.

function titlePage(fields: TitleField[], ctx: InlineContext): string[] {
  const T = MANUSCRIPT.title;
  const get = (name: string) => fields.find((f) => f.name === name);
  const lines = (f: TitleField | undefined): Run[][] => (f ? f.values.map((v) => (v.text.trim() === "" ? [] : styledValue(v.text, ctx))) : []);
  const trim = (ls: Run[][]) => {
    let a = 0;
    let b = ls.length;
    while (a < b && ls[a]!.length === 0) a++;
    while (b > a && ls[b - 1]!.length === 0) b--;
    return ls.slice(a, b);
  };
  const any = (...names: string[]) => names.flatMap((n) => trim(lines(get(n))));
  /** Printed lines a value takes, at 65 characters a line. */
  const height = (ls: Run[][]) => ls.reduce((h, r) => h + Math.max(1, Math.ceil(plain(r).length / MANUSCRIPT.chars)), 0) * TITLE_LINE;
  const out: string[] = [];
  let y = MANUSCRIPT.top; // top of the next line
  const p = (runs: Run[], jc: string, before = 0) =>
    `<w:p><w:pPr><w:pStyle w:val="TitlePage"/>${before > 0 ? `<w:spacing w:before="${tw(before)}"/>` : ""}${jc !== "left" ? `<w:jc w:val="${jc}"/>` : ""}</w:pPr>${runsXml(runs, null)}</w:p>`;
  /** Left and right blocks side by side: a borderless two-column table when both are there. */
  const pair = (left: Run[][], right: Run[][], before: number): string[] => {
    if (!left.length && !right.length) return [];
    if (!right.length || !left.length) {
      const ls = left.length ? left : right;
      return ls.map((r, k) => p(r, left.length ? "left" : "right", k === 0 ? before : 0));
    }
    const cell = (ls: Run[][], jc: string) =>
      `<w:tc><w:tcPr><w:tcW w:w="${tw(TEXT_WIDTH / 2)}" w:type="dxa"/></w:tcPr>${ls.map((r) => p(r, jc)).join("")}</w:tc>`;
    const spacer = before > 0 ? `<w:p><w:pPr><w:pStyle w:val="TitlePage"/><w:spacing w:before="0" w:line="${tw(before)}" w:lineRule="exact"/></w:pPr></w:p>` : "";
    return [
      spacer +
        `<w:tbl><w:tblPr><w:tblW w:w="${tw(TEXT_WIDTH)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${tw(TEXT_WIDTH / 2)}"/><w:gridCol w:w="${tw(TEXT_WIDTH / 2)}"/></w:tblGrid><w:tr>${cell(left, "left")}${cell(right, "right")}</w:tr></w:tbl>`,
    ];
  };
  const tl = any("tl", "contact", "contact info");
  const tr = any("tr");
  out.push(...pair(tl, tr, 0));
  y += Math.max(height(tl), height(tr));
  const blocks: Run[][][] = [];
  const cc = trim(lines(get("cc")));
  if (cc.length) blocks.push(cc);
  else for (const name of ["title", "credit", "author", "authors", "source"]) {
    const ls = trim(lines(get(name)));
    if (ls.length) blocks.push(ls);
  }
  blocks.forEach((ls, k) => {
    const before = k === 0 ? Math.max(0, T.centreY - TITLE_ASCENT - y) : 2 * TITLE_LINE;
    ls.forEach((r, j) => out.push(p(r, "center", j === 0 ? before : 0)));
    y += before + height(ls);
  });
  const bl = any("bl", "notes", "copyright");
  const br = any("br", "draft date", "date", "revision");
  const bottom = Math.max(height(bl), height(br));
  // A few points short of the PDF's bottom line, so rounding never pushes it onto a second page.
  if (bottom > 0) out.push(...pair(bl, br, Math.max(0, T.bottomY - TITLE_ASCENT - (bottom - TITLE_LINE) - y - 4)));
  if (!out.length) out.push(`<w:p><w:pPr><w:pStyle w:val="TitlePage"/></w:pPr></w:p>`);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Runs, tables, sections

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function run(text: string, rPr = ""): string {
  const pieces = text.split("\n").map((t) => t.split("\t").map((x) => (x ? `<w:t xml:space="preserve">${esc(x)}</w:t>` : "")).join("<w:tab/>"));
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${pieces.join("<w:br/>")}</w:r>`;
}

function runsXml(runs: Run[], parts: Parts | null): string {
  let out = "";
  let i = 0;
  while (i < runs.length) {
    const href = runs[i]!.style.href;
    let j = i;
    let group = "";
    while (j < runs.length && runs[j]!.style.href === href) {
      const s = runs[j]!.style;
      const rPr =
        (s.link ? `<w:rStyle w:val="Hyperlink"/>` : "") +
        (s.bold ? "<w:b/>" : "") +
        (s.italic ? "<w:i/>" : "") +
        (s.strike ? "<w:strike/>" : "") +
        (s.highlight ? `<w:highlight w:val="yellow"/>` : "") +
        (s.underline ? `<w:u w:val="single"/>` : "");
      group += run(runs[j]!.text, rPr);
      j++;
    }
    out += href && parts ? `<w:hyperlink r:id="${parts.link(href)}" w:history="1">${group}</w:hyperlink>` : group;
    i = j;
  }
  return out;
}

function table(rows: { cells: Run[][]; head: boolean }[], parts: Parts): string {
  const cols = Math.max(1, ...rows.map((r) => r.cells.length));
  const w = Math.floor(tw(TEXT_WIDTH) / cols);
  const border = `<w:tcBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="BCBEC0"/></w:tcBorders>`;
  const tr = (r: { cells: Run[][]; head: boolean }) =>
    `<w:tr><w:trPr><w:cantSplit/>${r.head ? "<w:tblHeader/>" : ""}</w:trPr>${Array.from({ length: cols }, (_, c) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${border}</w:tcPr><w:p><w:pPr><w:pStyle w:val="TableText"/>${r.head ? `<w:jc w:val="center"/>` : ""}</w:pPr>${runsXml(r.cells[c] ?? [], parts)}</w:p></w:tc>`).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${w * cols}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.map(tr).join("")}</w:tbl>`;
}

function sectPr(parts: Parts, s: Section, o: { empty?: boolean; continuous?: boolean; single?: boolean }): string {
  const refs: string[] = [];
  let titlePg = false;
  if (!o.empty) {
    const fill = (parts_: PageTextPart[] | null): string =>
      (parts_ ?? [])
        .map((t) =>
          t.kind === "text"
            ? run(t.text)
            : t.kind === "page"
              ? field("PAGE", "1")
              : t.kind === "pageCount"
                ? field(o.single ? "SECTIONPAGES" : "NUMPAGES", "1")
                : field(`STYLEREF "heading 1"`, ""),
        )
        .join("");
    /** Left, centre and right parts; a centre tab stop only when there is a centre part, so a long right part has room. */
    const slots = (d: PageTextSlots, kind: "Header" | "Footer") => {
      const has = (x: PageTextPart[] | null) => (x ?? []).length > 0;
      const tabs = has(d.center) ? "" : `<w:tabs><w:tab w:val="clear" w:pos="${tw(TEXT_WIDTH / 2)}"/></w:tabs>`;
      const content = has(d.center) ? `${fill(d.left)}<w:r><w:tab/></w:r>${fill(d.center)}<w:r><w:tab/></w:r>${fill(d.right)}` : `${fill(d.left)}${has(d.right) ? `<w:r><w:tab/></w:r>${fill(d.right)}` : ""}`;
      return `<w:p><w:pPr><w:pStyle w:val="${kind}"/>${tabs}</w:pPr>${content}</w:p>`;
    };
    if (s.header === null) {
      // Without a {{HEADER}}, page numbers at the top right, from page 2 of the text.
      refs.push(`<w:headerReference w:type="default" r:id="${parts.part("header", `<w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>${field("PAGE", "1")}</w:p>`)}"/>`);
      if (s.first) {
        refs.push(`<w:headerReference w:type="first" r:id="${parts.part("header", `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>`)}"/>`);
        titlePg = true;
      }
    } else refs.push(`<w:headerReference w:type="default" r:id="${parts.part("header", s.header.off ? `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>` : slots(s.header.slots, "Header"))}"/>`);
    if (s.footer && !s.footer.off) {
      const id = parts.part("footer", slots(s.footer.slots, "Footer"));
      refs.push(`<w:footerReference w:type="default" r:id="${id}"/>`);
      // The first page leaves out only the page number, not the footer.
      if (titlePg) refs.push(`<w:footerReference w:type="first" r:id="${id}"/>`);
    } else if (titlePg || s.footer) refs.push(`<w:footerReference w:type="default" r:id="${parts.part("footer", `<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p>`)}"/>`);
  } else {
    refs.push(`<w:headerReference w:type="default" r:id="${parts.part("header", `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>`)}"/>`);
    refs.push(`<w:footerReference w:type="default" r:id="${parts.part("footer", `<w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr></w:p>`)}"/>`);
  }
  const start = s.start !== undefined ? s.start : s.first ? 1 : undefined;
  return `<w:sectPr>${refs.join("")}${o.continuous ? `<w:type w:val="continuous"/>` : ""}<w:pgSz w:w="${tw(MANUSCRIPT.width)}" w:h="${tw(MANUSCRIPT.height)}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="680" w:footer="1100" w:gutter="0"/>${start !== undefined ? `<w:pgNumType w:start="${start}"/>` : ""}${titlePg ? "<w:titlePg/>" : ""}</w:sectPr>`;
}

function field(instr: string, result: string): string {
  return `<w:fldSimple w:instr=" ${esc(instr)} ">${run(result || " ")}</w:fldSimple>`;
}

// ---------------------------------------------------------------------------------------------
// The package: relationships, headers and footers, images, numbering, styles, fonts.

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

type ListItems = Extract<Element, { kind: "list" }>["items"];

class Parts {
  readonly rels: string[] = [];
  readonly files: Record<string, Uint8Array> = {};
  readonly overrides: string[] = [];
  readonly numbering: { abstract: string; num: string }[] = [];
  #id = 10;
  #counts: Record<string, number> = {};
  #links = new Map<string, string>();

  rel(type: string, target: string, external = false): string {
    const id = `rId${++this.#id}`;
    this.rels.push(`<Relationship Id="${id}" Type="${REL}/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return id;
  }
  link(href: string): string {
    let id = this.#links.get(href);
    if (!id) this.#links.set(href, (id = this.rel("hyperlink", href, true)));
    return id;
  }
  part(kind: "header" | "footer", content: string): string {
    const n = (this.#counts[kind] = (this.#counts[kind] ?? 0) + 1);
    const name = `${kind}${n}.xml`;
    const tag = kind === "header" ? "hdr" : "ftr";
    this.files[`word/${name}`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${tag} ${NS}>${content}</w:${tag}>`);
    this.overrides.push(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`);
    return this.rel(kind, name);
  }
  image(data: Uint8Array, widthPt: number, heightPt: number, alt: string): string {
    const n = (this.#counts.image = (this.#counts.image ?? 0) + 1);
    const ext = data[0] === 0x89 ? "png" : "jpeg";
    this.files[`word/media/image${n}.${ext}`] = data;
    const id = this.rel("image", `media/image${n}.${ext}`);
    const cx = Math.round(widthPt * 12700);
    const cy = Math.round(heightPt * 12700);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${esc(alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  /** One numbering per list, so each starts from its own first number. */
  list(items: ListItems): number {
    const id = this.numbering.length + 1;
    const lvls: string[] = [];
    for (let l = 0; l < 9; l++) {
      const first = items.find((it) => it.level === l) ?? items.find((it) => it.level >= l);
      const textX = l === 0 ? MANUSCRIPT.list.textX : MANUSCRIPT.list.nestedX + l * MANUSCRIPT.list.level;
      const left = tw(textX - MANUSCRIPT.left);
      const ind = `<w:pPr><w:ind w:left="${left}" w:right="${tw(MANUSCRIPT.right - MANUSCRIPT.list.right)}" w:hanging="${tw(3 * 7.2)}"/></w:pPr>`;
      if (first?.ordered) {
        const m = /^(\d+)(\D*)$/.exec(first.marker);
        const start = m ? Number(m[1]) : 1;
        const suffix = m ? m[2] : ".";
        lvls.push(`<w:lvl w:ilvl="${l}"><w:start w:val="${start}"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${l + 1}${esc(suffix ?? ".")}"/><w:lvlJc w:val="left"/>${ind}</w:lvl>`);
      } else {
        const bullet = first?.marker === "-" ? "-" : "•";
        lvls.push(`<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bullet}"/><w:lvlJc w:val="left"/>${ind}<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:lvl>`);
      }
    }
    this.numbering.push({
      abstract: `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${lvls.join("")}</w:abstractNum>`,
      num: `<w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`,
    });
    return id;
  }

  zip(documentXml: string, font: DocxFont, options: DocxOptions): Uint8Array {
    const files: Record<string, Uint8Array> = { ...this.files };
    const embedded = font === "Courier Prime" ? embedFonts(options.fontDir) : null;
    const docRels = [
      `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>`,
      `<Relationship Id="rId2" Type="${REL}/settings" Target="settings.xml"/>`,
      `<Relationship Id="rId3" Type="${REL}/fontTable" Target="fontTable.xml"/>`,
      `<Relationship Id="rId4" Type="${REL}/numbering" Target="numbering.xml"/>`,
      ...this.rels,
    ];
    files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${this.overrides.join("")}</Types>`);
    files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    files["docProps/core.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(options.title ?? "")}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${(options.date ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`);
    files["word/document.xml"] = strToU8(documentXml);
    files["word/_rels/document.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join("")}</Relationships>`);
    files["word/styles.xml"] = strToU8(stylesXml(font));
    files["word/settings.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${NS}>${embedded ? "<w:embedTrueTypeFonts/>" : ""}<w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
    files["word/numbering.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${NS}>${this.numbering.map((n) => n.abstract).join("")}${this.numbering.map((n) => n.num).join("")}</w:numbering>`);
    const fontRels: string[] = [];
    let embeds = "";
    if (embedded) {
      embedded.forEach((f, i) => {
        files[`word/fonts/font${i + 1}.odttf`] = f.data;
        fontRels.push(`<Relationship Id="rIdF${i + 1}" Type="${REL}/font" Target="fonts/font${i + 1}.odttf"/>`);
        embeds += `<w:${f.kind} r:id="rIdF${i + 1}" w:fontKey="${f.key}"/>`;
      });
      files["word/_rels/fontTable.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fontRels.join("")}</Relationships>`);
    }
    files["word/fontTable.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts ${NS}><w:font w:name="${font}">${font === "Courier Prime" ? '<w:altName w:val="Courier New"/>' : ""}<w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/>${embeds}</w:font><w:font w:name="Courier New"><w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font></w:fonts>`);
    return zipSync(files, { level: 6 });
  }
}

/** Courier Prime's four styles, obfuscated as Office requires for embedded fonts. */
function embedFonts(fontDir: string | undefined): { kind: string; key: string; data: Uint8Array }[] {
  if (!fontDir) throw new Error("Embedding Courier Prime needs its font folder");
  const files: [string, string][] = [
    ["embedRegular", "CourierPrime-Regular.ttf"],
    ["embedBold", "CourierPrime-Bold.ttf"],
    ["embedItalic", "CourierPrime-Italic.ttf"],
    ["embedBoldItalic", "CourierPrime-BoldItalic.ttf"],
  ];
  return files.map(([kind, file]) => {
    const guid = randomUUID().toUpperCase();
    const hex = guid.replace(/-/g, "");
    const key = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(30 - 2 * i, 32 - 2 * i), 16));
    const data = new Uint8Array(readFileSync(join(fontDir, file)));
    for (let i = 0; i < 32; i++) data[i] = data[i]! ^ key[i % 16]!;
    return { kind, key: `{${guid}}`, data };
  });
}

function stylesXml(font: DocxFont): string {
  const fonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;
  // Double spacing; Courier Prime's own double spacing is shorter than Highland's 28.32 pt lines, so
  // with it the lines are set to exactly that (both are ordinary Word line-spacing settings).
  const double = font === "Courier Prime" ? `<w:spacing w:before="0" w:after="0" w:line="${tw(MANUSCRIPT.pitch)}" w:lineRule="exact"/>` : `<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/>`;
  const single = `<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>`;
  const p = (id: string, name: string, pPr: string, rPr = "", extra = "") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${pPr}</w:pPr>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}</w:style>`;
  const heading = (n: number) =>
    p(`Heading${n}`, `heading ${n}`, `<w:keepNext/><w:keepLines/><w:spacing w:before="0" w:after="${tw(MANUSCRIPT.headingAfter)}"/><w:jc w:val="center"/><w:outlineLvl w:val="${n - 1}"/>`, "", `<w:next w:val="FirstParagraph"/>`);
  const toc = (n: number) => p(`TOC${n}`, `toc ${n}`, `<w:tabs><w:tab w:val="right" w:pos="${tw(TEXT_WIDTH)}"/></w:tabs><w:spacing w:after="${tw(MANUSCRIPT.toc.height - 28.32)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>${fonts}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${double}</w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr>${double}</w:pPr><w:rPr>${fonts}<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
${p("BodyText", "Body Text", `<w:ind w:firstLine="${tw(MANUSCRIPT.indent)}"/>`)}
${p("FirstParagraph", "First Paragraph", `<w:ind w:firstLine="0"/>`, "", `<w:next w:val="BodyText"/>`)}
${heading(1)}${heading(2)}${heading(3)}
${p("SceneBreak", "Scene Break", `<w:jc w:val="center"/>`, "", `<w:next w:val="FirstParagraph"/>`)}
${p("Quote", "Quote", `<w:keepLines/><w:ind w:left="${tw(MANUSCRIPT.quote.x - MANUSCRIPT.left)}"/>`)}
${p("ListParagraph", "List Paragraph", `<w:keepLines/>`)}
${p("Term", "Term", `<w:tabs><w:tab w:val="right" w:pos="${tw(MANUSCRIPT.terms.termRight - MANUSCRIPT.left)}"/><w:tab w:val="left" w:pos="${tw(MANUSCRIPT.terms.definitionX - MANUSCRIPT.left)}"/></w:tabs>${single}<w:ind w:left="${tw(MANUSCRIPT.terms.definitionX - MANUSCRIPT.left)}" w:hanging="${tw(MANUSCRIPT.terms.definitionX - MANUSCRIPT.left)}"/>`)}
${p("TableText", "Table Text", "")}
${p("Image", "Image", `<w:keepNext/><w:jc w:val="center"/>`)}
${p("TitlePage", "Title Page", `<w:spacing w:before="0" w:after="0" w:line="${tw(TITLE_LINE)}" w:lineRule="exact"/>`)}
${p("Header", "header", `<w:tabs><w:tab w:val="center" w:pos="${tw(TEXT_WIDTH / 2)}"/><w:tab w:val="right" w:pos="${tw(TEXT_WIDTH)}"/></w:tabs>${single}`)}
${p("Footer", "footer", `<w:tabs><w:tab w:val="center" w:pos="${tw(TEXT_WIDTH / 2)}"/><w:tab w:val="right" w:pos="${tw(TEXT_WIDTH)}"/></w:tabs>${single}`)}
${toc(1)}${toc(2)}${toc(3)}
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0000FF"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
}
