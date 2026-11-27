import { EditorSelection } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

/**
 * Where a paragraph wraps, the place at the wrap is one place in the text but shows in two: at the
 * end of the line and at the start of the next. CodeMirror's arrow keys move by places in the text,
 * so each direction skipped one of the two (EJ, 2026-11-22: Right from "his |" landed after the next
 * line's first letter; Left from the start of the line landed before the space). Now the arrow keys
 * stop at both: Right at the end of the line goes to the start of the next, Left at the start of a
 * line goes to the end of the one above, and the next press moves on as usual.
 *
 * This holds at every wrap, whatever comes before it: a space, or a dash, a hyphen or a long word
 * the line breaks after with no space (EJ, 2026-11-27: "a seat —whatever" wrapping after the dash
 * still skipped; 0.6.78 had looked only at wraps after a space).
 */
export const wrapStops = keymap.of([
  { key: "ArrowRight", run: (v) => step(v, 1) },
  { key: "ArrowLeft", run: (v) => step(v, -1) },
]);

function step(v: EditorView, dir: 1 | -1): boolean {
  const sel = v.state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return false;
  const { head, assoc } = sel.main;
  // assoc -1 shows the cursor at the end of the line above; otherwise it shows at the start of the line.
  const atEnd = assoc < 0;
  if (dir === 1 ? !atEnd : atEnd) return false;
  if (!atWrap(v, head)) return false;
  // A whole EditorSelection: a bare range would be read as {anchor, head} and lose its side.
  v.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(head, atEnd ? 1 : -1)]), scrollIntoView: true, userEvent: "select" });
  return true;
}

/**
 * A place where the paragraph wraps onto another line: the same place in the text shows at the end
 * of one line and the start of the next. Not the start or end of a paragraph (a line break of the
 * text's own), only a wrap inside one.
 */
export function atWrap(v: EditorView, pos: number): boolean {
  const line = v.state.doc.lineAt(pos);
  if (pos <= line.from || pos >= line.to) return false;
  const a = v.coordsAtPos(pos, -1);
  const b = v.coordsAtPos(pos, 1);
  return !!a && !!b && b.top - a.top > v.defaultLineHeight / 2;
}
