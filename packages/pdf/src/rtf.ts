import { inlineText, seriesCounter, type Directive, type Document, type Element, type Inline, type PageTextPart, type PageTextSlots } from "@highwater/parser";
import { imageSize, layoutManuscript, manuscriptHeadingPages, MANUSCRIPT } from "./manuscript.ts";
import { layoutScreenplay, SCREENPLAY, type ScriptTemplate } from "./screenplay.ts";
import { listMarker, onlyNotes, plain, printContext, runsWidth, SYNOPSIS_COLOR, toRuns, type InlineContext, type PrintContext } from "./text.ts";
import { CHAR, type Page, type PrintMarks, type Run, type TextStyle } from "./types.ts";

/**
 * Rich Text (.rtf) exports (M13; EJ, 2026-11-20): Highland 2's RTF export (claude/rtf-findings.md)
 * with its bugs and losses fixed. It keeps Highland's look (Courier Prime 12, the template's
 * indents and line spacing, elements spaced as in print) and adds what Highland leaves out: the
 * title page, the header and footer, links with their addresses, tables, term lists and dual
 * dialogue as they print. Notes, synopses and revision colours follow the print options.
 */
export interface RtfOptions {
  /** The elements to write, with {{INCLUDE}} files merged in; default the document's own. */
  elements?: RtfElement[];
  date?: Date;
  /** False: no title page. */
  titlePage?: boolean;
  /** The print options: notes, synopses, revision colours (stars and paragraph numbers aren't written). */
  print?: PrintMarks;
  /** Screenplays: the template's layout (default Screenplay) and the Document settings' scene heading look. */
  template?: ScriptTemplate;
  sceneHeadingBold?: boolean;
  sceneHeadingUnderline?: boolean;
  /** Two blank lines before a scene heading (default) or one; synopses in italics. */
  sceneHeadingDoubleSpaced?: boolean;
  synopsesItalic?: boolean;
  /** Manuscripts: an image's bytes, by its path in the document. */
  image?: (src: string) => Uint8Array | null;
}

export interface RtfElement {
  element: Element;
  /** The text the element's spans refer to. */
  source: string;
  /** From the document itself (revisions and print marks are kept); false for an included file. */
  own: boolean;
}

const tw = (pt: number) => Math.round(pt * 20);
const PAGE = { width: 612, height: 792 };
const LINK_COLOR = "#0000FF";
const HIGHLIGHT_COLOR = "#FCFF26";

// ---------------------------------------------------------------------------------------------
// Writing RTF

class Rtf {
  readonly #colors: string[] = [];

  color(hex: string): number {
    const c = hex.toLowerCase();
    let i = this.#colors.indexOf(c);
    if (i < 0) i = this.#colors.push(c) - 1;
    return i + 1;
  }

  /** Text, escaped: RTF's special characters, line breaks, tabs, and anything past ASCII as \uN. */
  static text(s: string): string {
    let out = "";
    for (const ch of s) {
      const c = ch.codePointAt(0)!;
      if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
      else if (ch === "\n") out += "\\line ";
      else if (ch === "\t") out += "\\tab ";
      else if (c < 0x80) out += ch;
      else if (c <= 0xffff) out += `\\u${c > 0x7fff ? c - 0x10000 : c}?`;
      else {
        // Outside the basic plane: a surrogate pair.
        const v = c - 0x10000;
        const hi = 0xd800 + (v >> 10);
        const lo = 0xdc00 + (v & 0x3ff);
        out += `\\u${hi - 0x10000}?\\u${lo - 0x10000}?`;
      }
    }
    return out;
  }

  /** Styled runs; a run with a link address becomes a HYPERLINK field. */
  runs(runs: Run[], base: TextStyle = {}): string {
    let out = "";
    for (let i = 0; i < runs.length; ) {
      const href = runs[i]!.style.href;
      let j = i;
      let group = "";
      while (j < runs.length && runs[j]!.style.href === href) {
        group += this.run(runs[j]!.text, { ...base, ...runs[j]!.style });
        j++;
      }
      out += href ? `{\\field{\\*\\fldinst{HYPERLINK "${href.replace(/["\\]/g, "")}"}}{\\fldrslt ${group}}}` : group;
      i = j;
    }
    return out;
  }

