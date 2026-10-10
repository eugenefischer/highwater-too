import { offsetAt, type LogicalText } from "./overlays.ts";

/** A sub-range [from, to) of a logical text, keeping the source mapping. */
export function sliceLogical(lt: LogicalText, from: number, to = lt.text.length): LogicalText {
  const text = lt.text.slice(from, to);
  if (lt.offsets === null) return { text, base: lt.base + from, offsets: null };
  const offsets = lt.offsets.slice(from, to);
  offsets.push(lt.offsets[Math.min(to, lt.offsets.length - 1)]!);
  return { text, base: offsetAt(lt, from), offsets };
}

/** Trims whitespace at both ends. */
export function trimLogical(lt: LogicalText): LogicalText {
  const start = lt.text.length - lt.text.trimStart().length;
  const end = lt.text.trimEnd().length;
  return start >= end ? sliceLogical(lt, start, start) : sliceLogical(lt, start, end);
}

/** Removes a leading match of `re` (anchored at the start of the trimmed text). */
export function stripStart(lt: LogicalText, re: RegExp): LogicalText {
  const t = trimLogical(lt);
  const m = re.exec(t.text);
  return m && m.index === 0 ? trimLogical(sliceLogical(t, m[0].length)) : t;
}

/** Removes a trailing match of `re` (anchored at the end of the trimmed text). */
export function stripEnd(lt: LogicalText, re: RegExp): LogicalText {
  const t = trimLogical(lt);
  const m = new RegExp(`(?:${re.source})$`, re.flags.replace("g", "")).exec(t.text);
  return m && m.index + m[0].length === t.text.length ? trimLogical(sliceLogical(t, 0, m.index)) : t;
}
