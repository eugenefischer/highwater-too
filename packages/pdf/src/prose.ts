import { seriesCounter, type Directive, type Document, type Element, type PageTextPart, type PageTextSlots, type TitleField } from "@highwater/parser";
import { Measurer, resolveFonts, variantOf, type ResolvedFonts } from "./fonts.ts";
import { imageSize } from "./manuscript.ts";
import { extraBlankLines, sameParagraph, styledValue } from "./screenplay.ts";
import { addPrintMarks } from "./marks.ts";
import { onlyNotes, plain, printContext, sliceRuns, SYNOPSIS_COLOR, toRuns, trimStartRuns, type InlineContext } from "./text.ts";
import type { ProseTemplate, TextSpec } from "./prose-templates.ts";
import { assignSources, type Graphic, type Layout, type Page, type PlacedText, type PrintMarks, type Run, type SourceRange } from "./types.ts";

/**
 * Highland 2's prose templates (M10): Novel, Treatment, Modern Standard, Article, Bulletin, Speech,
 * MLA Report and Wiki, measured from its PDFs of the template probes. A close match (EJ's choice,
 * 2026-10-19): the same fonts, sizes, margins, spacing and styles, but Highland lays these out
 * with Apple's text system, so line and page breaks may differ.
 *
 * Every element becomes line boxes stacked down the page: a box has a height and its baseline's
 * distance below its top. A line fits when its box ends above the bottom margin, or when it opens
 * a paragraph and starts above it (the Manuscript rule, seen in every template).
 */
export interface ProseOptions {
  /** Elements to print (after includes are merged); default: the document's own. */
  elements?: Element[];
  sourceOf?: (e: Element) => SourceRange;
  date?: Date;
  titlePage?: boolean;
  image?: (src: string) => Uint8Array | null;
  /** Font files: the bundled fonts' folder, and folders to look in for the others (default: the system's). */
  fontDir: string;
  fontDirs?: string[];
  /** Reproduce Highland's quirks that we otherwise fix (for comparing with its PDFs): quotes keep the full measure and run into the right margin. */
  highlandQuirks?: boolean;
  /** Highland's print options other than the title page (measured in the Manuscript; the same here). */
  print?: PrintMarks;
  /** The template's fonts (Highland's template options): headings, and everything else. */
  fonts?: { headers?: string; body?: string };
}

type PageTextDirective = Extract<Directive, { slots: PageTextSlots }>;

interface Item {
  x: number;
  runs: Run[];
  justify?: number;
}

interface Line {
  range?: SourceRange;
  items: Item[];
  height: number;
  ascent: number;
  /** Opens a paragraph: may start in the last line's space. */
  opens?: boolean;
  /** An empty line: dropped at the top of a page and where it does not fit. */
  empty?: boolean;
  keepWithNext?: boolean;
  /** This line and the next `together - 1` move as one (quote paragraphs, table rows). */
  together?: number;
  graphics?: (top: number) => Graphic[];
  heading?: { text: string; level: number; id: number };
  /** Highlight box for this line's runs, relative to the baseline. */
  highlight?: { top: number; height: number };
}

type Unit = { kind: "line"; line: Line } | { kind: "directives"; directives: Directive[] } | { kind: "pageBreak" };

interface OpenPage {
  /** Left empty by "===" after a full page. */
  blank?: boolean;
  lines: { line: Line; top: number }[];
  y: number;
  header: PageTextDirective | null;
  footer: PageTextDirective | null;
  /** The top-level heading in effect at the page's end (%#). */
  section: string;
  number: number;
}

export interface ProseLayout extends Layout {
  /** Template fonts not installed, with the font printed instead. */
  substituted: Record<string, string>;
}

export function layoutProse(doc: Document, chosen: ProseTemplate, options: ProseOptions): ProseLayout {
  const template = withFonts(chosen, options);
  const fonts = resolveFonts(familiesOf(template), options.fontDir, options.fontDirs);
  const m = new Measurer(fonts.faces);
  const first = run(doc, template, options, m, new Map());
  const pagesOf = new Map<number, number>();
  for (const p of first.body) for (const { line } of p.lines) if (line.heading) pagesOf.set(line.heading.id, p.number);
  const second = run(doc, template, options, m, pagesOf);
  const pages: Page[] = [];
  if (doc.titlePage && options.titlePage !== false && template.title.kind === "page") pages.push(titlePage(doc.titlePage.fields, template, second.ctx, m));
  pages.push(...second.pages);
  const layout = { width: 612, height: 792, pages, fonts: fonts.faces, substituted: fonts.substituted };
  addPrintMarks(layout, template.noPrintOptions ? undefined : options.print, template.body.pitch, template.numberRise);
  return layout;
}

/**
 * The template with Highland's font options (the <Name>Probe-<Font> exports): Headers sets the
 * headings, Body the rest (in templates with only Body, the headings too); text the template keeps
 * in its own font (Bulletin's quotes and running heads) names it. A font with a line gap (Times New
 * Roman's) makes lines that much taller (NovelProbe-TimesNewRoman: 21.35 pt, not 20.8).
 */