  run(text: string, s: TextStyle): string {
    if (text === "") return "";
    const color = s.color ?? (s.link ? LINK_COLOR : null);
    const codes =
      (s.bold ? "\\b" : "") +
      (s.italic ? "\\i" : "") +
      (s.underline || s.link ? "\\ul" : "") +
      (s.strike ? "\\strike" : "") +
      (s.highlight ? `\\chcbpat${this.color(HIGHLIGHT_COLOR)}\\cb${this.color(HIGHLIGHT_COLOR)}` : "") +
      (color ? `\\cf${this.color(color)}` : "");
    return codes ? `{${codes} ${Rtf.text(text)}}` : Rtf.text(text);
  }

  document(body: string): string {
    const table = this.#colors.map((c) => `\\red${parseInt(c.slice(1, 3), 16)}\\green${parseInt(c.slice(3, 5), 16)}\\blue${parseInt(c.slice(5, 7), 16)};`).join("");
    return (
      `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1` +
      `{\\fonttbl{\\f0\\fmodern\\fcharset0 Courier Prime{\\*\\falt Courier New};}}` +
      `{\\colortbl;${table}}` +
      // Heading styles, so {{FOOTER}}'s %# (the chapter) can be a STYLEREF field, as in the Word export.
      `{\\stylesheet{\\s0\\f0\\fs24 Normal;}{\\s1\\f0\\fs24\\sbasedon0 heading 1;}{\\s2\\f0\\fs24\\sbasedon0 heading 2;}{\\s3\\f0\\fs24\\sbasedon0 heading 3;}}` +
      `\\paperw${tw(PAGE.width)}\\paperh${tw(PAGE.height)}\\widowctrl\\ftnbj\n` +
      body +
      `}\n`
    );
  }
}

/** A paragraph's codes: \pard, indents in points from the margins, then its own codes. */
function pard(o: { li?: number; ri?: number; fi?: number; sb?: number; sl?: number; align?: "c" | "r"; keepn?: boolean; pagebb?: boolean; extra?: string } = {}): string {
  return (
    "\\pard\\plain\\f0\\fs24" +
    (o.li ? `\\li${tw(o.li)}` : "") +
    (o.ri ? `\\ri${tw(o.ri)}` : "") +
    (o.fi ? `\\fi${tw(o.fi)}` : "") +
    (o.sb ? `\\sb${tw(o.sb)}` : "") +
    (o.sl ? `\\sl-${tw(o.sl)}\\slmult0` : "") +
    (o.align ? `\\q${o.align}` : "") +
    (o.keepn ? "\\keepn" : "") +
    (o.pagebb ? "\\pagebb" : "") +
    (o.extra ?? "") +
    " "
  );
}

/** A header or footer from {{HEADER}}/{{FOOTER}}: left, centre and right on tabs; %p the page, %pp the count, %# the chapter. */
function slotsRtf(d: PageTextSlots, base: string, at: PageTextPlace): string {
  const fill = (parts: PageTextPart[] | null) =>
    (parts ?? [])
      .map((t) => (t.kind === "text" ? Rtf.text(t.text) : t.kind === "page" ? "{\\field{\\*\\fldinst PAGE}{\\fldrslt 1}}" : t.kind === "pageCount" ? "{\\field{\\*\\fldinst NUMPAGES}{\\fldrslt 1}}" : `{\\field{\\*\\fldinst STYLEREF "heading 1"}{\\fldrslt }}`))
      .join("");
  return `${base}${at.indents}\\tqc\\tx${tw(at.centre)}\\tqr\\tx${tw(at.right)} ${fill(d.left)}\\tab ${fill(d.center)}\\tab ${fill(d.right)}\\par`;
}

/**
 * Where the PDF puts headers and footers (left edge, centre, right edge, in points from the paper's
 * left edge), as indents and tab stops from the page margins. Tab stops count from the left margin.
 */
interface PageTextPlace {
  indents: string;
  centre: number;
  right: number;
}
function pageTextPlace(pos: { left: number; centre: number; right: number }, margins: { l: number; r: number }): PageTextPlace {
  const li = pos.left - margins.l;
  const ri = PAGE.width - margins.r - pos.right;
  return { indents: (li ? `\\li${tw(li)}` : "") + (ri ? `\\ri${tw(ri)}` : ""), centre: pos.centre - margins.l, right: pos.right - margins.l };
}

