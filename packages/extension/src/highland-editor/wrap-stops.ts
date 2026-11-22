import { EditorSelection } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

/**
 * Where a paragraph wraps after a space, the place just after the space is one place in the text
 * but shows in two: at the end of the line (after the space) and at the start of the next line.
 * CodeMirror's arrow keys move by places in the text, so each direction skipped one of the two
 * (EJ, 2026-11-22: Right from "his |" landed after the next line's first letter; Left from the
 * start of the line landed before the space). Now the arrow keys stop at both: Right at the end
 * of the line goes to the start of the next, Left at the start of a line goes to the end of the one
 * above, and the next press moves on as usual.
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
  if (!atSpaceWrap(v, head)) return false;
  // A whole EditorSelection: a bare range would be read as {anchor, head} and lose its side.
  v.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(head, atEnd ? 1 : -1)]), scrollIntoView: true, userEvent: "select" });
  return true;
}

/** Just after a space where the paragraph wraps onto another line. */
export function atSpaceWrap(v: EditorView, pos: number): boolean {
  if (pos <= 0 || pos >= v.state.doc.length) return false;
  const before = v.state.sliceDoc(pos - 1, pos);
  if (before !== " " && before !== "\t") return false;
  const a = v.coordsAtPos(pos, -1);
  const b = v.coordsAtPos(pos, 1);
  return !!a && !!b && b.top - a.top > v.defaultLineHeight / 2;
}