function withFonts(t: ProseTemplate, options: ProseOptions): ProseTemplate {
  const { headers, body } = options.fonts ?? {};
  if (!headers && !body) return t;
  const metrics = (font: string) => new Measurer(resolveFonts([font], options.fontDir, options.fontDirs).faces).metrics(font);
  // Baselines move by half the change in ascender + descender, rounded (NovelProbe-Schola: +4 at 24 pt, +2 at 13).
  const shift = (from: string, to: string, size: number) => {
    const a = metrics(from);
    const b = metrics(to);
    return Math.round((((b.ascender + b.descender) - (a.ascender + a.descender)) * size) / 2000);
  };
  const gap = (font: string, size: number) => (metrics(font).lineGap * size) / 1000;
  const out: ProseTemplate = { ...t, body: { ...t.body }, headings: t.headings.map((h) => ({ ...h })) as ProseTemplate["headings"] };
  if (body && body !== t.body.font) {
    const extra = gap(body, t.body.size) - gap(t.body.font, t.body.size);
    for (const h of out.headings) if (h.height === t.body.pitch) h.height += extra;
    const down = shift(t.body.font, body, t.body.size);
    out.body = { ...out.body, font: body, pitch: t.body.pitch + extra, ascent: t.body.ascent + down, leading: extra };
    // Paragraph numbers keep their place in the line.
    out.numberRise = (t.numberRise ?? 3) + down;
    if (t.header.font === undefined) out.header = { ...t.header, y: t.header.y + shift(t.body.font, body, t.header.size) };
    if (t.footer.font === undefined) out.footer = { ...t.footer, y: t.footer.y + shift(t.body.font, body, t.footer.size) };
    if (t.title.kind === "page") {
      const T = t.title;
      const from = T.font ?? t.body.font;
      out.title = { ...T, ys: T.ys.map((y, k) => y + shift(from, body, k === 0 ? (T.titleSize ?? T.size) : T.size)) as typeof T.ys, bottom: T.bottom + shift(from, body, T.size) };
    }
  }
  t.headings.forEach((h, k) => {
    const from = h.font ?? t.body.font;
    const to = headers ?? (h.font === undefined ? body : undefined);
    if (!to || to === from) return;
    out.headings[k] = { ...out.headings[k]!, font: to, ascent: h.ascent + shift(from, to, h.size) };
  });
  return out;
}

function familiesOf(t: ProseTemplate): string[] {
  return [t.body.font, ...t.headings.map((h) => h.font ?? t.body.font), t.header.font ?? t.body.font, t.footer.font ?? t.body.font, t.quote.font ?? t.body.font, (t.title.kind === "page" ? t.title.font : undefined) ?? t.body.font];
}

// ---------------------------------------------------------------------------------------------

