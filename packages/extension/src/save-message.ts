/** Reading the writing history's commit messages (no vscode, so it can be tested). */

/**
 * A save's message, "Save 2026-10-11 14:03, <note>, +120 words (4,567)", in parts: its kind, any
 * note, and the change in words and the count after it (missing for a join of two histories).
 */
export function parseSave(message: string): { kind: string; note: string; delta: string; words: string } {
  const first = message.split("\n")[0] ?? "";
  const kind = first.split(" ")[0] ?? "";
  let rest = first.replace(/^\S+ \d{4}-\d\d-\d\d \d\d:\d\d,? ?/, "");
  const m = /(?:^|, )([+−-])([\d,]+) words \(([\d,]+)\)$/.exec(rest);
  if (!m) return { kind, note: rest, delta: "", words: "" };
  rest = rest.slice(0, m.index);
  return { kind, note: rest, delta: `${m[1] === "+" ? "+" : "−"}${m[2]}`, words: m[3]! };
}