type PageTextDirective = Extract<Directive, { slots: PageTextSlots }>;

/** The first {{HEADER}} and {{FOOTER}} (a change later in the text needs sections Highland's files rarely use: it isn't followed). */
function pageTexts(elements: RtfElement[]): { header: PageTextDirective | null; footer: PageTextDirective | null } {
  let header: PageTextDirective | null = null;
  let footer: PageTextDirective | null = null;
  for (const { element: e } of elements)
    if (e.kind === "directiveLine")
      for (const { directive: d } of e.directives) {
        if (d.kind === "header" && !header) header = d;
        if (d.kind === "footer" && !footer) footer = d;
      }
  return { header, footer };
}

/** The body's section: page numbering from 1, the header and footer (none on its first page without a {{HEADER}}, as Highland prints). */
function bodySection(texts: ReturnType<typeof pageTexts>, o: { margins: { l: number; r: number; t: number; b: number }; header: { y: number; left: number; centre: number; right: number }; footer: { y: number; left: number; centre: number; right: number }; defaultHeader: string; first: boolean }): string {
  const m = o.margins;
  // Header and footer heights put their baselines where the PDF's are (measured in LibreOffice).
  let s = `\\sectd\\pgnrestart\\pgnstarts1\\margl${tw(m.l)}\\margr${tw(m.r)}\\margt${tw(m.t)}\\margb${tw(m.b)}\\headery${tw(o.header.y - 7.8)}\\footery${tw(PAGE.height - o.footer.y - 4.3)}`;
  const base = "\\pard\\plain\\f0\\fs24";
  const at = pageTextPlace(o.header, m);
  const below = pageTextPlace(o.footer, m);
  const header = texts.header ? (texts.header.off ? `${base}\\par` : slotsRtf(texts.header.slots, base, at)) : `${base}${at.indents}\\qr ${o.defaultHeader}\\par`;
  const footer = texts.footer && !texts.footer.off ? slotsRtf(texts.footer.slots, base, below) : "";
  if (!texts.header && o.first) s += "\\titlepg";
  s += `{\\header ${header}}`;
  if (!texts.header && o.first) s += `{\\headerf ${base}\\par}`;
  if (footer) {
    s += `{\\footer ${footer}}`;
    if (!texts.header && o.first) s += `{\\footerf ${footer}}`;
  }
  return `${s}\n`;
}

// ---------------------------------------------------------------------------------------------
// Screenplays

