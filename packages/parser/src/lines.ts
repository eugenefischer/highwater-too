import type { Line } from "./ast.ts";

/** Splits into physical lines, accepting \n, \r\n and \r. The last line has no terminator. */
export function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  const n = source.length;
  for (let i = 0; i < n; i++) {
    const c = source.charCodeAt(i);
    if (c === 10 || c === 13) {
      const contentEnd = i;
      if (c === 13 && source.charCodeAt(i + 1) === 10) i++;
      lines.push({ span: { start, end: i + 1 }, content: { start, end: contentEnd } });
      start = i + 1;
    }
  }
  lines.push({ span: { start, end: n }, content: { start, end: n } });
  return lines;
}

export function lineText(source: string, line: Line): string {
  return source.slice(line.content.start, line.content.end);
}

/**
 * Blank: only spaces and tabs, except a line of two or more spaces, which Fountain uses for an
 * intentional empty line inside dialogue.
 */
export function isBlank(text: string): boolean {
  return /^[ \t]*$/.test(text) && !/^ {2,}$/.test(text);
}
