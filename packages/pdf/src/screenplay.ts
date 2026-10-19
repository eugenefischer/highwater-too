import { parseInline, seriesCounter, type Directive, type Document, type Element, type PageTextPart, type PageTextSlots, type TitleField } from "@highwater/parser";
import { plain, sentenceEnds, sliceRuns, toRuns, trimStartRuns, wrapRuns, type InlineContext } from "./text.ts";
import { assignSources, CHAR, type Layout, type Page, type PlacedText, type Run, type SourceRange } from "./types.ts";

/** A script template's measured layout (Highland 2: Screenplay, Stage Play, Graphic Novel). x values are where text starts; y values are baselines. */
export interface ScriptTemplate {
  name: string;
  width: number;
  height: number;
  firstLineY: number;
  lineHeight: number;
  /** Lines on a page without a footer (one fewer with). */
  linesPerPage: number;
  action: { x: number; width: number };
  /** Scene headings, and centred or right-aligned text. */
  sceneHeading: { x: number; width: number };
  sceneNumberLeft: number;
  sceneNumberRight: number;
  cue: { x: number; width: number };
  /** Wrapped parenthetical lines indent one character and are one character narrower. */
  parenthetical: { x: number; width: number };
  dialogue: { x: number; width: number };
  /** (MORE) at a dialogue page break. */
  more: { x: number };
  dual: {
    left: { cue: number; parenthetical: number; dialogue: number; dialogueWidth: number; parentheticalWidth: number };
    right: { cue: number; parenthetical: number; dialogue: number; dialogueWidth: number; parentheticalWidth: number };
  };
  rightEdge: number;
  centre: number;
  header: { y: number; left: number; centre: number; right: number };
  footer: { y: number; left: number; centre: number; right: number };
  title: { pitch: number; blank: number; firstY: number; centre: number; bottomY: number; left: number; right: number; width: number };
  /** Sections print in the text: level 1 in capitals, bold and underlined, others plain (Graphic Novel). */
  printSections?: boolean;
  /** Action, lyrics and centred text in capitals (Multi-Cam's Uppercase action option, on by default). */
  uppercaseAction?: boolean;
  /**
   * Dialogue double-spaced: each line takes two rows, its baseline 6 pt above the second row's
   * (24 pt line boxes, baseline 15 below the top; Multi-Cam).
   */
  doubleSpacedDialogue?: boolean;
  /** Parentheticals run into the dialogue line after them, in the dialogue's margins (Multi-Cam). */
  inlineParentheticals?: boolean;
}

/**
 * Highland 2's Screenplay template on US Letter, measured from its PDFs (see the spec's
 * "Screenplay template (measured)").
 */
export const SCREENPLAY: ScriptTemplate = {
  name: "Screenplay",
  width: 612,
  height: 792,
  firstLineY: 81,
  lineHeight: 12,
  /** 55 lines, or 54 when the page has a footer (ScreenplayEdgeCases vs Astounding). */
  linesPerPage: 55,
  action: { x: 108, width: 63 },
  sceneHeading: { x: 108, width: 63 },
  sceneNumberLeft: 54,
  sceneNumberRight: 540,
  cue: { x: 249, width: 38 },
  parenthetical: { x: 207, width: 29 },
  dialogue: { x: 179, width: 34 },
  more: { x: 214.2 },
  /** Measured with FirstLineTests: the right column is wider than the left. */
  dual: {
    left: { cue: 179, parenthetical: 137, dialogue: 109, dialogueWidth: 28, parentheticalWidth: 23 },
    right: { cue: 403.8, parenthetical: 361.3, dialogue: 333.8, dialogueWidth: 29, parentheticalWidth: 25 },
  },
  rightEdge: 564,
  centre: 336,
  header: { y: 51, left: 72, centre: 306, right: 540 },
  footer: { y: 747, left: 72, centre: 306, right: 540 },
  /** Blank lines inside a title page field: 14 pt (StartTest2, Maximal; the 2024 Astounding export shows 15). */
  title: { pitch: 14.4, blank: 14, firstY: 241.4, centre: 306, bottomY: 716.6, left: 72, right: 540, width: 63 },
};

/** Graphic Novel (M10, GraphicNovelProbe): the Screenplay layout, with sections printed. */
export const GRAPHIC_NOVEL: ScriptTemplate = { ...SCREENPLAY, name: "Graphic Novel", printSections: true };