export function screenplayRtf(doc: Document, options: RtfOptions = {}): string {
  const T = options.template ?? SCREENPLAY;
  const rtf = new Rtf();
  const elements = options.elements ?? doc.elements.map((element) => ({ element, source: doc.source, own: true }));
  const marks: PrintMarks = options.print ?? {};
  const base = printContext(doc, marks)!;
  const ctx: InlineContext = { series: seriesCounter(), date: options.date ?? new Date() };
  const look: TextStyle = { ...(options.sceneHeadingBold !== false ? { bold: true } : {}), ...(options.sceneHeadingUnderline ? { underline: true } : {}) };
  // Margins: half an inch on the left (the scene numbers sit in it: a negative indent isn't safe in
  // every reader) and the template's right edge; everything else is indents from them.
  const margins = { l: 36, r: PAGE.width - T.rightEdge, t: T.firstLineY - 9, b: 72 };
  const right = PAGE.width - margins.r;
  const box = (x: number, chars: number) => ({ li: x - margins.l, ri: right - (x + chars * CHAR) });
  const action = box(T.action.x, T.action.width);
  const lines = T.lineHeight;
  const headingSpace = options.sceneHeadingDoubleSpaced === false ? lines : lines * 2;
  const out: string[] = [];
  let first = true;
  let pageBreak = false;
  /** A paragraph; the first of an element gets a blank line before it (none at the top of a page). */
  const para = (o: Parameters<typeof pard>[0], content: string, opens = true) => {
    // Space before only between elements: none at the top of the script or of a page.
    const { sb, ...rest } = o ?? {};
    out.push(`${pard({ sl: lines, ...rest, ...(opens && !first && !pageBreak ? { sb: sb ?? lines } : {}), ...(pageBreak ? { pagebb: true } : {}) })}${content}\\par\n`);
    first = false;
    pageBreak = false;
  };
  const caps = (runs: Run[]) => (T.uppercaseAction ? runs.map((r) => ({ ...r, text: r.text.toUpperCase() })) : runs);

  for (let i = 0; i < elements.length; i++) {
    const { element: e, own } = elements[i]!;
    const print: PrintContext = { ...base, own };
    const c: InlineContext = { ...ctx, print };
    switch (e.kind) {
      case "sceneHeading": {
        const text = rtf.runs(trimRuns(toRuns(e.inline, c, look)));
        const n = e.sceneNumber?.text;
        // The number on both sides, as Highland prints it: in the margin on the left, after the heading on the right.
        const left = T.sceneNumberLeft - margins.l;
        const h = box(T.sceneHeading.x, T.sceneHeading.width);
        if (n) para({ ...h, ri: Math.max(0, right - T.sceneNumberRight - 4 * CHAR), fi: left - h.li, keepn: true, sb: headingSpace, extra: `\\tx${tw(h.li)}\\tx${tw(T.sceneNumberRight - margins.l)}` }, `${Rtf.text(n)}\\tab ${text}\\tab ${Rtf.text(n)}`);
        else para({ ...h, keepn: true, sb: headingSpace }, text);
        break;
      }
      case "action": {
        if (onlyNotes(e.inline)) {
          if (marks.notes) para(action, rtf.runs(toRuns(e.inline, c)));
          break;
        }
        const runs = caps(toRuns(e.inline, c));
        if (plain(runs).trim() !== "") para(action, rtf.runs(runs));
        break;
      }
      case "lyric":
        para(action, rtf.runs(caps(toRuns(e.inline, c, { italic: true }))));
        break;
      case "centered":
      case "rightAligned":
        para({ ...box(T.sceneHeading.x, T.sceneHeading.width), align: e.kind === "centered" ? "c" : "r" }, rtf.runs(caps(trimRuns(toRuns(e.inline, c)))));
        break;
      case "transition":
        para({ ...action, align: "r" }, rtf.runs(trimRuns(toRuns(e.inline, c)).map((r) => ({ ...r, text: r.text.toUpperCase() }))));
        break;
      case "dialogue": {
        const next = elements[i + 1]?.element;
        if (e.dual === "left" && next?.kind === "dialogue" && next.dual === "right") {
          out.push(dualRow(rtf, T, margins.l, [e, next], c, lines, !first && !pageBreak, pageBreak));
          first = false;
          pageBreak = false;
          i++;
          break;
        }
        const cue = box(T.cue.x, T.cue.width);
        para({ ...cue, keepn: true }, rtf.run([e.character, ...e.extensions].join(" "), {}));
        for (const p of e.parts) {
          if (p.kind === "empty") para(box(T.dialogue.x, T.dialogue.width), "", false);
          else if (p.kind === "parenthetical") {
            const b = box(T.parenthetical.x, T.parenthetical.width);
            // Wrapped parenthetical lines indent one character, as printed.
            para({ li: b.li + CHAR, fi: -CHAR, ri: b.ri - CHAR, keepn: true }, rtf.runs(toRuns(p.inline, c)), false);
          } else para(box(T.dialogue.x, T.dialogue.width), rtf.runs(toRuns(p.inline, c, p.kind === "lyric" ? { italic: true } : {})), false);
        }
        break;
      }
      case "section":
        if (T.printSections) para(action, rtf.runs(toRuns(e.inline, c, e.level === 1 ? { bold: true, underline: true } : {}).map((r) => (e.level === 1 ? { ...r, text: r.text.toUpperCase() } : r))));
        break;
      case "synopsis":
        if (marks.synopses) para({ ...action, li: action.li + 36 }, rtf.runs(toRuns(e.inline, c, { color: SYNOPSIS_COLOR, ...(options.synopsesItalic ? { italic: true } : {}) })));
        break;
      case "pageBreak":
        if (!first) pageBreak = true;
        break;
      default:
        break;
    }
  }
  const empty = !out.length;
  if (empty) out.push(`${pard()}\\par\n`);

  const texts = pageTexts(elements);
  const hasTitle = doc.titlePage !== null && options.titlePage !== false;
  // The title page as the PDF lays it out, line for line.
  const titleLayout = hasTitle ? layoutScreenplay(doc, { template: T, date: ctx.date }).pages[0] : undefined;
  const title = titleLayout?.number === null ? titlePageRtf(rtf, titleLayout, { margins: { l: margins.l, t: 72 }, centre: T.title.centre, right: T.title.right, ascent: 11 }) : "";
  const body = bodySection(texts, { margins, header: T.header, footer: T.footer, defaultHeader: "{\\field{\\*\\fldinst PAGE}{\\fldrslt 2}}.", first: true });
  // A title page and nothing else: just the title page.
  if (title && empty) return rtf.document(`\\sectd\\margl${tw(margins.l)}\\margr${tw(margins.r)}\\margt${tw(72)}\\margb${tw(72)}\n${title}`);
  return rtf.document((title ? `\\sectd\\margl${tw(margins.l)}\\margr${tw(margins.r)}\\margt${tw(72)}\\margb${tw(72)}\n${title}\\sect` : "") + body + out.join(""));
}

