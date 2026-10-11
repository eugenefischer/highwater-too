import { seriesCounter, type Directive, type Document, type Element, type PageTextPart, type PageTextSlots, type TitleField } from "@highwater/parser";
import { extraBlankLines, pageText, sameParagraph, styledValue } from "./screenplay.ts";
import { plain, toRuns, wrapRuns, type InlineContext } from "./text.ts";
import { assignSources, CHAR, type Graphic, type Layout, type Page, type PlacedText, type Run, type SourceRange } from "./types.ts";

/**
 * Highland 2's Manuscript template on US Letter, measured from its PDFs (Sweet Betty, The Purity
 * Variations, ManuscriptEdgeCases, ExtraManuscriptMarkup). y values are baselines; a text line is
 * a 28.32 pt box (double-spaced Courier Prime 12) with its baseline 18 pt below the box top.
 */
export const MANUSCRIPT = {
  width: 612,
  height: 792,
  left: 72,
  right: 540,
  centre: 306,
  /** 65 characters from 72 to 540. */
  chars: 65,
  indent: 36,
  top: 72,
  pitch: 28.32,
  ascent: 18,
  /**
   * Lines per page: 22, and a 23rd when it is the first line of a paragraph (every page break in
   * Sweet Betty and Purity). The 24 pt after a heading does not count.
   */
  lines: 22,
  headingAfter: 24,
  /** A heading that opens the text without a title page, or a page after "===", starts 192 pt lower. */
  dropHeading: 192,
  /** "#" sits 8.2 pt below the baseline of its line. */
  sceneBreakDrop: 8.2,
  /** Highland lets quotes run 65 characters into the right margin; we wrap them at the margin. */
  quote: { x: 108, chars: 60 },
  /**
   * List text starts at 144 (markers right-aligned before it) and wraps at 468; nested items start
   * at 136.8, 151.2, … (ManuscriptProbes M). Items do not split across pages.
   */
  list: { textX: 144, nestedX: 122.4, level: 14.4, right: 468 },
  /** Term lists are single-spaced: 15.6 pt lines; terms end at 296.1, definitions start at 316. */
  terms: { height: 15.6, ascent: 10.94, termRight: 296.1, definitionX: 316 },
  /** Table rules: 0.5 pt, #BCBEC0, along the bottom of each row. */
  table: { rule: 0.5, ruleRise: 0.96, color: 0xbc / 255 },
  /** {{TOC}} entries: 40.32 pt apart, then an empty line. */
  toc: { height: 40.32 },
  highlight: { top: -18, height: 28.32, color: "#FCFF26" },
  header: { y: 43.7, left: 72, centre: 306, right: 540 },
  footer: { y: 731.7, left: 72, centre: 306, right: 540 },
  /** Fix of a Highland quirk: with a footer, text stops at the 23rd line's baseline (Highland overprints the footer). */
  lastBaseline: 90 + 22 * 28.32,
  title: { y: 83, pitch: 14.4, blank: 14, centreY: 313.4, left: 72, right: 540, centre: 306, bottomY: 716.6 },
} as const;

export interface ManuscriptOptions {
  /** Elements to print (after includes are merged); default: the document's own. */
  elements?: Element[];
  /** Where an element sits in the script being edited (included elements: their include line); default: its span. */
  sourceOf?: (e: Element) => SourceRange;
  /** For {{TIMESTAMP}}; default: now. */
  date?: Date;
  /** Print the title page (Highland's print option, on by default). */
  titlePage?: boolean;
  /** Image bytes for `![alt](src)`, e.g. from the bundle's assets; null when missing. */
  image?: (src: string) => Uint8Array | null;
  /**
   * Reproduce Highland's quirks that we otherwise fix (for comparing with its PDFs): quotes run
   * 65 characters into the margin, text may run over the footer, %pp ignores {{PAGENUMBER}}.
   */
  highlandQuirks?: boolean;
}

type PageTextDirective = Extract<Directive, { slots: PageTextSlots }>;

