import type { Document, Element } from "@highwater/parser";

/**
 * Live Margins: Highland shows a screenplay shaped like the page (cues, dialogue and
 * parentheticals indented, transitions right-aligned) and a manuscript with indented paragraphs.
 * Each entry indents one source line, starting at offset `at`, by `indent` characters.
 */
export interface MarginIndent {
  at: number;
  indent: number;
}

/** Indents in characters from the action margin, as Highland shows them (approximate, from screenshots). */
export const MARGINS = { cue: 21, parenthetical: 15, dialogue: 11, width: 63, paragraph: 5, manuscriptWidth: 65 } as const;

export function liveMargins(doc: Document): MarginIndent[] {
  const out: MarginIndent[] = [];
  const src = doc.source;
  const lineText = (start: number, end: number) => src.slice(start, end).replace(/\r$/, "");
  let afterParagraph = false;
  for (const e of doc.elements) {
    switch (e.kind) {
      case "dialogue": {
        const first = e.lines[0];
        if (first) out.push({ at: first.span.start, indent: MARGINS.cue });
        for (const p of e.parts) out.push({ at: p.line.span.start, indent: p.kind === "parenthetical" ? MARGINS.parenthetical : MARGINS.dialogue });
        break;
      }
      case "transition":
      case "centered":
      case "rightAligned":
        for (const l of e.lines) {
          const text = lineText(l.span.start, l.span.end).trim();
          const width = doc.mode === "fountain" ? MARGINS.width : MARGINS.manuscriptWidth;
          const room = Math.max(0, width - text.length);
          out.push({ at: l.span.start, indent: e.kind === "centered" ? Math.floor(room / 2) : room });
        }
        break;
      case "paragraph":
        if (afterParagraph) out.push({ at: e.span.start, indent: MARGINS.paragraph });
        break;
      case "blockQuote":
        for (const l of e.lines) out.push({ at: l.span.start, indent: MARGINS.paragraph });
        break;
      case "sceneBreak": {
        const l = e.lines[0];
        if (l) out.push({ at: l.span.start, indent: Math.floor((MARGINS.manuscriptWidth - lineText(l.span.start, l.span.end).trim().length) / 2) });
        break;
      }
      default:
        break;
    }
    afterParagraph = continuesParagraphs(e, afterParagraph);
  }
  return out;
}

/** As in the printed manuscript: a paragraph after a paragraph is indented; notes and directives don't interrupt. */
function continuesParagraphs(e: Element, before: boolean): boolean {
  if (e.kind === "paragraph") return true;
  if (e.kind === "directiveLine" || e.kind === "linkDefinition" || e.kind === "synopsis") return before;
  return false;
}