/** Dual dialogue side by side: a borderless two-column table, each speech at its column's indents. */
function dualRow(rtf: Rtf, T: ScriptTemplate, left: number, [a, b]: [Extract<Element, { kind: "dialogue" }>, Extract<Element, { kind: "dialogue" }>], c: InlineContext, lines: number, space: boolean, pagebb: boolean): string {
  // The columns divide halfway between the left speech's right edge and the right speech's left edge.
  const split = (T.dual.left.dialogue + T.dual.left.dialogueWidth * CHAR + T.dual.right.dialogue) / 2;
  const cols = [
    { from: T.action.x, to: split, s: T.dual.left },
    { from: split, to: T.rightEdge, s: T.dual.right },
  ];
  const cell = (e: Extract<Element, { kind: "dialogue" }>, k: number) => {
    const { from, to, s } = cols[k]!;
    const width = to - from;
    const p = (x: number, chars: number, content: string, fi = 0) => `\\pard\\plain\\intbl\\f0\\fs24\\sl-${tw(lines)}\\slmult0\\li${tw(x - from)}\\ri${tw(Math.max(0, width - (x - from) - chars * CHAR))}${fi ? `\\fi${tw(fi)}` : ""} ${content}\\par `;
    let out = p(s.cue, 30, rtf.run([e.character, ...e.extensions].join(" "), {}));
    for (const part of e.parts) {
      if (part.kind === "empty") out += p(s.dialogue, s.dialogueWidth, "");
      else if (part.kind === "parenthetical") out += p(s.parenthetical + CHAR, s.parentheticalWidth - 1, rtf.runs(toRuns(part.inline, c)), -CHAR);
      else out += p(s.dialogue, s.dialogueWidth, rtf.runs(toRuns(part.inline, c, part.kind === "lyric" ? { italic: true } : {})));
    }
    // The last paragraph in a cell ends with \cell, not \par.
    return out.replace(/\\par $/, "\\cell ");
  };
  const row = `\\trowd\\trgaph0\\trleft${tw(T.action.x - left)}\\cellx${tw(split - left)}\\cellx${tw(T.rightEdge - left)}`;
  const before = space ? `\\pard\\plain\\f0\\fs24\\sl-${tw(lines)}\\slmult0${pagebb ? "\\pagebb" : ""} \\par\n` : pagebb ? "\\pard\\plain\\f0\\fs24\\pagebb \\par\n" : "";
  return `${before}${row}\n${cell(a, 0)}\n${cell(b, 1)}\n\\row\\pard\n`;
}

/**
 * A title page from the PDF's layout of it: each printed line becomes a paragraph at the same
 * height (exact line spacing, the gap above as space before), each part on a tab stop where the
 * PDF puts it (left at its x, centred lines on the centre, right-aligned ones on the right edge).
 */