/** One line box of the flow. */
interface Line {
  /** The script text it was printed from. */
  range?: SourceRange;
  items: { x: number; runs: Run[] }[];
  /** Box height in points; slots used = height / pitch. */
  height: number;
  /** Baseline below the box top. */
  ascent: number;
  /** Space after the box that does not count against the page (after a heading). */
  after?: number;
  /** The first line of a paragraph: may take the page's extra line. */
  opens?: boolean;
  /** An empty paragraph: not printed at the top of a page after the first (ManuscriptProbes E). */
  empty?: boolean;
  /** This line and the next `together - 1` move as one (quote paragraphs, list items: ManuscriptProbes G, M). */
  together?: number;
  /** Must share its page with the next line (headings). */
  keepWithNext?: boolean;
  graphics?: (top: number) => Graphic[];
  /** For the TOC and %#. */
  heading?: { text: string; level: number; id: number };
  toc?: { levels: number[] | null };
}

type Unit =
  | { kind: "line"; line: Line }
  | { kind: "directives"; directives: Directive[] }
  | { kind: "pageBreak" };

interface OpenPage {
  /** Left empty by "===" after a full page. */
  blank?: boolean;
  lines: { line: Line; top: number }[];
  used: number;
  y: number;
  header: PageTextDirective | null;
  footer: PageTextDirective | null;
  sectionEnd: string;
  number: number;
}

export function layoutManuscript(doc: Document, options: ManuscriptOptions = {}): Layout {
  // Two passes: the first finds the page of each heading for {{TOC}}.
  const first = run(doc, options, new Map());
  const pagesOf = new Map<number, number>();
  for (const p of first.body) for (const { line } of p.lines) if (line.heading) pagesOf.set(line.heading.id, p.number);
  const second = run(doc, options, pagesOf);
  const pages: Page[] = [];
  if (doc.titlePage && options.titlePage !== false) {
    const title = titlePage(doc.titlePage.fields, second.ctx);
    for (const it of title.items) it.source = 0;
    pages.push(title);
  }
  pages.push(...second.pages);
  return { width: MANUSCRIPT.width, height: MANUSCRIPT.height, pages };
}

