import { findOverlays } from "@highwater/parser";

/** A text replacement plus where the selection should end up (offsets). */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Highland's emphasis keys: wraps the selection in `open`…`close`, or removes them when the
 * selection is already wrapped (inside or just outside the markers). With nothing selected,
 * inserts the pair and puts the cursor between them. Spaces at the ends of the selection are left
 * outside the markers.
 */
export function toggleWrap(text: string, start: number, end: number, open: string, close = open): TextEdit {
  // Spaces or line breaks at either end of the selection stay outside the markers: "**word **" isn't bold.
  if (/\S/.test(text.slice(start, end))) {
    while (/\s/.test(text[start]!)) start++;
    while (/\s/.test(text[end - 1]!)) end--;
  }
  const inner = text.slice(start, end);
  // A single-character marker must not be half of a longer run: "*" is not part of "**".
  const single = open.length === 1 && open === close;
  const outside =
    text.slice(start - open.length, start) === open &&
    text.slice(end, end + close.length) === close &&
    !(single && (text[start - 2] === open || text[end + 1] === open));
  if (end > start && outside) return { start: start - open.length, end: end + close.length, text: inner, selectionStart: start - open.length, selectionEnd: end - open.length };
  const wrapped =
    inner.length >= open.length + close.length &&
    inner.startsWith(open) &&
    inner.endsWith(close) &&
    !(single && inner.length >= 4 && inner[1] === open && inner[inner.length - 2] === open);
  if (wrapped) {
    const stripped = inner.slice(open.length, inner.length - close.length);
    return { start, end, text: stripped, selectionStart: start, selectionEnd: start + stripped.length };
  }
  return { start, end, text: open + inner + close, selectionStart: start + open.length, selectionEnd: end + open.length };
}

/**
 * Highland's Centre key: toggles "> line <" on every line touched by the selection.
 * Returns one edit covering those whole lines.
 */
export function toggleCentre(text: string, start: number, end: number): TextEdit {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  if (lineEnd < 0) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const centred = (l: string) => /^\s*>.*<\s*$/.test(l);
  const allCentred = lines.filter((l) => l.trim() !== "").every(centred);
  const out = lines
    .map((l) => {
      if (l.trim() === "") return l;
      if (allCentred) return l.replace(/^(\s*)>\s?/, "$1").replace(/\s?<(\s*)$/, "$1");
      return `> ${l.trim()} <`;
    })
    .join("\n");
  return { start: lineStart, end: lineEnd, text: out, selectionStart: lineStart, selectionEnd: lineStart + out.length };
}

/**
 * Highland's Omit key: wraps the selection in a boneyard, or the current line when nothing is
 * selected; removes the boneyard when the selection or cursor is inside one.
 */
export function toggleBoneyard(text: string, start: number, end: number): TextEdit {
  for (const b of findOverlays(text).overlays.boneyard) {
    if (b.span.start <= start && end <= b.span.end) {
      const inner = text.slice(b.inner.start, b.inner.end);
      return { start: b.span.start, end: b.span.end, text: inner, selectionStart: b.span.start, selectionEnd: b.span.start + inner.length };
    }
  }
  if (start === end) {
    start = text.lastIndexOf("\n", start - 1) + 1;
    end = text.indexOf("\n", end);
    if (end < 0) end = text.length;
  }
  const inner = text.slice(start, end);
  return { start, end, text: `/*${inner}*/`, selectionStart: start, selectionEnd: start + inner.length + 4 };
}

/** Text for export to .fountain or .md: the inline {{REVISION}} tags removed, as Highland does. */
export function stripRevisionTags(text: string): string {
  const spans = findOverlays(text).overlays.revisions.flatMap((r) => (r.closeTag ? [r.openTag, r.closeTag] : [r.openTag]));
  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const s of spans) {
    out += text.slice(at, s.start);
    at = s.end;
  }
  return out + text.slice(at);
}

/**
 * Upper or lower case (⌃U, ⌃⇧U): the selection, or with nothing selected the word at the cursor,
 * as VS Code's own commands do. The selection stays where it was.
 */
export function changeCase(text: string, start: number, end: number, upper: boolean): TextEdit {
  let from = start;
  let to = end;
  if (from === to) {
    const word = /[\p{L}\p{N}'’_-]/u;
    while (from > 0 && word.test(text[from - 1]!)) from--;
    while (to < text.length && word.test(text[to]!)) to++;
  }
  const inner = text.slice(from, to);
  return { start: from, end: to, text: upper ? inner.toUpperCase() : inner.toLowerCase(), selectionStart: start, selectionEnd: end };
}