function titlePageRtf(rtf: Rtf, page: Page, o: { margins: { l: number; t: number }; centre: number; right: number; ascent: number }): string {
  const rows: { y: number; items: Page["items"] }[] = [];
  for (const item of [...page.items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row.y - item.y) < 0.5) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  let out = "";
  let top = o.margins.t;
  for (const row of rows) {
    const height = 14.4;
    const sb = Math.max(0, row.y - o.ascent - top);
    let tabs = "";
    let text = "";
    for (const item of row.items) {
      const len = runsWidth(item.runs);
      const x = item.x - o.margins.l;
      if (Math.abs(item.x + len / 2 - o.centre) < 1) tabs += `\\tqc\\tx${tw(o.centre - o.margins.l)}`;
      else if (Math.abs(item.x + len - o.right) < 1) tabs += `\\tqr\\tx${tw(o.right - o.margins.l)}`;
      else if (x < 0.5 && text === "") {
        // At the margin, first on its line: no tab needed.
        text += rtf.runs(item.runs);
        continue;
      } else tabs += `\\tx${tw(x)}`;
      text += `\\tab ${rtf.runs(item.runs)}`;
    }
    out += `${pard({ sl: height, ...(sb > 0.05 ? { sb } : {}), extra: tabs })}${text}\\par\n`;
    top += sb + height;
  }
  return out || `${pard()}\\par\n`;
}

/** Without spaces at either end. */
function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, "");
  if (out.at(-1)) out.at(-1)!.text = out.at(-1)!.text.replace(/\s+$/, "");
  return out.filter((r) => r.text !== "");
}

// ---------------------------------------------------------------------------------------------
// Manuscripts