function run(doc: Document, options: ManuscriptOptions, tocPages: Map<number, number>) {
  const M = MANUSCRIPT;
  const ctx: InlineContext = { series: seriesCounter(), date: options.date ?? new Date(), links: true };
  // Empty lines before the text, beyond the first, print as empty lines (Sweet Betty and Purity start
  // with two and print one; ManuscriptStart2 starts with one and prints none).
  const leading = Math.max(0, (/^(?:[ \t]*\r?\n)*/.exec(doc.source)![0].match(/\n/g) ?? []).length - 1);
  const units: Unit[] = Array.from({ length: leading }, () => ({ kind: "line" as const, line: { items: [], height: M.pitch, ascent: M.ascent, opens: true, empty: true } }));
  units.push(...toUnits(options.elements ?? doc.elements, doc.source, ctx, { hasTitle: doc.titlePage !== null, printedBefore: leading > 0, image: options.image, sourceOf: options.sourceOf ?? ((e) => e.span), tocPages, quoteChars: options.highlandQuirks ? MANUSCRIPT.chars : MANUSCRIPT.quote.chars }));

  let header: PageTextDirective | null = null;
  let footer: PageTextDirective | null = null;
  let section = "";
  let nextNumber = 1;
  const body: OpenPage[] = [];
  let page: OpenPage | null = null;
  const newPage = (): OpenPage => {
    // Header and footer: the ones in effect at the page's end (ManuscriptProbes K).
    if (page) {
      page.header = header;
      page.footer = footer;
    }
    const p: OpenPage = { lines: [], used: 0, y: M.top, header, footer, sectionEnd: section, number: nextNumber++ };
    body.push(p);
    page = p;
    return p;
  };
  const current = (): OpenPage => page ?? newPage();
  const footerOn = () => footer !== null && !footer.off;
  const fits = (p: OpenPage, line: Line, used = p.used, y = p.y): boolean => {
    if (p.lines.length === 0) return true;
    const limit = M.lines + (line.opens ? 1 : 0);
    if (used + line.height / M.pitch > limit + 1e-6) return false;
    if (!options.highlandQuirks && footerOn() && line.items.length > 0 && y + line.ascent > M.lastBaseline + 0.5) return false;
    return true;
  };
  const place = (p: OpenPage, line: Line): void => {
    p.lines.push({ line, top: p.y });
    p.used += line.height / M.pitch;
    p.y += line.height + (line.after ?? 0);
    if (line.heading) section = line.heading.text;
    p.sectionEnd = section;
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.kind === "pageBreak") {
      const p = page as OpenPage | null;
      // "===" is a paragraph too: after a full page it spills onto an empty one (ManuscriptProbes A, P).
      if (p && p.lines.length > 0 && !fits(p, { items: [], height: M.pitch, ascent: M.ascent, opens: true })) newPage().blank = true;
      const q = page as OpenPage | null;
      if (q && (q.lines.length > 0 || q.blank)) newPage();
      continue;
    }
    if (u.kind === "directives") {
      for (const d of u.directives) {
        if (d.kind === "header") header = d;
        else if (d.kind === "footer") footer = d;
        else if (d.kind === "pageNumber" && d.value !== null) {
          // Renumbers the current page (or the next, if this one is still empty) and those after.
          const p = page as OpenPage | null;
          if (p) {
            p.number = d.value;
            nextNumber = d.value + 1;
          } else nextNumber = d.value;
        }
      }
      continue;
    }
    const line = u.line;
    let p = current();
    if (line.empty && p.lines.length === 0 && body.length > 1) continue;
    let ok = fits(p, line);
    if (ok && (line.together ?? 1) > 1 && p.lines.length > 0) {
      let used = p.used;
      let y = p.y;
      for (let k = 0; k < line.together! && ok; k++) {
        const n = units[i + k];
        if (n?.kind !== "line") break;
        ok = fits(p, n.line, used, y);
        used += n.line.height / M.pitch;
        y += n.line.height + (n.line.after ?? 0);
      }
    }
    if (ok && line.keepWithNext && p.lines.length > 0) {
      // A heading needs a normal line (not the extra one) and room for the next line after it.
      const next = units.slice(i + 1).find((n): n is Extract<Unit, { kind: "line" }> => n.kind === "line");
      const alone = { ...line, opens: false };
      ok = fits(p, alone) && (!next || fits(p, next.line, p.used + line.height / M.pitch, p.y + line.height + (line.after ?? 0)));
    }
    if (!ok) {
      p = newPage();
      if (line.empty) continue;
    }
    place(p, line);
  }
  if (page) {
    (page as OpenPage).header = header;
    (page as OpenPage).footer = footer;
  }

  const last = options.highlandQuirks ? body.length : (body.at(-1)?.number ?? 0);
  const printed: { range: SourceRange | undefined; items: PlacedText[] }[] = [];
  const pages: Page[] = body.map((p) => {
    const items: PlacedText[] = [];
    const graphics: Graphic[] = [];
    for (const { line, top } of p.lines) {
      const placed: PlacedText[] = [];
      for (const it of line.items) if (it.runs.length) placed.push({ x: it.x, y: round(top + line.ascent), runs: it.runs, highlightBox: M.highlight });
      if (placed.length) printed.push({ range: line.range, items: placed });
      items.push(...placed);
      if (line.graphics) graphics.push(...line.graphics(top));
    }
    const fill = (section: string) => (parts: PageTextPart[] | null) =>
      parts ? parts.map((t) => (t.kind === "text" ? t.text : t.kind === "page" ? String(p.number) : t.kind === "pageCount" ? String(last) : section)).join("") : "";
    if (p.header && !p.header.off) items.push(...pageText(p.header.slots, fill(p.sectionEnd), M.header));
    // Without a {{HEADER}}, pages are numbered from 2 at the top right (ManuscriptStart3).
    if (p.header === null && p.number >= 2) items.push(...pageText({ left: null, center: null, right: [{ kind: "page" }] }, fill(""), M.header));
    if (p.footer && !p.footer.off) items.push(...pageText(p.footer.slots, fill(p.sectionEnd), M.footer));
    return { number: p.number, items, ...(graphics.length ? { graphics } : {}) };
  });
  assignSources(printed);
  return { body, pages, ctx };
}

