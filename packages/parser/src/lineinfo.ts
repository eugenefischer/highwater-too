import type { Line, Span } from "./ast.ts";
import { trimLogical } from "./logical.ts";
import { logicalText, type LogicalText } from "./overlays.ts";

/** A physical line seen through the overlays. */
export interface L {
  line: Line;
  /** Logical text of the line content (boneyards and revision tags removed), with the source mapping. */
  lt: LogicalText;
  /** `lt.text` without surrounding whitespace. */
  text: string;
  raw: string;
}

export function lineInfos(source: string, lines: Line[], hidden: Span[]): L[] {
  return lines.map((line) => {
    const lt = logicalText(source, line.content, hidden);
    return { line, lt, raw: lt.text, text: lt.text.trim() };
  });
}

export function trimmed(l: L): LogicalText {
  return trimLogical(l.lt);
}

export function spanOf(block: L[]): Span {
  return { start: block[0]!.line.content.start, end: block.at(-1)!.line.content.end };
}