/**
 * Stage Play (M10, StagePlayProbe): action (and lyrics) in a column on the right, from 4 in.;
 * wide dialogue from the left; cue and parenthetical between.
 */
export const STAGE_PLAY: ScriptTemplate = {
  ...SCREENPLAY,
  name: "Stage Play",
  action: { x: 288, width: 35 },
  cue: { x: 215, width: 38 },
  parenthetical: { x: 215, width: 33 },
  dialogue: { x: 124.28, width: 46 },
  more: { x: 222.2 },
  // Dialogue widths from the probe's wrapping (left exactly 29; right 29 to 34); parenthetical widths not probed.
  dual: {
    left: { cue: 145, parenthetical: 145, dialogue: 54.28, dialogueWidth: 29, parentheticalWidth: 23 },
    right: { cue: 323, parenthetical: 349, dialogue: 286.95, dialogueWidth: 29, parentheticalWidth: 25 },
  },
};

/**
 * Multi-Cam (M10, MultiCamProbe): the Screenplay margins, action in capitals, dialogue
 * double-spaced with parentheticals run into it.
 */
export const MULTI_CAM: ScriptTemplate = { ...SCREENPLAY, name: "Multi-Cam", uppercaseAction: true, doubleSpacedDialogue: true, inlineParentheticals: true };

/** The script templates, by the name Highland stores in info.json. */
export const SCRIPT_TEMPLATES: Record<string, ScriptTemplate> = { Screenplay: SCREENPLAY, "Multi-Cam": MULTI_CAM, "Graphic Novel": GRAPHIC_NOVEL, "Stage Play": STAGE_PLAY };

/** Capitals, for templates that print action that way. */
function caps(runs: Run[]): Run[] {
  return active.uppercaseAction ? runs.map((r) => ({ ...r, text: r.text.toUpperCase() })) : runs;
}

/** The template being laid out (layout is synchronous; set by layoutScreenplay). */
let active: ScriptTemplate = SCREENPLAY;

type PageTextDirective = Extract<Directive, { slots: PageTextSlots }>;

/** A body page while it is being filled. */
interface OpenPage {
  rows: (Row | null)[];
  header: PageTextDirective | null;
  footer: PageTextDirective | null;
  section: string;
  number: number;
  started: boolean;
  /** A hidden paragraph landed here, so a page break after it still starts a new page. */
  touched: boolean;
  /** Something printable is on the page (blank lines before the next block apply). */
  content: boolean;
}

export interface ScreenplayOptions {
  /** Elements to print (after includes are merged); default: the document's own. */
  elements?: Element[];
  /** Where an element sits in the script being edited (included elements: their include line); default: its span. */
  sourceOf?: (e: Element) => SourceRange;
  /** For {{TIMESTAMP}}; default: now. */
  date?: Date;
  /** Print the title page (Highland's print option, on by default). */
  titlePage?: boolean;
  /** The script template; default Screenplay. */
  template?: ScriptTemplate;
}

/** One line slot on the page: text items at their x positions. */
interface Row {
  /** The script text it was printed from. */
  range?: SourceRange | undefined;
  /** `dy`: moved from the row's baseline (Multi-Cam's double-spaced dialogue). */
  items: { x: number; runs: Run[]; dy?: number }[];
}

/** A unit of the flow: an element's rows plus how it joins the page. */
interface Block {
  kind: Element["kind"] | "directives";
  range?: SourceRange | undefined;
  rows: Row[];
  /** Blank lines before it, unless it starts a page. */
  space: number;
  /** A scene heading must share its page with the next block's first line. */
  keepWithNext?: boolean;
  pageBreak?: boolean;
  directives?: Directive[];
  section?: string;
  /** Rows without text (directive paragraphs); `content` says whether they count as content. */
  filler?: boolean;
  content?: boolean;
  /**
   * Rows Highland counts when deciding whether the block fits, if not its own: a dual dialogue
   * counts both columns (FirstLineTests case O: 48 lines that fit beside two were moved).
   */
  fitRows?: number;
  /** False when Highland will not let the block end on the page's last line (SpeechFitTests). */
  lastLineOk?: boolean;
  /** Takes no lines but, like any paragraph, needs room for the blank line before it (notes, synopses). */
  ghost?: boolean;
  /** Splits the block so its first part fits in `available` rows; null where Highland would not split. */
  split?: (available: number) => { head: Row[]; tail: Block } | null;
}