const round = (y: number) => Math.round(y * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Elements to lines

interface UnitOptions {
  hasTitle: boolean;
  /** Empty lines already opened the first page. */
  printedBefore: boolean;
  image: ((src: string) => Uint8Array | null) | undefined;
  sourceOf: (e: Element) => SourceRange;
  tocPages: Map<number, number>;
  quoteChars: number;
}

function toUnits(elements: Element[], source: string, ctx: InlineContext, o: UnitOptions): Unit[] {
  const M = MANUSCRIPT;
  const out: Unit[] = [];
  const text = (items: Line["items"], extra: Partial<Line> = {}): Line => ({ items, height: M.pitch, ascent: M.ascent, ...extra });
  const empty = (): Line => text([], { opens: true, empty: true });
  const push = (line: Line) => out.push({ kind: "line", line });
  let printed = o.printedBefore;
  /** The next element opens a page after "===". */
  let afterBreak = false;
  /** The last printed element was a paragraph: the next one is indented. */
  let afterParagraph = false;
  let headingId = 0;
  const headings: { text: string; level: number; id: number }[] = [];

  // Headings first, for the TOC.
  {
    const c: InlineContext = { ...ctx, series: seriesCounter() };
    let id = 0;
    for (const e of elements) if (e.kind === "heading") headings.push({ text: plain(toRuns(e.inline, c)).trim(), level: e.level, id: id++ });
  }

  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]!;
    // Each extra empty source line is an empty paragraph (Sweet Betty's lyrics, Purity's chapters);
    // the blank lines after the title page are not.
    if (printed && e.kind !== "directiveLine") for (let k = extraBlankLines(source, e.span.start); k > 0; k--) push(empty());
    const before = out.length;
    switch (e.kind) {
      case "paragraph": {
        const runs = toRuns(e.inline, ctx);
        if (plain(runs).trim() === "") break; // only a note
        const x = afterParagraph ? M.left + M.indent : M.left;
        const lines = wrapRuns(runs, afterParagraph ? M.chars - M.indent / CHAR : M.chars, M.chars);
        lines.forEach((r, k) => push(text([{ x: k === 0 ? x : M.left, runs: r }], k === 0 ? { opens: true } : {})));
        printed = true;
        afterParagraph = true;
        break;
      }
      case "heading": {
        const runs = toRuns(e.inline, ctx);
        const lines = wrapRuns(runs, M.chars);
        // A heading that opens the text (without a title page) or a page after "===" starts lower
        // (ExtraManuscriptMarkup, ManuscriptProbes L).
        if ((!printed && !o.hasTitle) || afterBreak) push({ items: [], height: M.dropHeading, ascent: 0 });
        const h = headings[headingId++]!;
        lines.forEach((r, k) => {
          const len = plain(r).length * CHAR;
          const lastLine = k === lines.length - 1;
          push(text([{ x: M.centre - len / 2, runs: r }], { keepWithNext: true, ...(k === 0 ? { heading: h } : {}), ...(lastLine ? { after: M.headingAfter } : {}) }));
        });
        printed = true;
        afterParagraph = false;
        break;
      }
      case "sceneBreak":
        push({ items: [{ x: M.centre - CHAR / 2, runs: [{ text: "#", style: {} }] }], height: M.pitch, ascent: M.ascent + M.sceneBreakDrop });
        printed = true;
        afterParagraph = false;
        break;
      case "blockQuote":
        e.paragraphs.forEach((para, k) => {
          if (k > 0) push(empty());
          const lines = wrapRuns(toRuns(para.inline, ctx, { italic: true }), o.quoteChars);
          // A quote paragraph neither takes the extra line nor splits (ManuscriptProbes C, G).
          lines.forEach((r, j) => push(text([{ x: M.quote.x, runs: r }], j === 0 ? { together: lines.length } : {})));
        });
        printed = true;
        afterParagraph = false;
        break;
      case "rightAligned":
      case "centered": {
        for (const r of wrapRuns(toRuns(e.inline, ctx), M.chars)) {
          const len = plain(r).length * CHAR;
          push(text([{ x: e.kind === "centered" ? M.centre - len / 2 : M.right - len, runs: r }]));
        }
        printed = true;
        afterParagraph = false;
        break;
      }
      case "list":
        for (const item of e.items) {
          const textX = item.level === 0 ? M.list.textX : M.list.nestedX + item.level * M.list.level;
          const marker = item.ordered ? item.marker : item.marker === "-" ? "-" : "•";
          const lines = wrapRuns(toRuns(item.inline, ctx), Math.floor((M.list.right - textX) / CHAR + 1e-6));
          lines.forEach((r, k) => {
            const items: Line["items"] = [{ x: textX, runs: r }];
            if (k === 0) items.unshift({ x: textX - (marker.length + 1) * CHAR, runs: [{ text: marker, style: {} }] });
            push(text(items, k === 0 ? { together: lines.length } : {}));
          });
        }
        printed = true;
        afterParagraph = false;
        break;
      case "termList": {
        const T = M.terms;
        for (const item of e.items) {
          const term = toRuns(item.termInline, ctx);
          const defs = wrapRuns(toRuns(item.definitionInline, ctx), Math.floor((M.right - T.definitionX) / CHAR));
          const termLines = wrapRuns(term, Math.floor((T.termRight - M.left) / CHAR));
          const n = Math.max(defs.length, termLines.length);
          for (let k = 0; k < n; k++) {
            const items: Line["items"] = [];
            const t = termLines[k];
            if (t) items.push({ x: T.termRight - plain(t).length * CHAR, runs: t });
            if (defs[k]) items.push({ x: T.definitionX, runs: defs[k]! });
            push({ items, height: T.height, ascent: T.ascent });
          }
        }
        printed = true;
        afterParagraph = false;
        break;
      }
      case "table": {
        const cols = Math.max(e.header.length, ...e.rows.map((r) => r.length), 1);
        const w = (M.right - M.left) / cols;
        const width = Math.floor(w / CHAR);
        const T = M.table;
        const rule = (top: number): Graphic[] => [{ kind: "rect", x: M.left, y: top + M.pitch - T.ruleRise, width: M.right - M.left, height: T.rule, gray: T.color }];
        const row = (cells: { inline: Parameters<typeof toRuns>[0] }[], head: boolean) => {
          const wrapped = cells.map((c) => wrapRuns(toRuns(c.inline, ctx, head ? { bold: true } : {}), width));
          const n = Math.max(1, ...wrapped.map((l) => l.length));
          for (let k = 0; k < n; k++) {
            const items: Line["items"] = [];
            wrapped.forEach((ls, c) => {
              const r = ls[k];
              if (!r) return;
              const len = plain(r).length * CHAR;
              const start = M.left + c * w;
              // Header cells centred, the rest left-aligned (Highland ignores alignment colons).
              const x = head ? start + (w - len) / 2 : start;
              items.push({ x, runs: r });
            });
            push(text(items, k === n - 1 ? { graphics: rule } : {}));
          }
        };
        // Highland reads only a separator of dashes: with colons for alignment, the table has no
        // header and the separator prints as a row (ManuscriptProbes N).
        const aligned = e.align.some((a) => a !== null);
        if (!aligned) row(e.header, true);
        else {
          row(e.header, false);
          const sep = e.lines[1];
          const cells = sep ? source.slice(sep.content.start, sep.content.end).trim().replace(/^\|/, "").replace(/\|$/, "").split("|") : [];
          row(cells.map((c) => ({ inline: [{ kind: "text" as const, text: c.trim(), span: { start: 0, end: 0 } }] })), false);
        }
        for (const r of e.rows) row(r, false);
        printed = true;
        afterParagraph = false;
        break;
      }
      case "pageBreak":
        out.push({ kind: "pageBreak" });
        afterParagraph = false; // the next page opens unindented (ManuscriptEdgeCases)
        afterBreak = true;
        continue;
      case "directiveLine": {
        const directives = e.directives.map((d) => d.directive);
        out.push({ kind: "directives", directives });
        const toc = directives.find((d): d is Extract<Directive, { kind: "toc" }> => d.kind === "toc");
        if (toc) {
          for (const h of headings) {
            if (toc.levels && !toc.levels.includes(h.level)) continue;
            const n = String(o.tocPages.get(h.id) ?? "");
            const title = wrapRuns([{ text: h.text, style: {} }], M.chars - n.length - 1)[0] ?? [];
            push({ items: [{ x: M.left, runs: title }, { x: M.right - n.length * CHAR, runs: [{ text: n, style: {} }] }], height: M.toc.height, ascent: M.ascent });
          }
          push(empty());
          printed = true;
          afterParagraph = false;
          break;
        }
        // Directive lines take no space (ManuscriptProbes K, ManuscriptStart1 and 2).
        break;
      }
      case "lyric":
      case "action": {
        // Not produced in Markdown mode; print as plain paragraphs if they appear.
        const runs = toRuns(e.inline, ctx);
        for (const r of wrapRuns(runs, M.chars)) push(text([{ x: M.left, runs: r }]));
        printed = true;
        break;
      }
      default:
        break; // notes, synopses, link definitions: not printed
    }
    if (out.slice(before).some((u) => u.kind === "line")) afterBreak = false;
    const range = o.sourceOf(e);
    for (const u of out.slice(before)) if (u.kind === "line") u.line.range = range;
    // Images: a paragraph holding only an image prints the image, centred, 1 pt per pixel.
    if (e.kind === "paragraph") {
      const img = e.inline.length === 1 && e.inline[0]!.kind === "image" ? e.inline[0] : null;
      if (img && img.kind === "image") {
        const data = o.image?.(img.src) ?? null;
        const size = data ? imageSize(data) : null;
        if (data && size) {
          const scale = Math.min(1, (M.right - M.left) / size.width, (M.lastBaseline - M.top) / size.height);
          const width = size.width * scale;
          const height = size.height * scale;
          push({ items: [], height, ascent: 0, graphics: (top) => [{ kind: "image", x: M.centre - width / 2, y: top, width, height, data }] });
          printed = true;
          afterParagraph = false;
        }
      }
    }
  }
  return out;
}