export function manuscriptRtf(doc: Document, options: RtfOptions = {}): string {
  const M = MANUSCRIPT;
  const rtf = new Rtf();
  const elements = options.elements ?? doc.elements.map((element) => ({ element, source: doc.source, own: true }));
  const marks: PrintMarks = options.print ?? {};
  const base = printContext(doc, marks)!;
  const linkDefinitions = new Map<string, string>();
  for (const { element: e } of elements) if (e.kind === "linkDefinition") linkDefinitions.set(e.label.toLowerCase(), e.url);
  const ctx: InlineContext = { series: seriesCounter(), date: options.date ?? new Date(), links: true, linkDefinitions };
  // The text box is the PDF's (one inch all round), raised 4 pt: with exact 28.32 pt lines the
  // first baseline then lands on the PDF's (y 90; measured in LibreOffice).
  const margins = { l: M.left, r: PAGE.width - M.right, t: 68, b: 76 };
  const width = M.right - M.left;
  const hasTitle = doc.titlePage !== null && options.titlePage !== false;
  const out: string[] = [];
  let pageBreak = false;
  let afterParagraph = false;
  let printed = false;
  let afterBreak = false;
  const para = (o: Parameters<typeof pard>[0], content: string) => {
    out.push(`${pard({ sl: M.pitch, ...o, ...(pageBreak ? { pagebb: true } : {}) })}${content}\\par\n`);
    pageBreak = false;
    afterBreak = false;
    printed = true;
  };

  // Headings for {{TOC}} and its page numbers.
  const headingTexts: { text: string; level: number }[] = [];
  {
    const c: InlineContext = { ...ctx, series: seriesCounter() };
    for (const { element: e } of elements) if (e.kind === "heading") headingTexts.push({ text: plain(toRuns(e.inline, c)).trim(), level: e.level });
  }
  const levels = headingTexts.map((h) => h.level);
  const chapterLevel = levels.length ? Math.min(...levels) : 1;
  const needsPages = elements.some(({ element: e }) => e.kind === "directiveLine" && e.directives.some((d) => d.directive.kind === "toc"));
  const headingPages = needsPages ? manuscriptHeadingPages(doc, options.titlePage === false ? { titlePage: false } : {}) : [];
  /** Notes on lines of their own, printed: they open the next paragraph (as in the PDF). */
  let notes: Run[] = [];

  for (const { element: e, own } of elements) {
    const print: PrintContext = { ...base, own };
    const c: InlineContext = { ...ctx, print };
    switch (e.kind) {
      case "paragraph": {
        const img = e.inline.length === 1 && e.inline[0]!.kind === "image" ? e.inline[0] : null;
        if (img && img.kind === "image") {
          const data = options.image?.(img.src) ?? null;
          const size = data ? imageSize(data) : null;
          if (data && size) {
            const scale = Math.min(1, width / size.width, (M.lastBaseline - M.top) / size.height);
            para({ align: "c", sl: 0 }, pictRtf(data, size.width * scale, size.height * scale));
            afterParagraph = false;
          }
          break;
        }
        if (onlyNotes(e.inline)) {
          if (marks.notes) notes.push(...toRuns(e.inline, c), { text: " ", style: {} });
          break;
        }
        const runs = [...notes, ...toRuns(e.inline, c)];
        notes = [];
        if (plain(runs).trim() === "") break;
        para(afterParagraph ? { fi: M.indent } : {}, rtf.runs(runs));
        afterParagraph = true;
        break;
      }
      case "heading": {
        // A heading that opens the text without a title page, or a page after "===", starts lower, as printed.
        const drop = (!printed && !hasTitle) || afterBreak;
        const level = Math.min(3, Math.max(1, e.level - chapterLevel + 1));
        para({ align: "c", keepn: true, ...(drop ? { sb: M.dropHeading } : {}), extra: `\\s${level}\\sa${tw(M.headingAfter)}\\outlinelevel${level - 1}` }, rtf.runs(toRuns(e.inline, c)));
        afterParagraph = false;
        break;
      }
      case "sceneBreak":
        para({ align: "c" }, "#");
        afterParagraph = false;
        break;
      case "blockQuote":
        e.paragraphs.forEach((p, k) => {
          if (k > 0) para({ li: M.quote.x - M.left }, "");
          para({ li: M.quote.x - M.left }, rtf.runs(toRuns(p.inline, c, { italic: true })));
        });
        afterParagraph = false;
        break;
      case "centered":
      case "rightAligned":
        para({ align: e.kind === "centered" ? "c" : "r" }, rtf.runs(trimRuns(toRuns(e.inline, c))));
        afterParagraph = false;
        break;
      case "list":
        for (const item of e.items) {
          const x = item.level === 0 ? M.list.textX : M.list.nestedX + item.level * M.list.level;
          const marker = listMarker(item);
          // A hanging indent: the marker before the text, the text's lines aligned.
          para({ li: x - M.left, fi: -(marker.length + 1) * CHAR, ri: M.right - M.list.right, extra: `\\tx${tw(x - M.left)}` }, `${Rtf.text(marker)}\\tab ${rtf.runs(toRuns(item.inline, c))}`);
        }
        afterParagraph = false;
        break;
      case "termList":
        for (const item of e.items)
          para(
            { li: M.terms.definitionX - M.left, fi: -(M.terms.definitionX - M.left), sl: M.terms.height, extra: `\\tqr\\tx${tw(M.terms.termRight - M.left)}\\tx${tw(M.terms.definitionX - M.left)}` },
            `\\tab ${rtf.runs(toRuns(item.termInline, c))}\\tab ${rtf.runs(toRuns(item.definitionInline, c))}`,
          );
        afterParagraph = false;
        break;
      case "table": {
        const aligned = e.align.some((a) => a !== null);
        const rows: { cells: Run[][]; head: boolean }[] = [{ cells: e.header.map((cell) => toRuns(cell.inline, c, aligned ? {} : { bold: true })), head: !aligned }];
        if (aligned) {
          // As printed (Highland prints a table's alignment row).
          const sep = e.lines[1];
          const cells = sep ? doc.source.slice(sep.content.start, sep.content.end).trim().replace(/^\|/, "").replace(/\|$/, "").split("|") : [];
          rows.push({ cells: cells.map((t) => [{ text: t.trim(), style: {} }]), head: false });
        }
        for (const r of e.rows) rows.push({ cells: r.map((cell) => toRuns(cell.inline, c)), head: false });
        if (pageBreak) para({}, "");
        out.push(tableRtf(rtf, rows, e.align, width, M.pitch));
        printed = true;
        afterParagraph = false;
        break;
      }
      case "synopsis":
        if (marks.synopses) para({ li: 36 }, rtf.runs(toRuns(e.inline, c, { color: SYNOPSIS_COLOR })));
        break;
      case "pageBreak":
        if (printed) pageBreak = true;
        afterParagraph = false;
        afterBreak = true;
        break;
      case "directiveLine":
        for (const { directive: d } of e.directives) {
          if (d.kind !== "toc") continue;
          const entries = headingTexts.map((h, id) => ({ ...h, page: headingPages[id] })).filter((h) => !d.levels || d.levels.includes(h.level));
          for (const h of entries) para({ li: (h.level - chapterLevel) * 2 * CHAR, extra: `\\tqr\\tldot\\tx${tw(width)}\\sa${tw(M.toc.height - M.pitch)}` }, `${Rtf.text(h.text)}\\tab ${h.page ?? ""}`);
          if (entries.length) para({}, "");
          afterParagraph = false;
        }
        break;
      case "action":
      case "lyric":
        para({}, rtf.runs(toRuns(e.inline, c, e.kind === "lyric" ? { italic: true } : {})));
        break;
      default:
        break;
    }
  }
  if (notes.length) para({}, rtf.runs(notes));
  const empty = !out.length;
  if (empty) out.push(`${pard()}\\par\n`);

  const texts = pageTexts(elements);
  const titleLayout = hasTitle ? layoutManuscript(doc, { date: ctx.date, ...(options.image ? { image: options.image } : {}) }).pages[0] : undefined;
  const title = titleLayout?.number === null ? titlePageRtf(rtf, titleLayout, { margins: { l: margins.l, t: margins.t }, centre: M.title.centre, right: M.title.right, ascent: 11 }) : "";
  const body = bodySection(texts, { margins, header: M.header, footer: M.footer, defaultHeader: "{\\field{\\*\\fldinst PAGE}{\\fldrslt 2}}", first: true });
  const titleSection = `\\sectd\\margl${tw(margins.l)}\\margr${tw(margins.r)}\\margt${tw(margins.t)}\\margb${tw(margins.b)}\n${title}`;
  if (title && empty) return rtf.document(titleSection);
  return rtf.document((title ? `${titleSection}\\sect` : "") + body + out.join(""));
}

