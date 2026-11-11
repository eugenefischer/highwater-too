import { inlineText, type Document, type Element, type Inline } from "@highwater/parser";

/** Highland's reading speed for prose. */
export const READING_WPM = 250;

export interface DocumentStats {
  words: number;
  /** Characters of printed text, spaces included (Highland's count at the foot of its editor). */
  characters: number;
  /** Estimated printed pages (the PDF engine gives the exact count later). */
  pages: number;
  /** Screenplays: about a minute a page. Prose: reading time at 250 words a minute, as Highland counts it. */
  minutes: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  let n = 0;
  for (const _ of text.matchAll(WORD)) n++;
  return n;
}

/** Visible text only: no notes, boneyards, sections, synopses, directives or title page. */
export function printedText(e: Element): string[] {
  const t = (inline: Inline[]) => plain(inline);
  switch (e.kind) {
    case "sceneHeading":
    case "action":
    case "transition":
    case "centered":
    case "rightAligned":
    case "lyric":
    case "heading":
    case "paragraph":
      return [t(e.inline)];
    case "dialogue":
      return [e.character, ...e.parts.flatMap((p) => (p.kind === "empty" ? [] : [t(p.inline)]))];
    case "blockQuote":
      return e.paragraphs.map((p) => t(p.inline));
    case "list":
      return e.items.map((i) => t(i.inline));
    case "termList":
      return e.items.map((i) => `${t(i.termInline)} ${t(i.definitionInline)}`);
    case "table":
      return [e.header, ...e.rows].map((row) => row.map((c) => t(c.inline)).join(" "));
    default:
      return [];
  }
}

function plain(inline: Inline[]): string {
  return inlineText(inline.filter((n) => n.kind !== "directive"));
}

/** Lines needed to print `text` wrapped at word boundaries, `width` characters to a line. */
function wrapped(text: string, width: number): number {
  let lines = 0;
  for (const line of text.split("\n")) {
    let count = 1;
    let used = 0;
    for (const word of line.trim().split(/\s+/)) {
      if (word === "") continue;
      if (used === 0) used = word.length;
      else if (used + 1 + word.length <= width) used += 1 + word.length;
      else {
        count++;
        used = word.length;
      }
      while (used > width) {
        count++;
        used -= width;
      }
    }
    lines += count;
  }
  return lines;
}

export function documentStats(doc: Document): DocumentStats {
  let words = 0;
  let characters = 0;
  for (const e of doc.elements)
    for (const s of printedText(e)) {
      words += countWords(s);
      characters += s.length;
    }
  if (doc.mode === "fountain") {
    // Screenplay layout (measured from Highland): 54 lines a page, action 61 characters wide,
    // dialogue 35, parentheticals 28; one blank line between elements, two before scene headings.
    let lines = 0;
    for (const e of doc.elements) {
      const before = lines === 0 ? 0 : e.kind === "sceneHeading" ? 2 : 1;
      switch (e.kind) {
        case "sceneHeading":
        case "transition":
        case "centered":
        case "rightAligned":
          lines += before + 1;
          break;
        case "action":
        case "lyric":
          lines += before + wrapped(plain(e.inline), 61);
          break;
        case "dialogue":
          lines += before + 1 + e.parts.reduce((n, p) => n + (p.kind === "empty" ? 1 : wrapped(plain(p.inline), p.kind === "parenthetical" ? 28 : 35)), 0);
          break;
        case "pageBreak":
          lines = Math.ceil(lines / 54) * 54;
          break;
        default:
          break;
      }
    }
    const pages = Math.max(lines > 0 ? 1 : 0, Math.ceil(lines / 54));
    return { words, characters, pages, minutes: pages };
  }
  // Manuscript layout (measured): 65 characters a line, double-spaced at 28.32 pt, so 22 whole lines a page.
  let lines = 0;
  for (const e of doc.elements) {
    if (e.kind === "pageBreak") {
      lines = Math.ceil(lines / 22) * 22;
      continue;
    }
    for (const s of printedText(e)) lines += wrapped(e.kind === "paragraph" ? `     ${s}` : s, e.kind === "list" ? 60 : 65);
    if (e.kind === "heading") lines += 1;
    if (e.kind === "sceneBreak") lines += 1;
  }
  const pages = Math.max(lines > 0 ? 1 : 0, Math.ceil(lines / 22));
  return { words, characters, pages, minutes: Math.max(words > 0 ? 1 : 0, Math.round(words / READING_WPM)) };
}