/** Pixel size of a PNG or JPEG. */
export function imageSize(data: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length > 24 && data[0] === 0x89 && data[1] === 0x50) return { width: v.getUint32(16), height: v.getUint32(20) };
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1]!;
      const len = v.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Title page: TL top left, TR top right, CC centred, BL / BR bottom corners.

function titlePage(fields: TitleField[], ctx: InlineContext): Page {
  const T = MANUSCRIPT.title;
  const items: PlacedText[] = [];
  const get = (name: string) => fields.find((f) => f.name === name);
  const lines = (f: TitleField | undefined): Run[][] => (f ? f.values.flatMap((v) => (v.text.trim() === "" ? [[]] : wrapRuns(styledValue(v.text, { ...ctx, links: false }), MANUSCRIPT.chars))) : []);
  const trim = (ls: Run[][]) => {
    let a = 0;
    let b = ls.length;
    while (a < b && ls[a]!.length === 0) a++;
    while (b > a && ls[b - 1]!.length === 0) b--;
    return ls.slice(a, b);
  };
  /** Places lines downwards from y; empty lines are 14 pt, others 14.4. */
  const column = (ls: Run[][], y: number, x: (len: number) => number) => {
    ls.forEach((runs, k) => {
      if (k > 0) y += ls[k - 1]!.length === 0 ? T.blank : T.pitch;
      if (runs.length) items.push({ x: x(plain(runs).length * CHAR), y, runs });
    });
  };
  const height = (ls: Run[][]) => ls.slice(0, -1).reduce((h, r) => h + (r.length === 0 ? T.blank : T.pitch), 0);
  const any = (...names: string[]) => names.flatMap((n) => trim(lines(get(n))));
  // Screenplay-style keys land in the same places: Contact top left, Title / Credit / Author /
  // Source centred three lines apart, Draft date bottom right (ManuscriptTitle3).
  column(any("tl", "contact", "contact info"), T.y, () => T.left);
  column(any("tr"), T.y, (len) => T.right - len);
  const cc = trim(lines(get("cc")));
  if (cc.length) column(cc, T.centreY, (len) => T.centre - len / 2);
  else {
    let y = T.centreY;
    for (const name of ["title", "credit", "author", "authors", "source"]) {
      const ls = trim(lines(get(name)));
      if (!ls.length) continue;
      column(ls, y, (len) => T.centre - len / 2);
      y += height(ls) + 3 * T.pitch;
    }
  }
  const bl = any("bl", "notes", "copyright");
  const br = any("br", "draft date", "date", "revision");
  column(bl, T.bottomY - height(bl), () => T.left);
  column(br, T.bottomY - height(br), (len) => T.right - len);
  return { number: null, items };
}