function run(doc: Document, T: ProseTemplate, options: ProseOptions, m: Measurer, tocPages: Map<number, number>) {
  const print = printContext(doc, T.noPrintOptions ? undefined : options.print);
  const ctx: InlineContext = { series: seriesCounter(), date: options.date ?? new Date(), links: true, ...(print ? { print } : {}) };
  const units = toUnits(options.elements ?? doc.elements, doc, T, ctx, m, { image: options.image, sourceOf: options.sourceOf ?? ((e) => e.span), tocPages, titleFields: doc.titlePage?.fields ?? [], quirks: !!options.highlandQuirks });

  let header: PageTextDirective | null = null;
  let footer: PageTextDirective | null = null;
  let section = "";
  let nextNumber = 1;
  const body: OpenPage[] = [];
  let page: OpenPage | null = null;
  const newPage = (): OpenPage => {
    if (page) {
      page.footer = footer;
      page.section = section;
    }
    const p: OpenPage = { lines: [], y: T.top, header, footer, section, number: nextNumber++ };
    body.push(p);
    page = p;
    return p;
  };
  const current = (): OpenPage => page ?? newPage();
  const fits = (p: OpenPage, line: Line, y = p.y): boolean => {
    if (p.lines.length === 0) return true;
    if (y + line.height <= T.bottom + 0.01) return true;
    return !!line.opens && y < T.bottom - 0.01;
  };
  const place = (p: OpenPage, line: Line): void => {
    p.lines.push({ line, top: p.y });
    p.y += line.height;
    if (line.heading && line.heading.level === 1) section = line.heading.text;
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.kind === "pageBreak") {
      // "===" is a paragraph too: after a full page it spills onto an empty one, as in the Manuscript.
      // In templates that print the empty lines between paragraphs, the one before it counts
      // (SpeechProbe p. 25: a paragraph ending 20 pt above the bottom margin).
      const p = page as OpenPage | null;
      const opener: Line = { items: [], height: T.body.pitch, ascent: T.body.ascent, opens: true };
      if (p && p.lines.some((l) => !l.line.empty) && !fits(p, opener, p.y + (T.blankLines ? T.body.pitch : 0))) newPage().blank = true;
      const q = page as OpenPage | null;
      if (q && (q.lines.some((l) => !l.line.empty) || q.blank)) newPage();
      continue;
    }
    if (u.kind === "directives") {
      for (const d of u.directives) {
        if (d.kind === "header") {
          header = d;
          // A header set before anything printed on the page applies to it.
          const p = page as OpenPage | null;
          if (p && !p.lines.some((l) => !l.line.empty)) p.header = d;
        } else if (d.kind === "footer") footer = d;
        else if (d.kind === "pageNumber" && d.value !== null) {
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
    // An empty line opening the text is dropped; one that spills over a page break prints at
    // the top of the next page (BulletinProbe C).
    if (line.empty && body.length === 1 && !p.lines.some((l) => !l.line.empty)) continue;
    let ok = fits(p, line);
    if (ok && (line.together ?? 1) > 1 && p.lines.length > 0) {
      // A quote paragraph or a table row moves whole (NovelProbe, MLAReportProbe).
      let y = p.y;
      for (let k = 0; k < line.together! && ok; k++) {
        const n = units[i + k];
        if (n?.kind !== "line") break;
        ok = fits(p, n.line, y);
        y += n.line.height;
      }
    }
    if (ok && line.keepWithNext && p.lines.length > 0) {
      const next = units.slice(i + 1).find((n): n is Extract<Unit, { kind: "line" }> => n.kind === "line" && !n.line.empty);
      ok = !next || fits(p, next.line, p.y + line.height);
    }
    if (!ok) p = newPage();
    place(p, line);
  }
  if (page) {
    (page as OpenPage).footer = footer;
    (page as OpenPage).section = section;
  }

  const last = body.at(-1)?.number ?? 0;
  const printed: { range: SourceRange | undefined; items: PlacedText[] }[] = [];
  const titleText = (doc.titlePage?.fields.find((f) => f.name === "title")?.values.map((v) => v.text.trim()).filter(Boolean).join(" ") ?? "").replace(/[*_]/g, "");
  const pages: Page[] = body.map((p, index) => {
    const items: PlacedText[] = [];
    const graphics: Graphic[] = [];
    // A paragraph that starts on the page's last line and goes on over the page gets no number
    // (ManuscriptPrintProbe-numbers; SpeechProbe- and ArticleProbe-Default; one ending there does),
    // nor does a line in the page's extra space below the margin (BulletinProbe-Default).
    const printedLine = (q: OpenPage | undefined, fromEnd: boolean) => (fromEnd ? [...(q?.lines ?? [])].reverse() : (q?.lines ?? [])).find(({ line }) => line.items.some((it) => it.runs.length))?.line;
    const tail = printedLine(p, true);
    const overleaf = printedLine(body[index + 1], false);
    const lastLine = tail?.range && overleaf?.range === tail.range ? tail : undefined;
    for (const { line, top } of p.lines) {
      const placed: PlacedText[] = [];
      for (const it of line.items) {
        if (!it.runs.length) continue;
        const box = line.highlight ?? { top: -line.ascent, height: line.height };
        placed.push({ x: it.x, y: round(top + line.ascent), runs: it.runs, highlightBox: { ...box, color: "#FCFF26" }, ...(it.justify !== undefined ? { justify: it.justify } : {}), ...(line === lastLine || top + line.height > T.bottom + 0.01 ? { unnumbered: true } : {}) });
      }
      if (placed.length) printed.push({ range: line.range, items: placed });
      items.push(...placed);
      if (line.graphics) graphics.push(...line.graphics(top));
    }
    const fill = (parts: PageTextPart[] | null) => (parts ? parts.map((t) => (t.kind === "text" ? t.text : t.kind === "page" ? String(p.number) : t.kind === "pageCount" ? String(last) : p.section)).join("") : "");
    const H = T.header;
    const F = T.footer;
    const hSpec: TextSpec = { font: H.font ?? T.body.font, size: H.size, bold: H.bold };
    const fSpec: TextSpec = { font: F.font ?? T.body.font, size: F.size, bold: F.bold };
    if (p.header && !p.header.off) items.push(...pageText(p.header.slots, fill, H.y, T, hSpec, m, H.caps));
    else if (p.header === null && index > 0) {
      // Without a {{HEADER}}, from the second page: the template's page number (and Novel's title).
      const n = T.pageNumber.format.replace("N", String(p.number));
      if (T.pageNumber.where === "header") {
        items.push(...pageText({ left: null, center: T.pageNumber.title && titleText ? [{ kind: "text", text: titleText }] : null, right: [{ kind: "text", text: n }] }, fill, H.y, T, hSpec, m, T.pageNumber.title));
      }
      if (T.pageNumber.where === "footer" && !(p.footer && !p.footer.off)) items.push(...pageText({ left: null, center: [{ kind: "text", text: n }], right: null }, fill, F.y, T, fSpec, m, false));
    }
    if (p.footer && !p.footer.off) items.push(...pageText(p.footer.slots, fill, F.y, T, fSpec, m, false));
    return { number: p.number, items, ...(graphics.length ? { graphics } : {}) };
  });
  assignSources(printed, doc.source);
  return { body, pages, ctx };
}

const round = (y: number) => Math.round(y * 100) / 100;

/** Header or footer parts: left at the margin, centre centred, right ending at the margin. */
function pageText(slots: PageTextSlots, fill: (p: PageTextPart[] | null) => string, y: number, T: ProseTemplate, spec: TextSpec, m: Measurer, caps: boolean | undefined): PlacedText[] {
  const out: PlacedText[] = [];
  const add = (text: string, align: "left" | "centre" | "right") => {
    if (!text.trim()) return;
    const t = caps ? text.toUpperCase() : text;
    const runs = dress([{ text: t, style: {} }], spec);
    const w = m.runs(runs, spec);
    const x = align === "left" ? T.left : align === "right" ? T.right - w : (T.left + T.right) / 2 - w / 2;
    out.push({ x, y, runs });
  };
  add(fill(slots.left), "left");
  add(fill(slots.center), "centre");
  add(fill(slots.right), "right");
  return out;
}

/** Runs in a spec's font, size and colour (bold and italic added to the runs' own). */
export function dress(runs: Run[], spec: TextSpec): Run[] {
  return runs.map((r) => ({
    text: r.text,
    style: { ...r.style, font: spec.font, size: spec.size, ...(spec.bold ? { bold: true } : {}), ...(spec.italic ? { italic: true } : {}), ...(spec.color && !r.style.link && !r.style.color ? { color: spec.color } : {}) },
  }));
}

/**
 * Small capitals (Novel's first line after a heading): capitals stay, everything else is set at
 * 80 % size, lowercase letters as capitals (NovelProbe: "A: THE FIRST…", its full stops small too).
 */
function smallCaps(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    for (const part of r.text.match(/\p{Lu}+|[^\p{Lu}]+/gu) ?? []) {
      const capital = /\p{Lu}/u.test(part);
      out.push({ text: capital ? part : part.toUpperCase(), style: capital ? r.style : { ...r.style, size: (r.style.size ?? 12) * 0.8 } });
    }
  }
  return out;
}

/**
 * Greedy line breaking by measured width: at spaces (the space before the break hangs) and after
 * hyphens; a word longer than the line breaks where it must.
 */
export function wrapMeasured(runs: Run[], first: number, rest: number, width: (runs: Run[]) => number): Run[][] {
  const text = plain(runs);
  const lines: Run[][] = [];
  let start = 0;
  while (start < text.length) {
    const max = lines.length === 0 ? first : rest;
    const fitsTo = (end: number) => width(sliceRuns(runs, start, end)) <= max + 0.01;
    if (fitsTo(text.length) || text.slice(start).trim() === "") {
      lines.push(sliceRuns(runs, start));
      break;
    }
    // Break opportunities: after a run of spaces, or after a hyphen inside a word.
    let best = -1;
    for (let i = start + 1; i < text.length; i++) {
      const isSpace = text[i] === " ";
      const afterHyphen = (text[i - 1] === "-" || text[i - 1] === "—") && text[i] !== " " && text[i - 1] !== " ";
      if (!isSpace && !afterHyphen) continue;
      if (!fitsTo(i)) break;
      best = i;
    }
    let end: number;
    if (best > start) end = best;
    else {
      // The first word alone is too long: as many characters as fit.
      end = start + 1;
      while (end < text.length && text[end] !== " " && fitsTo(end + 1)) end++;
    }
    lines.push(sliceRuns(runs, start, end));
    start = end;
    while (text[start] === " ") start++;
  }
  return lines.length ? lines : [[]];
}

// ---------------------------------------------------------------------------------------------
// Elements to lines

interface UnitOptions {
  image: ((src: string) => Uint8Array | null) | undefined;
  sourceOf: (e: Element) => SourceRange;
  tocPages: Map<number, number>;
  titleFields: TitleField[];
  quirks: boolean;
}

function toUnits(elements: Element[], doc: Document, T: ProseTemplate, ctx: InlineContext, m: Measurer, o: UnitOptions): Unit[] {
  const B = T.body;
  const source = doc.source;
  const out: Unit[] = [];
  const width = (spec: TextSpec) => (runs: Run[]) => m.runs(runs, spec);
  const bodyLine = (items: Item[], extra: Partial<Line> = {}): Line => ({ items, height: B.pitch, ascent: B.ascent, ...extra });
  // An empty line is an empty paragraph: it may take the last line's space (SpeechProbe C).
  const empty = (): Line => bodyLine([], { empty: true, opens: true });
  const push = (line: Line) => out.push({ kind: "line", line });
  const measure = (runs: Run[], spec: TextSpec) => m.runs(runs, spec);
  let printed = false;
  let afterParagraph = false;
  let afterHeading = false;
  let headingId = 0;
  const headings: { text: string; level: number; id: number }[] = [];
  {
    const c: InlineContext = { ...ctx, series: seriesCounter() };
    let id = 0;
    for (const e of elements) if (e.kind === "heading") headings.push({ text: plain(toRuns(e.inline, c)).trim(), level: e.level, id: id++ });
  }

  // MLA Report: no title page; its heading block opens the first page.
  if (T.title.kind === "mla" && o.titleFields.length) {
    const field = (...names: string[]) => names.map((n) => o.titleFields.find((f) => f.name === n)).find(Boolean)?.values.map((v) => v.text.trim()).filter(Boolean).join(" ") ?? "";
    const date = field("date", "draft date");
    const author = field("author", "authors");
    const title = field("title");
    const items: Item[] = [];
    if (date) items.push({ x: T.left, runs: dress(styledValue(date, { ...ctx, links: false }), B) });
    if (author) {
      const r = dress(styledValue(author, { ...ctx, links: false }), B);
      items.push({ x: T.right - measure(r, B), runs: r });
    }
    if (items.length) push(bodyLine(items, { opens: true }));
    if (title) {
      push(empty());
      const r = dress(styledValue(title, { ...ctx, links: false }), B);
      push(bodyLine([{ x: (T.left + T.right) / 2 - measure(r, B) / 2, runs: r }], { opens: true }));
      push(empty());
    }
    printed = items.length > 0 || !!title;
  }

  /** A paragraph of body text from x (first line) and `left` (the rest), wrapping at `right`. */
  const paragraph = (runs: Run[], spec: TextSpec, firstX: number, left: number, right: number, opts: { justify?: boolean | undefined; smallCaps?: boolean | undefined } = {}): Line[] => {
    const styled = dress(runs, spec);
    let lines: Run[][];
    if (opts.smallCaps) {
      const sc = smallCaps(styled);
      const head = wrapMeasured(sc, right - firstX, right - left, width(spec))[0] ?? [];
      const n = plain(head).length;
      const restRuns = trimStartRuns(sliceRuns(styled, n));
      lines = [head, ...(plain(restRuns).trim() ? wrapMeasured(restRuns, right - left, right - left, width(spec)) : [])];
    } else lines = wrapMeasured(styled, right - firstX, right - left, width(spec));
    return lines.map((r, k) => {
      const x = k === 0 ? firstX : left;
      const lastLine = k === lines.length - 1;
      const item: Item = { x, runs: r, ...(opts.justify && !lastLine ? { justify: right - x } : {}) };
      return bodyLine([item], k === 0 ? { opens: true } : {});
    });
  };

  let prev: Element | null = null;
  /** Printed notes on lines of their own: they open the next paragraph (as in ManuscriptPrintProbe-notes). */
  let notes: Run[] = [];
  /**
   * Printed notes on lines of their own with no paragraph after them: a line of their own at the
   * margin, after the empty line between blocks, with the next block straight after them
   * (MS, Bulletin, Speech, Wiki, Novel: NovelProbe-Default etc.). Returns whether any were printed.
   */
  const flushNotes = (gap: number): boolean => {
    if (!notes.length) return false;
    for (let k = 0; k < gap; k++) push(empty());
    const caps = !!T.smallCapsAfterHeading && afterHeading;
    for (const line of paragraph(notes, B, T.left, T.left, T.right, { smallCaps: caps })) push(line);
    notes = [];
    return true;
  };
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]!;
    if (ctx.print) ctx.print.own = o.sourceOf(e) === e.span;
    // The empty source lines between blocks print as empty lines, in templates that keep them;
    // added below once the element prints something (a link definition takes its blank line with
    // it: BulletinProbe).
    let gap = printed && prev && e.kind !== "directiveLine" && e.kind !== "pageBreak" && T.blankLines ? (sameParagraph(source, prev, e) ? 0 : 1 + extraBlankLines(source, e.span.start)) : 0;
    if (e.kind !== "paragraph" && flushNotes(gap)) gap = 0;
    const before = out.length;
    switch (e.kind) {
      case "paragraph": {
        if (ctx.print?.marks.notes && onlyNotes(e.inline)) {
          notes.push(...toRuns(e.inline, ctx));
          break;
        }
        const runs = [...notes, ...toRuns(e.inline, ctx)];
        notes = [];
        const img = e.inline.length === 1 && e.inline[0]!.kind === "image" ? e.inline[0] : null;
        if (img && img.kind === "image") {
          const data = o.image?.(img.src) ?? null;
          const size = data ? imageSize(data) : null;
          if (data && size) {
            const scale = Math.min(1, (T.right - T.left) / size.width, (T.bottom - T.top) / size.height);
            const w = size.width * scale;
            const h = size.height * scale;
            const centre = (T.left + T.right) / 2;
            push({ items: [], height: h, ascent: 0, opens: true, graphics: (top) => [{ kind: "image", x: centre - w / 2, y: top, width: w, height: h, data }] });
            printed = true;
            afterParagraph = false;
            afterHeading = false;
          }
          break;
        }
        // Only a note: not printed, but an empty paragraph to Highland (BulletinProbe, NovelProbe).
        if (plain(runs).trim() === "") {
          if (printed) push(empty());
          break;
        }
        const indent = T.indent.rule === "all" || (T.indent.rule === "afterParagraph" && afterParagraph) ? T.indent.first : 0;
        const caps = !!T.smallCapsAfterHeading && afterHeading;
        for (const line of paragraph(runs, B, T.left + indent, T.left, T.right, { justify: B.justify, smallCaps: caps })) push(line);
        printed = true;
        afterParagraph = true;
        afterHeading = false;
        break;
      }
      case "heading": {
        const H = T.headings[Math.min(e.level, 6) - 1]!;
        const spec: TextSpec = { font: H.font ?? B.font, size: H.size, bold: H.bold, italic: H.italic, color: H.color };
        const h = headings[headingId++]!;
        const runs = toRuns(e.inline, ctx);
        const lines = wrapMeasured(dress(runs, spec), T.right - T.left, T.right - T.left, width(spec));
        lines.forEach((r, k) => {
          const w = measure(r, spec);
          const x = H.align === "centre" ? (T.left + T.right) / 2 - w / 2 : T.left;
          const lastLine = k === lines.length - 1;
          // Wrapped heading lines: one size-proportional line each; the box's own spacing on the last.
          const height = lastLine ? H.height : H.size * 1.25;
          push({ items: [{ x, runs: r }], height, ascent: k === 0 ? H.ascent : H.size, keepWithNext: true, opens: true, ...(k === 0 ? { heading: h } : {}) });
        });
        printed = true;
        afterParagraph = false;
        afterHeading = true;
        break;
      }
      case "sceneBreak": {
        const S = T.sceneBreak;
        const centre = (T.left + T.right) / 2;
        if (S.kind === "asterism") {
          const star = dress([{ text: "*", style: {} }], B);
          const w = measure(star, B);
          // Never in the page's extra space, and its stars stay together (NovelProbe p. 4).
          push({ items: [], height: S.height, ascent: S.ascent, graphics: () => [], together: 2 });
          const line = out.at(-1) as Extract<Unit, { kind: "line" }>;
          line.line.items = [{ x: centre - w / 2, runs: star }];
          // The two lower stars, 6.5 pt below, either side of the centre.
          push({ items: [{ x: centre - w - 1, runs: star }, { x: centre + 1, runs: star }], height: 0, ascent: S.ascent + 6.5 - S.height });
        } else {
          push({ items: [], height: S.height, ascent: 0, opens: true, graphics: (top) => [{ kind: "rect", x: T.left, y: top + S.rule, width: T.right - T.left, height: 0.5, gray: 0.5 }] });
        }
        printed = true;
        afterParagraph = false;
        afterHeading = !!T.smallCapsAfterHeading;
        break;
      }
      case "blockQuote": {
        const Q = T.quote;
        const spec: TextSpec = { font: Q.font ?? B.font, size: Q.size ?? B.size, italic: Q.italic, color: Q.color };
        e.paragraphs.forEach((para, k) => {
          if (k > 0 && T.blankLines) push(empty());
          const runs = toRuns(para.inline, ctx);
          // Wrapped at the right margin (Highland lets quotes run into it: a quirk we fix).
          const lines = (plain(runs).includes("\n") ? splitLines(runs) : [runs]).flatMap((text) => paragraph(text, spec, T.left + Q.indent, T.left + Q.indent, o.quirks ? T.right + Q.indent : T.right));
          lines.forEach((line, j) => push({ ...line, opens: false, ...(j === 0 ? { together: lines.length } : {}) }));
        });
        printed = true;
        afterParagraph = false;
        afterHeading = false;
        break;
      }
      case "rightAligned":
      case "centered": {
        for (const r of wrapMeasured(dress(toRuns(e.inline, ctx), B), T.right - T.left, T.right - T.left, width(B))) {
          const w = measure(r, B);
          // Never in the page's extra space (WikiProbe p. 4).
          push(bodyLine([{ x: e.kind === "centered" ? (T.left + T.right) / 2 - w / 2 : T.right - w, runs: r }]));
        }
        printed = true;
        // Paragraphs to Highland: the next paragraph is indented (NovelProbe p. 4).
        afterParagraph = true;
        afterHeading = false;
        break;
      }
      case "list": {
        e.items.forEach((item, index) => {
          const textX = T.left + (T.indent.rule === "all" ? T.indent.first : 0) + T.list.text + item.level * T.list.nested;
          const marker = item.ordered ? item.marker : item.marker === "*" ? "•" : item.marker;
          const markerRuns = dress([{ text: `${marker} `, style: {} }], B);
          // Lists stop as far in from the right as the left margin is beyond an inch (Novel: 468).
          const right = T.right - (T.left - 72);
          const lines = wrapMeasured(dress(toRuns(item.inline, ctx), B), right - textX, right - textX, width(B));
          lines.forEach((r, k) => {
            const items: Item[] = [{ x: textX, runs: r }];
            if (k === 0) items.unshift({ x: textX - measure(markerRuns, B), runs: markerRuns });
            // An item after the first may start in the last line's extra space (ArticleProbe,
            // ModernStandardProbe, BulletinProbe); a list's first item may not (SpeechProbe).
            push(bodyLine(items, k === 0 && index > 0 ? { opens: true } : {}));
          });
        });
        printed = true;
        afterParagraph = false;
        afterHeading = false;
        break;
      }
      case "termList": {
        const termRight = T.left + 224;
        const defX = T.left + 244;
        // Highland's definitions are 224 pt wide even past a narrower right margin (Novel): a quirk.
        const defRight = o.quirks ? defX + 224 : Math.min(T.right, defX + 224);
        const pitch = B.size * 1.3 + (B.leading ?? 0);
        for (const item of e.items) {
          const defs = wrapMeasured(dress(toRuns(item.definitionInline, ctx), B), defRight - defX, defRight - defX, width(B));
          const terms = wrapMeasured(dress(toRuns(item.termInline, ctx), B), termRight - T.left, termRight - T.left, width(B));
          const n = Math.max(defs.length, terms.length);
          for (let k = 0; k < n; k++) {
            const items: Item[] = [];
            const t = terms[k];
            if (t) items.push({ x: termRight - measure(t, B), runs: t });
            if (defs[k]) items.push({ x: defX, runs: defs[k]! });
            push({ items, height: pitch, ascent: pitch * 0.72, opens: k === 0 });
          }
        }
        printed = true;
        afterParagraph = false;
        afterHeading = false;
        break;
      }
      case "table": {
        const cols = Math.max(e.header.length, ...e.rows.map((r) => r.length), 1);
        const w = (T.right - T.left) / cols;
        const rule = (top: number): Graphic[] => [{ kind: "rect", x: T.left, y: top + B.pitch - 0.96, width: T.right - T.left, height: 0.5, gray: 0xbc / 255 }];
        const row = (cells: { inline: Parameters<typeof toRuns>[0] }[], head: boolean) => {
          const spec: TextSpec = head ? { ...B, bold: true } : B;
          const wrapped = cells.map((c) => wrapMeasured(dress(toRuns(c.inline, ctx), spec), w - 4, w - 4, width(spec)));
          const n = Math.max(1, ...wrapped.map((l) => l.length));
          for (let k = 0; k < n; k++) {
            const items: Item[] = [];
            wrapped.forEach((ls, c) => {
              const r = ls[k];
              if (!r) return;
              const start = T.left + c * w;
              items.push({ x: head ? start + (w - measure(r, spec)) / 2 : start, runs: r });
            });
            push(bodyLine(items, { opens: k === 0, ...(k === 0 && n > 1 ? { together: n } : {}), ...(k === n - 1 ? { graphics: rule } : {}) }));
          }
        };
        // As in Manuscript: a separator with alignment colons is not one; it prints as a row.
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
        afterHeading = false;
        break;
      }
      case "pageBreak":
        out.push({ kind: "pageBreak" });
        afterParagraph = false;
        prev = null;
        continue;
      case "directiveLine": {
        const directives = e.directives.map((d) => d.directive);
        out.push({ kind: "directives", directives });
        const toc = directives.find((d): d is Extract<Directive, { kind: "toc" }> => d.kind === "toc");
        if (toc) {
          // Entries for the headings after it, indented, with their page numbers at the margin.
          const after = headings.filter((h) => headingIndexAfter(elements, i, h.id));
          for (const h of after) {
            if (toc.levels && !toc.levels.includes(h.level)) continue;
            const n = dress([{ text: String(o.tocPages.get(h.id) ?? ""), style: {} }], B);
            const nw = measure(n, B);
            const title = wrapMeasured(dress([{ text: h.text, style: {} }], B), T.right - T.left - 18 - nw - 8, 1e6, width(B))[0] ?? [];
            push({ items: [{ x: T.left + 18, runs: title }, { x: T.right - nw, runs: n }], height: B.pitch + B.size, ascent: B.ascent, opens: true });
          }
          printed = true;
          afterParagraph = false;
          // The blank line after a table of contents is not printed (BulletinProbe).
          prev = null;
        }
        continue;
      }
      case "lyric":
      case "action": {
        for (const line of paragraph(toRuns(e.inline, ctx), B, T.left, T.left, T.right)) push(line);
        printed = true;
        afterParagraph = true;
        break;
      }
      case "synopsis": {
        if (!ctx.print?.marks.synopses) break;
        // Grey, half an inch in; the next paragraph is indented as if it were not there (as in the Manuscript).
        const runs = toRuns(e.inline, ctx, { color: SYNOPSIS_COLOR });
        if (!plain(runs).trim()) break;
        // Never in the page's extra space (ArticleProbe-Default p. 4).
        for (const line of paragraph(runs, { ...B, color: SYNOPSIS_COLOR }, T.left + 36, T.left, T.right)) push({ ...line, opens: false });
        printed = true;
        break;
      }
      default:
        break; // notes, synopses, link definitions: not printed
    }
    const range = o.sourceOf(e);
    for (const u of out.slice(before)) if (u.kind === "line") u.line.range = range;
    if (out.length > before) {
      if (gap > 0) out.splice(before, 0, ...Array.from({ length: gap }, (): Unit => ({ kind: "line", line: empty() })));
      prev = e;
    }
  }
  flushNotes(0);
  return out;
}

