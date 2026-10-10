import type { BoneyardRange, Diagnostic, Overlays, RevisionRange, Span } from "./ast.ts";

const REVISION_OPEN = /\{\{\s*REVISION\s*:\s*([^}]*?)\s*\}\}/iy;
const REVISION_CLOSE = /\{\{\s*\/\s*REVISION\s*\}\}/iy;

/**
 * Pass 1: finds boneyard ranges and revision tags anywhere in the source.
 * Boneyards do not nest (the first `*\/` closes). Revision tags inside a boneyard are ignored.
 */
export function findOverlays(source: string): { overlays: Overlays; diagnostics: Diagnostic[] } {
  const boneyard: BoneyardRange[] = [];
  const revisions: RevisionRange[] = [];
  const diagnostics: Diagnostic[] = [];
  let open: { color: string; tag: Span } | null = null;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source.charCodeAt(i);
    if (c === 47 /* / */ && source.charCodeAt(i + 1) === 42 /* * */) {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) {
        diagnostics.push({ severity: "warning", message: "Boneyard /* is never closed; treated as text", span: { start: i, end: i + 2 } });
        i += 2;
        continue;
      }
      boneyard.push({ span: { start: i, end: close + 2 }, inner: { start: i + 2, end: close } });
      i = close + 2;
      continue;
    }
    if (c === 123 /* { */ && source.charCodeAt(i + 1) === 123) {
      REVISION_OPEN.lastIndex = i;
      const o = REVISION_OPEN.exec(source);
      if (o) {
        const tag = { start: i, end: i + o[0].length };
        if (open) {
          // A new revision starts before the previous one closed: close the previous one here.
          revisions.push({ color: open.color, openTag: open.tag, closeTag: null, content: { start: open.tag.end, end: i } });
          diagnostics.push({ severity: "warning", message: "Revision is not closed before the next one starts", span: open.tag });
        }
        open = { color: o[1] ?? "", tag };
        i = tag.end;
        continue;
      }
      REVISION_CLOSE.lastIndex = i;
      const cl = REVISION_CLOSE.exec(source);
      if (cl) {
        const tag = { start: i, end: i + cl[0].length };
        if (open) {
          revisions.push({ color: open.color, openTag: open.tag, closeTag: tag, content: { start: open.tag.end, end: i } });
          open = null;
        } else {
          diagnostics.push({ severity: "warning", message: "{{/REVISION}} without a matching {{REVISION}}", span: tag });
        }
        i = tag.end;
        continue;
      }
    }
    i++;
  }
  if (open) {
    revisions.push({ color: open.color, openTag: open.tag, closeTag: null, content: { start: open.tag.end, end: n } });
    diagnostics.push({ severity: "warning", message: "Revision is never closed", span: open.tag });
  }
  return { overlays: { boneyard, revisions }, diagnostics };
}

/** Source ranges that do not count as text: boneyards and revision tags (not the revised text). */
export function hiddenRanges(overlays: Overlays): Span[] {
  const spans: Span[] = [...overlays.boneyard.map((b) => b.span)];
  for (const r of overlays.revisions) {
    spans.push(r.openTag);
    if (r.closeTag) spans.push(r.closeTag);
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Text of `span` with hidden ranges removed, plus each output character's source offset. */
export interface LogicalText {
  text: string;
  /** `offsets[k]` is the source offset of `text[k]`; `offsets[text.length]` is the source end. */
  offsets: number[];
}

export function logicalText(source: string, span: Span, hidden: Span[]): LogicalText {
  let text = "";
  const offsets: number[] = [];
  let h = 0;
  for (let i = span.start; i < span.end; ) {
    while (h < hidden.length && hidden[h]!.end <= i) h++;
    const range = hidden[h];
    if (range && range.start <= i) {
      i = range.end;
      continue;
    }
    text += source[i];
    offsets.push(i);
    i++;
  }
  offsets.push(span.end);
  return { text, offsets };
}
