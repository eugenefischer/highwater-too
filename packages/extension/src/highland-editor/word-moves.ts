/**
 * Words in the Highwater Editor by Highwater's one rule (@highwater/parser words.ts): "don’t" and
 * "O'BRIEN" are single words, as on a Mac and in spelling, Upper/Lower Case and VS Code's word
 * pattern. CodeMirror decides words a character at a time, so on its own it split them at the
 * apostrophe (EJ, 2026-11-28 audit). Here its word commands (⌥← ⌥→ and with ⇧, ⌥⌫ ⌥⌦, ⌃⌥H; Ctrl
 * on other systems) and double-click use the rule; otherwise they behave as CodeMirror's: a move
 * passes spaces, then one run of word or other characters; a line break counts as a space.
 */
import { EditorSelection, type EditorState, type SelectionRange } from "@codemirror/state";
import { EditorView, type Command, type KeyBinding } from "@codemirror/view";
import { cursorGroupBackward, cursorGroupForward, cursorGroupLeft, cursorGroupRight, deleteGroupBackward, deleteGroupForward, selectGroupBackward, selectGroupForward, selectGroupLeft, selectGroupRight } from "@codemirror/commands";
import { wordCharAt } from "@highwater/parser";

type Kind = "word" | "space" | "other";

/** The kind of the character at `i` (null outside the text). */
export function kindAt(state: EditorState, i: number): Kind | null {
  const len = state.doc.length;
  if (i < 0 || i >= len) return null;
  // A few characters around it decide (an apostrophe looks at its neighbours, a surrogate at its pair).
  const from = Math.max(0, i - 2);
  const text = state.sliceDoc(from, Math.min(len, i + 3));
  const c = text[i - from]!;
  if (/\s/.test(c)) return "space";
  return wordCharAt(text, i - from) ? "word" : "other";
}

/** Where a word move from `pos` ends: past any spaces, then one run of one kind (as CodeMirror's byGroup). */
export function groupEnd(state: EditorState, pos: number, forward: boolean): number {
  let kind: Kind | null = null;
  let i = pos;
  for (;;) {
    const k = kindAt(state, forward ? i : i - 1);
    if (k === null) return i;
    if (kind === null) kind = k;
    else if (kind === "space" && k !== "space") kind = k;
    else if (k !== kind) return i;
    i += forward ? 1 : -1;
  }
}

/** Where a word deletion from `pos` ends: as CodeMirror's deleteByGroup, which stops at the line's edge. */
function deleteEnd(state: EditorState, pos: number, forward: boolean): number {
  const line = state.doc.lineAt(pos);
  const edge = forward ? line.to : line.from;
  if (pos === edge) return line.number === (forward ? state.doc.lines : 1) ? pos : pos + (forward ? 1 : -1);
  let kind: Kind | null = null;
  let i = pos;
  while (i !== edge) {
    const k = kindAt(state, forward ? i : i - 1)!;
    if (kind !== null && k !== kind) break;
    // One space next to the cursor goes with the word after it.
    if (!(k === "space" && i === pos && state.sliceDoc(forward ? i : i - 1, forward ? i + 1 : i) === " ")) kind = k;
    i += forward ? 1 : -1;
  }
  return i;
}

const move = (forward: boolean, extend: boolean): Command => (view) => {
  const sel = view.state.selection;
  const next = EditorSelection.create(
    sel.ranges.map((r: SelectionRange) => {
      if (extend) return EditorSelection.range(r.anchor, groupEnd(view.state, r.head, forward));
      if (!r.empty) return EditorSelection.cursor(forward ? r.to : r.from);
      return EditorSelection.cursor(groupEnd(view.state, r.head, forward), forward ? -1 : 1);
    }),
    sel.mainIndex,
  );
  if (next.eq(sel)) return false;
  view.dispatch({ selection: next, scrollIntoView: true, userEvent: "select" });
  return true;
};

const remove = (forward: boolean): Command => (view) => {
  const state = view.state;
  const tr = state.changeByRange((r) => {
    const from = r.empty ? Math.min(r.head, deleteEnd(state, r.head, forward)) : r.from;
    const to = r.empty ? Math.max(r.head, deleteEnd(state, r.head, forward)) : r.to;
    return { changes: { from, to }, range: EditorSelection.cursor(from) };
  });
  if (!tr.changes.length) return false;
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: forward ? "delete.forward" : "delete.backward" }));
  return true;
};

const REPLACE = new Map<Command, Command>([
  [cursorGroupLeft, move(false, false)],
  [cursorGroupBackward, move(false, false)],
  [cursorGroupRight, move(true, false)],
  [cursorGroupForward, move(true, false)],
  [selectGroupLeft, move(false, true)],
  [selectGroupBackward, move(false, true)],
  [selectGroupRight, move(true, true)],
  [selectGroupForward, move(true, true)],
  [deleteGroupBackward, remove(false)],
  [deleteGroupForward, remove(true)],
]);

/** The key bindings with CodeMirror's word commands replaced by these, whatever keys they are on. */
export function withWordRule(bindings: readonly KeyBinding[]): KeyBinding[] {
  return bindings.map((b) => {
    const out: KeyBinding = { ...b };
    if (b.run) out.run = REPLACE.get(b.run) ?? b.run;
    if (b.shift) out.shift = REPLACE.get(b.shift) ?? b.shift;
    return out;
  });
}

/** The run of one kind at the character `i` (a word, spaces, or other characters). */
function runAt(state: EditorState, i: number): { from: number; to: number } {
  const kind = kindAt(state, i);
  if (kind === null) return { from: i, to: i };
  let from = i;
  let to = i + 1;
  while (kindAt(state, from - 1) === kind && state.sliceDoc(from - 1, from) !== "\n") from--;
  while (kindAt(state, to) === kind && state.sliceDoc(to, to + 1) !== "\n") to++;
  return { from, to };
}

/** The character a click at these coordinates is on (the one before the line's end when past it). */
function clickedChar(view: EditorView, x: number, y: number): number | null {
  const pos = view.posAtCoords({ x, y });
  if (pos === null) return null;
  const line = view.state.doc.lineAt(pos);
  if (line.length === 0) return null;
  if (pos >= line.to) return line.to - 1;
  const box = view.coordsAtPos(pos, 1);
  return box && x < box.left && pos > line.from ? pos - 1 : pos;
}

/** Double-click selects the word (or run of spaces or other characters) under the pointer; dragging extends by whole words. */
export const wordDoubleClick = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0 || event.detail !== 2 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return null;
  const at = clickedChar(view, event.clientX, event.clientY);
  if (at === null) return null;
  let start = runAt(view.state, at);
  return {
    get(cur: MouseEvent) {
      const here = clickedChar(view, cur.clientX, cur.clientY);
      const end = here === null ? start : runAt(view.state, here);
      return end.from < start.from ? EditorSelection.single(start.to, end.from) : EditorSelection.single(start.from, Math.max(start.to, end.to));
    },
    update(u) {
      if (u.docChanged) start = { from: u.changes.mapPos(start.from), to: u.changes.mapPos(start.to, 1) };
    },
  };
});
