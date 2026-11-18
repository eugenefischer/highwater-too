import type { BoneyardRange, Diagnostic, Overlays, RevisionRange, Span } from "./ast.ts";

/** `{{REVISION: #rrggbb}}`, or a bare `{{REVISION}}` (Highland writes both; the bare one has no colour). */
const REVISION_OPEN = /\{\{\s*REVISION\s*(?::\s*([^}]*?))?\s*\}\}/iy;
const REVISION_CLOSE = /\{\{\s*\/\s*REVISION\s*\}\}/iy;

/**
 * Pass 1: finds boneyard ranges and revision tags anywhere in the source.
 * Boneyards do not nest (the first `*\/` closes). Revision tags inside a boneyard are ignored.
 * With `htmlComments` (Markdown), an HTML comment `<!-- … -->` is a boneyard too (EJ, 2026-11-18):
 * never printed, as Markdown apps (Typora, Obsidian, pandoc) don't show it either.
 */
export function findOverlays(source: string, options: { htmlComments?: boolean; frontMatter?: boolean } = {}): { overlays: Overlays; diagnostics: Diagnostic[] } {
  const html = options.htmlComments === true;
  const boneyard: BoneyardRange[] = [];
  const revisions: RevisionRange[] = [];
  const diagnostics: Diagnostic[] = [];
  let open: { color: string; tag: Span } | null = null;
  let i = 0;
  const n = source.length;
  // A Markdown file's YAML front matter (Typora, Obsidian, pandoc): hidden like a boneyard.
  const front = options.frontMatter ? frontMatterAt(source) : null;
  if (front) {
    boneyard.push({ span: front.span, inner: front.inner, frontMatter: true });
    i = front.span.end;
  }
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
    if (html && c === 60 /* < */ && source.startsWith("<!--", i)) {
      const close = source.indexOf("-->", i + 4);
      if (close < 0) {
        diagnostics.push({ severity: "warning", message: "HTML comment <!-- is never closed; treated as text", span: { start: i, end: i + 4 } });
        i += 4;
        continue;
      }
      boneyard.push({ span: { start: i, end: close + 3 }, inner: { start: i + 4, end: close } });
      i = close + 3;
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
  spans.sort((a, b) => a.start - b.start);
  // Merge overlaps (a revision tag inside a boneyard) so the ranges are disjoint and sorted by end too.
  const merged: Span[] = [];
  for (const sp of spans) {
    const last = merged.at(-1);
    if (last && sp.start <= last.end) last.end = Math.max(last.end, sp.end);
    else merged.push({ start: sp.start, end: sp.end });
  }
  return merged;
}

/**
 * Text of `span` with hidden ranges removed, plus each output character's source offset. Read
 * offsets with `offsetAt`: when nothing is hidden, `offsets` is null and offset k is `base + k`.
 */
export interface LogicalText {
  text: string;
  base: number;
  /** `offsets[k]` is the source offset of `text[k]`; `offsets[text.length]` is the source end. */
  offsets: number[] | null;
}

/** Source offset of logical character k (k = text.length gives the source end). */
export function offsetAt(lt: LogicalText, k: number): number {
  return lt.offsets === null ? lt.base + k : lt.offsets[k]!;
}

export function logicalText(source: string, span: Span, hidden: Span[]): LogicalText {
  // First hidden range that ends after the span starts (binary search; ranges are sorted and disjoint).
  let lo = 0;
  let hi = hidden.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hidden[mid]!.end <= span.start) lo = mid + 1;
    else hi = mid;
  }
  let h = lo;
  if (h >= hidden.length || hidden[h]!.start >= span.end) {
    // Fast path: nothing hidden in this span.
    return { text: source.slice(span.start, span.end), base: span.start, offsets: null };
  }
  const offsets: number[] = [];
  let text = "";
  let runStart = span.start;
  for (let i = span.start; i < span.end; ) {
    while (h < hidden.length && hidden[h]!.end <= i) h++;
    const range = hidden[h];
    if (range && range.start <= i) {
      text += source.slice(runStart, i);
      i = Math.min(range.end, span.end);
      runStart = i;
      continue;
    }
    offsets.push(i);
    i++;
  }
  text += source.slice(runStart, span.end);
  offsets.push(span.end);
  return { text, base: span.start, offsets };
}

/**
 * YAML front matter at the very top of a Markdown file (EJ, 2026-11-18; for files also edited in
 * Typora or Obsidian): a `---` line, YAML, and a closing `---` (or `...`) line. As in pandoc, the
 * line after the opening one isn't blank. Every line inside must look like YAML (`key: value`, an
 * indented line, a `- ` list item, a `#` comment or a blank line), so a manuscript that starts with
 * a `---` scene break and has another later is not taken for it. The span ends with the closing
 * line's text (its line break stays outside).
 */
export function frontMatterAt(source: string): { span: Span; inner: Span } | null {
  const start = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  // (Sticky, from `start`: `^` would only match at 0, before a byte-order mark.)
  const first = /---[ \t]*(?:\r?\n|$)/y;
  first.lastIndex = start;
  const open = first.exec(source);
  if (!open || !open[0].endsWith("\n")) return null;
  let at = start + open[0].length;
  const innerStart = at;
  let lines = 0;
  while (at < source.length) {
    const nl = source.indexOf("\n", at);
    const lineEnd = nl < 0 ? source.length : nl;
    const line = source.slice(at, lineEnd).replace(/\r$/, "");
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line)) {
      if (lines === 0) return null;
      // (From 0: a byte-order mark before it goes with it.)
      return { span: { start: 0, end: at + line.length }, inner: { start: innerStart, end: at } };
    }
    if (lines === 0 && line.trim() === "") return null;
    if (!(line.trim() === "" || /^[^\s:#-][^:]*:(?:[ \t]|$)/.test(line) || /^[ \t]+\S/.test(line) || /^-(?:[ \t]|$)/.test(line) || /^#/.test(line))) return null;
    lines++;
    if (nl < 0) break;
    at = nl + 1;
  }
  return null;
}