export function layoutScreenplay(doc: Document, options: ScreenplayOptions = {}): Layout {
  const previous = active;
  active = options.template ?? SCREENPLAY;
  try {
    return layout(doc, options);
  } finally {
    active = previous;
  }
}

function layout(doc: Document, options: ScreenplayOptions): Layout {
  const S = active;
  const ctx: InlineContext = { series: seriesCounter(), date: options.date ?? new Date() };
  // Measured (StartTest1 vs StartTest2): when the text starts with an empty line, directive lines
  // at the top of the first page print as an empty line instead of vanishing.
  const leadingBlank = /^[ \t]*\r?\n/.test(doc.source);
  const blocks = toBlocks(options.elements ?? doc.elements, doc.source, ctx, leadingBlank, options.sourceOf ?? ((e) => e.span));
  const pages: Page[] = [];

  if (doc.titlePage && options.titlePage !== false) pages.push(titlePage(doc.titlePage.fields, ctx));

  // Running state for headers and footers.
  let header: PageTextDirective | null = null;
  let footer: PageTextDirective | null = null;
  let section = "";
  let nextNumber = 1;

  const body: OpenPage[] = [];
  let page: OpenPage | null = null;
  const newPage = (): OpenPage => {
    // The page being left gets the footer in effect at its end (FirstLineTests case K).
    if (page !== null) (page as OpenPage).footer = footer;
    const p: OpenPage = { rows: [], header, footer, section, number: nextNumber++, started: false, touched: false, content: false };
    page = p;
    body.push(p);
    return p;
  };
  const current = (): OpenPage => page ?? newPage();
  const apply = (b: Block): void => {
    for (const d of b.directives ?? []) {
      if (d.kind === "header") header = d;
      else if (d.kind === "footer") footer = d;
      else if (d.kind === "pageNumber" && d.value !== null) {
        // Renumbers the current page (if nothing printed yet, the page about to start) and those after.
        const p = page as OpenPage | null;
        if (p !== null) {
          p.number = d.value;
          nextNumber = d.value + 1;
        } else nextNumber = d.value;
      }
    }
    if (b.section !== undefined) section = b.section;
  };
  const capacity = (_p: OpenPage): number => (footer !== null && !footer.off ? S.linesPerPage - 1 : S.linesPerPage);
  const start = (p: OpenPage): void => {
    if (p.started) return;
    p.started = true;
    p.header = header;
    p.section = section;
  };
  const push = (p: OpenPage, rows: Row[], space: number, content: boolean): void => {
    if (p.content) for (let k = 0; k < space; k++) p.rows.push(null);
    for (const row of rows) {
      // A page's header and footer are the ones in effect at its first printed line.
      if (row.items.length) start(p);
      p.rows.push(row);
    }
    if (content) p.content = true;
  };

  // The kind of the last block printed whole (see startsOnLast below).
  let previousKind: Block["kind"] | null = null;
  for (let i = 0; i < blocks.length; i++) {
    let b = blocks[i]!;
    if (b.pageBreak) {
      // "===" is a paragraph too: after a full page it first spills onto an empty page (SpeechFitTests).
      const p = page as OpenPage | null;
      if (p !== null && p.content && p.rows.length + 1 > capacity(p)) newPage().touched = true;
      const q = page as OpenPage | null;
      if (q !== null && (q.rows.length > 0 || q.touched)) newPage();
      continue;
    }
    apply(b);
    if (b.ghost) {
      // SpeechFitTests: a note after a full page starts a new (empty) page.
      const p = page as OpenPage | null;
      if (p !== null && p.content && p.rows.length + 1 > capacity(p)) newPage().touched = true;
      continue;
    }
    if (b.rows.length === 0) continue;
    if (b.filler && !(b.content ?? false)) {
      const p = current();
      if (p.rows.length + b.rows.length <= capacity(p)) push(p, b.rows, 0, false);
      continue;
    }
    for (;;) {
      tag(b.rows, b.range);
      let p = current();
      const space = p.content ? b.space : 0;
      const available = capacity(p) - p.rows.length - space;
      let need = p.content ? (b.fitRows ?? b.rows.length) : b.rows.length;
      if (b.keepWithNext) {
        const next = blocks.slice(i + 1).find((n) => n.rows.length > 0 && !n.pageBreak && !n.filler);
        if (next) need += next.space + minHead(next);
      }
      // A transition never sits on the last line (Highland moves it to the next page).
      if (b.kind === "transition") need += 1;
      const lastLine = need === available && b.lastLineOk === false;
      // An action after an action never starts on line 55 (GraphicNovelProbe and StagePlayProbe,
      // page D: a run of one-line actions stops at line 54; with a footer, line 54 is fine). After a
      // speech it may (Astounding p. 28). The rule behind this is not known; this is what was seen.
      const startsOnLast = b.kind === "action" && previousKind === "action" && p.content && p.rows.length + space === S.linesPerPage - 1;
      if (need <= available && !lastLine && !startsOnLast) {
        push(p, b.rows, space, true);
        previousKind = b.kind;
        break;
      }
      const room = lastLine || startsOnLast ? available - 1 : available;
      const split = p.content && room > 0 ? b.split?.(room) : null;
      if (split) {
        push(p, tag(split.head, b.range), space, true);
        previousKind = b.kind;
        newPage();
        split.tail.range = b.range;
        b = split.tail;
        continue;
      }
      if (p.content) {
        newPage();
        continue;
      }
      // Taller than an empty page: split anywhere it can, else cut at the page end.
      const forced = b.split?.(available);
      if (forced) {
        push(p, tag(forced.head, b.range), 0, true);
        previousKind = b.kind;
        newPage();
        forced.tail.range = b.range;
        b = forced.tail;
        continue;
      }
      for (const row of b.rows) {
        if (p.rows.length >= capacity(p)) p = newPage();
        push(p, [row], 0, true);
      }
      previousKind = b.kind;
      break;
    }
  }

  if (page !== null) (page as OpenPage).footer = footer;
  const last = body.at(-1)?.number ?? 0;
  const printed: { range: SourceRange | undefined; items: PlacedText[] }[] = [];
  for (const p of body) {
    const items: PlacedText[] = [];
    p.rows.forEach((row, k) => {
      if (!row) return;
      const line: PlacedText[] = [];
      for (const it of row.items) if (it.runs.length) line.push({ x: it.x, y: S.firstLineY + k * S.lineHeight + (it.dy ?? 0), runs: it.runs });
      if (line.length) printed.push({ range: row.range, items: line });
      items.push(...line);
    });
    const fill = (parts: PageTextPart[] | null) => (parts ? parts.map((t) => (t.kind === "text" ? t.text : t.kind === "page" ? String(p.number) : t.kind === "pageCount" ? String(last) : p.section)).join("") : "");
    for (const [d, pos] of [
      [p.header, S.header],
      [p.footer, S.footer],
    ] as const) {
      if (!d || d.off) continue;
      items.push(...pageText(d.slots, fill, pos));
    }
    // Without a {{HEADER}}, Highland numbers pages "2." onwards at the top right (SpeechFitTests).
    if (p.header === null && p.number >= 2) items.push(...pageText({ left: null, center: null, right: [{ kind: "text", text: `${p.number}.` }] }, fill, S.header));
    pages.push({ number: p.number, items });
  }
  assignSources(printed);
  for (const it of pages[0]?.number === null ? pages[0].items : []) it.source = 0;
  return { width: S.width, height: S.height, pages };
}