/** Whether heading `id` comes after element `index` (a {{TOC}} lists the headings that follow it). */
function headingIndexAfter(elements: Element[], index: number, id: number): boolean {
  let n = 0;
  for (let k = 0; k < elements.length; k++) {
    if (elements[k]!.kind !== "heading") continue;
    if (n === id) return k > index;
    n++;
  }
  return false;
}

/** Runs split at hard line breaks. */
function splitLines(runs: Run[]): Run[][] {
  const text = plain(runs);
  const out: Run[][] = [];
  let a = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      out.push(sliceRuns(runs, a, i));
      a = i + 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Title page: Title, Credit, Author, Source centred; Contact bottom left, Draft date bottom right.

function titlePage(fields: TitleField[], T: ProseTemplate, ctx: InlineContext, m: Measurer): Page {
  const P = T.title;
  if (P.kind !== "page") return { number: null, items: [] };
  const spec: TextSpec = { font: P.font ?? T.body.font, size: P.size };
  const pitch = P.size * 1.2;
  const items: PlacedText[] = [];
  const get = (...names: string[]) => names.map((n) => fields.find((f) => f.name === n)).find(Boolean);
  const lines = (f: TitleField | undefined, s: TextSpec): Run[][] =>
    f ? f.values.filter((v) => v.text.trim()).flatMap((v) => wrapMeasured(dress(styledValue(v.text, { ...ctx, links: false }), s), 468, 468, (r) => m.runs(r, s))) : [];
  const centre = (ls: Run[][], y: number, s: TextSpec, step: number) =>
    ls.forEach((r, k) => {
      const w = m.runs(r, s);
      items.push({ x: 306 - w / 2, y: y + k * step, runs: r });
    });
  const titleSpec: TextSpec = { ...spec, size: P.titleSize ?? P.size, italic: P.titleItalic };
  /** Lines of a column, downwards from y (empty field lines kept as space). */
  const column = (names: string[], y: number, x: (w: number) => number) => {
    const ls = names.flatMap((n) => {
      const f = get(n);
      return f ? f.values.flatMap((v) => (v.text.trim() === "" ? [[] as Run[]] : wrapMeasured(dress(styledValue(v.text, { ...ctx, links: false }), spec), 468, 468, (r) => m.runs(r, spec)))) : [];
    });
    while (ls.length && ls[0]!.length === 0) ls.shift();
    while (ls.length && ls.at(-1)!.length === 0) ls.pop();
    ls.forEach((r, k) => {
      if (r.length) items.push({ x: x(m.runs(r, spec)), y: y + k * pitch, runs: r });
    });
    return ls.length;
  };
  // Highland's Markdown corner keys (TL, TR, CC, BL, BR), as manuscripts use them, and the
  // screenplay-style keys (Title, Credit, Author, Source, Contact, Draft date) in the same places.
  const top = 72 + P.size;
  column(["tl"], top, () => 72);
  column(["tr"], top, (w) => 540 - w);
  if (get("cc")) column(["cc"], P.ys[0], (w) => 306 - w / 2);
  else {
    let y = P.ys[0];
    const order: [string[], TextSpec][] = [
      [["title"], titleSpec],
      [["credit"], spec],
      [["author", "authors"], spec],
      [["source"], spec],
    ];
    order.forEach(([names, s], k) => {
      const ls = lines(get(...names), s);
      const at = Math.max(P.ys[k]!, y);
      centre(ls, at, s, (s.size ?? P.size) * 1.2);
      if (ls.length) y = at + ls.length * (s.size ?? P.size) * 1.2;
    });
  }
  const stack = (names: string[], x: (w: number) => number) => {
    const ls = names.flatMap((n) => lines(get(n), spec));
    ls.forEach((r, k) => items.push({ x: x(m.runs(r, spec)), y: P.bottom - (ls.length - 1 - k) * pitch, runs: r }));
  };
  stack(["bl", "contact", "contact info", "notes", "copyright"], () => 72);
  stack(["br", "draft date", "revision"], (w) => 540 - w);
  for (const it of items) it.source = 0;
  return { number: null, items };
}

export { variantOf };
export type { ResolvedFonts };
