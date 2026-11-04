/**
 * The Highland-Style Editor's page holds the text with "\n" line breaks (CodeMirror normalises
 * them), so in a file with "\r\n" breaks its offsets differ from the document's by one per line.
 * The extension converts through line and character, which both agree on. Pure, for tests.
 */

/** The text as the page holds it. */
export function pageForm(text: string): string {
  return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

/** Line and character of an offset in "\n"-only text. */
export function lineAndCharacter(text: string, offset: number): { line: number; character: number } {
  const at = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let start = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < at; i = text.indexOf("\n", i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, character: at - start };
}

/** The offset of a line and character in "\n"-only text (clamped to the line and the text). */
export function offsetOf(text: string, line: number, character: number): number {
  let start = 0;
  for (let n = 0; n < line; n++) {
    const nl = text.indexOf("\n", start);
    if (nl < 0) return text.length;
    start = nl + 1;
  }
  const end = text.indexOf("\n", start);
  return start + Math.max(0, Math.min(character, (end < 0 ? text.length : end) - start));
}