function tag(rows: Row[], range: SourceRange | undefined): Row[] {
  for (const r of rows) r.range ??= range;
  return rows;
}

/** The fewest rows a block needs on a page: all of it, or its smallest allowed first part. */
function minHead(b: Block): number {
  for (let a = 1; a <= active.linesPerPage; a++) {
    if (b.rows.length <= a) return b.rows.length;
    const s = b.split?.(a);
    if (s) return s.head.length;
  }
  return b.rows.length;
}

export function pageText(slots: PageTextSlots, fill: (p: PageTextPart[] | null) => string, pos: { y: number; left: number; centre: number; right: number }): PlacedText[] {
  const out: PlacedText[] = [];
  const add = (text: string, x: number) => {
    if (text.trim()) out.push({ x, y: pos.y, runs: [{ text, style: {} }] });
  };
  const l = fill(slots.left);
  const c = fill(slots.center);
  const r = fill(slots.right);
  add(l, pos.left);
  add(c, pos.centre - (c.length * CHAR) / 2);
  add(r, pos.right - r.length * CHAR);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Elements to blocks

function toBlocks(elements: Element[], source: string, ctx: InlineContext, leadingBlank: boolean, sourceOf: (e: Element) => SourceRange): Block[] {
  const S = active;
  const out: Block[] = [];
  const at = (x: number, runs: Run[]): Row => ({ items: [{ x, runs }] });
  const wrapAt = (x: number, runs: Run[], width: number): Row[] => wrapRuns(runs, width).map((r) => at(x, r));
  let printed = false;
  let nextIndex = 0;

  for (let i = 0; i < elements.length; i++) {
    const e = elements[i]!;
    const before = out.length;
    addElement(e, i);
    // Each extra empty source line before an element is an empty paragraph to Highland: one line
    // plus its own blank (Astounding: two empty lines before ">**END**<" print as three).
    const added = out[before];
    if (added && added.rows.length > 0 && !added.filler && e.span.start <= source.length) added.space += 2 * extraBlankLines(source, e.span.start);
    const first = sourceOf(e);
    const range = nextIndex > i ? { start: first.start, end: sourceOf(elements[nextIndex]!).end } : first;
    for (const b of out.slice(before)) b.range = range;
    i = nextIndex;
  }
  return out;

  function addElement(e: Element, i: number): void {
    nextIndex = i;
    switch (e.kind) {
      case "sceneHeading": {
        const runs = toRuns(e.inline, ctx, { bold: true });
        const rows = wrapAt(S.sceneHeading.x, runs, S.sceneHeading.width);
        if (e.sceneNumber && rows[0]) {
          const n: Run[] = [{ text: e.sceneNumber.text, style: { bold: true } }];
          rows[0].items.unshift({ x: S.sceneNumberLeft, runs: n });
          rows[0].items.push({ x: S.sceneNumberRight, runs: n });
        }
        // Two blank lines before a scene heading, but one when it follows the previous element
        // without a blank line in the source (">CUT TO:" directly above it, in Astounding).
        const prevEl = elements[i - 1];
        const joined = prevEl !== undefined && sameParagraph(source, prevEl, e);
        out.push({ kind: e.kind, rows, space: joined ? 1 : 2, keepWithNext: true });
        printed = true;
        break;
      }
      case "action": {
        const runs = toRuns(e.inline, ctx);
        if (plain(runs).trim() === "") {
          // Only notes (or inline directives): prints nothing, but still a paragraph to Highland.
          if (printed) out.push({ kind: e.kind, rows: [], space: 1, ghost: true });
          break;
        }
        out.push(actionBlock(caps(runs), 1));
        printed = true;
        break;
      }
      case "lyric": {
        const runs = caps(toRuns(e.inline, ctx, { italic: true }));
        // Consecutive lyric lines print as one block.
        const prev = out.at(-1);
        const rows = wrapAt(S.action.x, runs, S.action.width);
        if (prev?.kind === "lyric" && elements[i - 1]?.kind === "lyric" && sameParagraph(source, elements[i - 1]!, e)) prev.rows.push(...rows);
        else out.push({ kind: e.kind, rows, space: 1 });
        printed = true;
        break;
      }
      case "transition": {
        const text = plain(toRuns(e.inline, ctx)).trim().toUpperCase();
        out.push({ kind: e.kind, rows: [at(S.rightEdge - text.length * CHAR, [{ text, style: {} }])], space: 1 });
        printed = true;
        break;
      }
      case "centered":
      case "rightAligned": {
        const runs = caps(toRuns(e.inline, ctx));
        const rows = wrapRuns(runs, S.sceneHeading.width).map((r) => {
          const len = plain(r).length * CHAR;
          return at(e.kind === "centered" ? S.centre - len / 2 : S.rightEdge - len, r);
        });
        const prev = out.at(-1);
        // Adjacent centred / right-aligned lines (one paragraph) print without a blank between.
        if (prev && (prev.kind === "centered" || prev.kind === "rightAligned") && elements[i - 1] && sameParagraph(source, elements[i - 1]!, e)) prev.rows.push(...rows);
        else out.push({ kind: e.kind, rows, space: 1 });
        printed = true;
        break;
      }
      case "dialogue": {
        const next = elements[i + 1];
        if (e.dual === "left" && next?.kind === "dialogue" && next.dual === "right") {
          const rows = dualRows(e, next, ctx);
          out.push({ kind: "dialogue", rows, space: 1, fitRows: rows.sumOfColumns });
          nextIndex = i + 1;
        } else out.push(dialogueBlock(cueText(e), e.parts.map((p) => ({ kind: p.kind, runs: p.kind === "empty" ? [] : toRuns(p.inline, ctx, p.kind === "lyric" ? { italic: true } : {}) })), 1));
        printed = true;
        break;
      }
      case "pageBreak":
        out.push({ kind: e.kind, rows: [], space: 0, pageBreak: true });
        break;
      case "directiveLine": {
        // A paragraph of directive lines (FirstLineTests): one line takes no space; n lines leave
        // n - 1 empty lines. If the text starts with an empty line, the first directive paragraph
        // before anything printed takes a line of its own (StartTest1, Astounding).
        const prev = out.at(-1);
        const directives = e.directives.map((d) => d.directive);
        if (prev?.kind === "directives" && prev.filler && elements[i - 1]?.kind === "directiveLine" && sameParagraph(source, elements[i - 1]!, e)) {
          prev.directives = [...(prev.directives ?? []), ...directives];
          prev.rows.push({ items: [] });
        } else {
          const content = leadingBlank && !printed;
          out.push({ kind: "directives", rows: content ? [{ items: [] }] : [], space: 1, directives, filler: true, content });
        }
        break;
      }
      case "section":
        if (S.printSections && e.text.trim()) {
          // Graphic Novel (GraphicNovelProbe): printed in place with a blank line before and after;
          // level 1 in capitals, bold, with a 2 pt rule under it; deeper levels plain.
          const first = e.level === 1;
          const runs: Run[] = [{ text: first ? e.text.trim().toUpperCase() : e.text.trim(), style: first ? { bold: true, rule: true } : {} }];
          out.push({ kind: "section", rows: wrapAt(S.sceneHeading.x, runs, S.sceneHeading.width), space: 1, section: e.text });
          printed = true;
        } else out.push({ kind: "directives", rows: [], space: 0, section: e.text });
        break;
      case "synopsis":
        if (printed) out.push({ kind: e.kind, rows: [], space: 1, ghost: true });
        break;
      default:
        break; // link definitions: not printed
    }
  }
}

/** Empty source lines directly before `offset`, beyond the usual one. */
export function extraBlankLines(source: string, offset: number): number {
  let i = offset;
  let n = 0;
  for (;;) {
    let j = i - 1;
    if (j >= 0 && source[j] === "\n") j--;
    if (j >= 0 && source[j] === "\r") j--;
    // j is now the last character of the previous line (or -1).
    let start = j;
    while (start >= 0 && source[start] !== "\n" && source[start] !== "\r") start--;
    const line = source.slice(start + 1, j + 1);
    if (j < 0 || line.trim() !== "" || i === 0) break;
    n++;
    i = start + 1;
  }
  return Math.max(0, n - 1);
}

/** An action paragraph; Highland splits it across pages only after a sentence. */
function actionBlock(runs: Run[], space: number): Block {
  const S = active;
  const rows = wrapRuns(runs, S.action.width).map((r) => ({ items: [{ x: S.action.x, runs: r }] }));
  const text = plain(runs);
  // Highland decides whether an action fits as if words longer than the line were not broken
  // (StagePlayProbe, page C: an action that prints as four lines, with a broken word, counted as
  // three and ended on line 55).
  const counted = unbrokenLines(text, S.action.width);
  return {
    kind: "action",
    rows,
    space,
    ...(counted !== rows.length ? { fitRows: counted } : {}),
    // SpeechFitTests: two lines may end on the page's last line, three may not.
    lastLineOk: counted <= 2,
    split: (available) => {
      // At a sentence, like Better Fountain: only blocks of four lines or more, keeping two lines on each
      // page. At a hard line break (separate source lines): anywhere (SpeechFitTests).
      let best: Run[][] | null = null;
      let cut = 0;
      for (const end of sentenceEnds(text)) {
        const head = wrapRuns(sliceRuns(runs, 0, end), S.action.width);
        if (head.length > available) break;
        const hard = text[end] === "\n";
        if (hard || (rows.length >= 4 && head.length >= 2 && wrapRuns(trimStartRuns(sliceRuns(runs, end)), S.action.width).length >= 2)) {
          best = head;
          cut = end;
        }
      }
      if (!best) return null;
      return { head: best.map((r) => ({ items: [{ x: S.action.x, runs: r }] })), tail: actionBlock(trimStartRuns(sliceRuns(runs, cut)), 0) };
    },
  };
}

/** Lines a text takes when words are wrapped at spaces but never broken (a longer word overflows its line). */
function unbrokenLines(text: string, width: number): number {
  let n = 0;
  for (const para of text.split("\n")) {
    let line = 0;
    n++;
    for (const word of para.split(" ").filter(Boolean)) {
      if (line > 0 && line + 1 + word.length > width) {
        n++;
        line = word.length;
      } else line += (line > 0 ? 1 : 0) + word.length;
    }
  }
  return n;
}

interface Part {
  kind: "parenthetical" | "line" | "lyric" | "empty";
  runs: Run[];
}

/**
 * A speech. Highland splits it only between parts or after a sentence, with at least one line
 * of dialogue before "(MORE)", and repeats the cue with "(CONT’D)" on the next page.
 */
function dialogueBlock(cue: string, parts: Part[], space: number): Block {
  const S = active;
  const rows = [{ items: [{ x: S.cue.x, runs: [{ text: cue, style: {} }] }] }, ...partRows(parts, null)];
  // SpeechFitTests and Astounding: a speech may end on the page's last line only if its text starts
  // there, or a sentence ends somewhere on the line above.
  const printedRows = rows.filter((r) => r.items.length > 0);
  const above = printedRows.at(-2) ?? rows[0]!;
  // Multi-Cam's double-spaced speeches never end on the last line (MultiCamProbe, page D).
  const lastLineOk = !S.doubleSpacedDialogue && (printedRows.length === 2 || above.items.some((it) => SENTENCE_END.test(plain(it.runs))));
  return {
    kind: "dialogue",
    rows,
    lastLineOk,
    space,
    split: (available) => {
      let best: { head: Row[]; tail: Part[] } | null = null;
      for (let k = 0; k < parts.length; k++) {
        const part = parts[k]!;
        const ends = part.kind === "line" ? [...sentenceEnds(plain(part.runs)), plain(part.runs).length] : [plain(part.runs).length];
        for (const end of ends) {
          const head = [...parts.slice(0, k), { kind: part.kind, runs: sliceRuns(part.runs, 0, end) }];
          const rest = trimStartRuns(sliceRuns(part.runs, end));
          const tail = [...(plain(rest).trim() ? [{ kind: part.kind, runs: rest }] : []), ...parts.slice(k + 1)];
          if (!tail.some((p) => p.kind !== "empty")) continue;
          if (!head.some((p) => p.kind === "line" || p.kind === "lyric")) continue;
          // A parenthetical goes with the line after it, never just before (MORE).
          if (head.at(-1)!.kind === "parenthetical" || head.at(-1)!.kind === "empty") continue;
          const headRows = partRows(head, null);
          if (1 + headRows.length + 1 > available) return best && { head: best.head, tail: dialogueBlock(contd(cue), best.tail, 0) };
          best = { head: [rows[0]!, ...headRows, { items: [{ x: S.more.x, runs: [{ text: "(MORE)", style: {} }] }] }], tail };
        }
      }
      return best && { head: best.head, tail: dialogueBlock(contd(cue), best.tail, 0) };
    },
  };
}

const SENTENCE_END = /[.?!]+[’”'")\]]*(\s|$)/;

function contd(cue: string): string {
  return /\(CONT['’]D\)/i.test(cue) ? cue : `${cue} (CONT’D)`;
}

function partRows(parts: Part[], side: "left" | "right" | null): Row[] {
  const S = active;
  const pos = side ? S.dual[side] : { parenthetical: S.parenthetical.x, dialogue: S.dialogue.x, dialogueWidth: S.dialogue.width, parentheticalWidth: S.parenthetical.width };
  const rows: Row[] = [];
  const double = S.doubleSpacedDialogue === true;
  const lines = (runs: Run[], x: number, width: number): void => {
    for (const line of wrapRuns(runs, width)) {
      if (double) rows.push({ items: [] }, { items: [{ x, runs: line, dy: -6 }] });
      else rows.push({ items: [{ x, runs: line }] });
    }
  };
  if (S.inlineParentheticals) parts = joinParentheticals(parts);
  for (const p of parts) {
    if (p.kind === "empty") {
      rows.push({ items: [] });
      continue;
    }
    if (p.kind === "parenthetical") {
      wrapRuns(p.runs, pos.parentheticalWidth, pos.parentheticalWidth - 1).forEach((line, k) => rows.push({ items: [{ x: pos.parenthetical + (k > 0 ? CHAR : 0), runs: line }] }));
    } else lines(p.runs, pos.dialogue, pos.dialogueWidth);
  }
  return rows;
}

/** Each parenthetical joined to the dialogue line after it, with a space (Multi-Cam); one with none after prints as a line. */
function joinParentheticals(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]!;
    const next = parts[k + 1];
    if (p.kind === "parenthetical" && next && (next.kind === "line" || next.kind === "lyric")) {
      out.push({ kind: next.kind, runs: [...p.runs, { text: " ", style: {} }, ...next.runs] });
      k++;
    } else out.push(p.kind === "parenthetical" ? { kind: "line", runs: p.runs } : p);
  }
  return out;
}

/** No blank line between two elements in the source (only true for elements of the same file). */
export function sameParagraph(source: string, a: Element, b: Element): boolean {
  if (b.span.start < a.span.end) return false;
  return !/\n[ \t]*(\r?\n|\r)/.test(source.slice(a.span.end, b.span.start));
}

function cueText(e: Extract<Element, { kind: "dialogue" }>): string {
  return [e.character, ...e.extensions].join(" ");
}

function dualRows(left: Extract<Element, { kind: "dialogue" }>, right: Extract<Element, { kind: "dialogue" }>, ctx: InlineContext): Row[] & { sumOfColumns: number } {
  const S = active;
  const side = (e: typeof left, s: "left" | "right"): Row[] => [
    { items: [{ x: S.dual[s].cue, runs: [{ text: cueText(e), style: {} }] }] },
    ...partRows(e.parts.map((p) => ({ kind: p.kind, runs: p.kind === "empty" ? [] : toRuns(p.inline, ctx, p.kind === "lyric" ? { italic: true } : {}) })), s),
  ];
  const l = side(left, "left");
  const r = side(right, "right");
  const n = Math.max(l.length, r.length);
  const rows: Row[] = [];
  for (let k = 0; k < n; k++) rows.push({ items: [...(l[k]?.items ?? []), ...(r[k]?.items ?? [])] });
  return Object.assign(rows, { sumOfColumns: l.length + r.length });
}

// ---------------------------------------------------------------------------------------------
// Title page

const CENTRED = ["title", "credit", "author", "authors", "source"];
/** Lines between centred fields: 5, except 3 from Credit to Author (FirstLineTests, StartTest2, Astounding). */
const gapBefore = (prev: string, name: string): number => (prev === "credit" && (name === "author" || name === "authors") ? 3 : 5);
const BOTTOM_RIGHT = ["draft date", "date", "revision"];
const BOTTOM_LEFT = ["contact", "contact info", "notes", "copyright"];

function titlePage(fields: TitleField[], ctx: InlineContext): Page {
  const T = active.title;
  const items: PlacedText[] = [];
  const lines = (f: TitleField): Run[][] =>
    f.values.flatMap((v) => (v.text.trim() === "" ? [[]] : wrapRuns(styledValue(v.text, ctx), T.width)));
  const get = (name: string) => fields.find((f) => f.name === name);

  let y = T.firstY;
  let prev = "";
  for (const name of CENTRED) {
    const f = get(name);
    if (!f) continue;
    if (prev) y += gapBefore(prev, name) * T.pitch;
    let ls = lines(f);
    while (ls.length && ls[0]!.length === 0) ls = ls.slice(1);
    ls.forEach((runs, k) => {
      if (k > 0) y += ls[k - 1]!.length === 0 ? T.blank : T.pitch;
      const len = plain(runs).length * CHAR;
      if (runs.length) items.push({ x: T.centre - len / 2, y, runs });
    });
    prev = name;
  }
  const stack = (names: string[], x: (len: number) => number) => {
    const ls = names.flatMap((n) => (get(n) ? lines(get(n)!).filter((r) => r.length) : []));
    ls.forEach((runs, k) => {
      const len = plain(runs).length * CHAR;
      items.push({ x: x(len), y: T.bottomY - (ls.length - 1 - k) * T.pitch, runs });
    });
  };
  stack(BOTTOM_RIGHT, (len) => T.right - len);
  stack(BOTTOM_LEFT, () => T.left);
  return { number: null, items };
}

/** Title page values take inline emphasis like body text. */
export function styledValue(text: string, ctx: InlineContext): Run[] {
  return toRuns(parseInline({ text, base: 0, offsets: null }), ctx);
}