/** A table as printed: columns of equal width, a rule under each row, header cells bold when the columns aren't aligned. */
function tableRtf(rtf: Rtf, rows: { cells: Run[][]; head: boolean }[], align: ("left" | "center" | "right" | null)[], width: number, pitch: number): string {
  const cols = Math.max(1, ...rows.map((r) => r.cells.length));
  const w = width / cols;
  const def = `\\trowd\\trgaph${tw(4)}\\trleft0` + Array.from({ length: cols }, (_, k) => `\\clbrdrb\\brdrs\\brdrw10\\brdrcf${rtf.color("#BCBEC0")}\\cellx${tw(w * (k + 1))}`).join("");
  return rows
    .map((r) => {
      const cells = Array.from({ length: cols }, (_, k) => {
        const a = r.head ? "\\qc" : align[k] === "center" ? "\\qc" : align[k] === "right" ? "\\qr" : "";
        return `\\pard\\plain\\intbl\\f0\\fs24\\sl-${tw(pitch)}\\slmult0${a} ${rtf.runs(r.cells[k] ?? [])}\\cell `;
      }).join("");
      return `${def}${r.head ? "\\trhdr" : ""}\n${cells}\\row\n`;
    })
    .join("") + "\\pard\n";
}

/** A PNG or JPEG picture at a size in points. */
function pictRtf(data: Uint8Array, wpt: number, hpt: number): string {
  const png = data[0] === 0x89 && data[1] === 0x50;
  const jpg = data[0] === 0xff && data[1] === 0xd8;
  if (!png && !jpg) return "";
  const size = imageSize(data);
  const hex = Buffer.from(data).toString("hex").replace(/(.{128})/g, "$1\n");
  return `{\\pict${png ? "\\pngblip" : "\\jpegblip"}\\picw${size?.width ?? 1}\\pich${size?.height ?? 1}\\picwgoal${tw(wpt)}\\pichgoal${tw(hpt)}\n${hex}}`;
}

/** The text of inline content, for tests. */
export function rtfPlain(nodes: Inline[]): string {
  return inlineText(nodes);
}
