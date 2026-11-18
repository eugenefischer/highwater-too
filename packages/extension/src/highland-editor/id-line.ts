import { EditorSelection, EditorState, StateField, type Extension, type Text, type Transaction } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/**
 * The line tying a plain file to its writing history (Settings → Backup's Link plain files; EJ,
 * 2026-11-18): `[[highwater: <ID>]]` or `<!-- highwater: <ID> -->` as the last thing in the text.
 * While the setting is on, the Highwater Editor hides it with the blank lines before it, keeps the
 * cursor out of it, and lets no edit touch it: Select All and Delete, Find and Replace, or typing at
 * the very end change only the text before it. With the setting off, the line shows as written.
 */
const ID_LINE = /\n?[ \t]*(?:\[\[\s*highwater:\s*[0-9A-Za-z-]{8,}\s*\]\]|<!--\s*highwater:\s*[0-9A-Za-z-]{8,}\s*-->)[ \t]*\s*$/;

/**
 * The hidden range: the ID line with the one blank line before it (as a save adds it), to the end
 * of the text. Blank lines the writer adds above it stay visible, so Return at the end of the text
 * makes a new line as usual.
 */
export function idLineRange(doc: Text | string): { from: number; to: number } | null {
  const text = typeof doc === "string" ? doc : null;
  const length = text !== null ? text.length : (doc as Text).length;
  const slice = (a: number, b: number) => (text !== null ? text.slice(a, b) : (doc as Text).sliceString(a, b));
  // The line is at the end: look at the tail only.
  const tailStart = Math.max(0, length - 400);
  const m = ID_LINE.exec(slice(tailStart, length));
  if (!m) return null;
  // On a line of its own: where its line starts, nothing comes before it.
  const lineStart = tailStart + m.index + (m[0].startsWith("\n") ? 1 : 0);
  if (lineStart > 0 && slice(lineStart - 1, lineStart) !== "\n") return null;
  // With the blank line before it: "…writing" + "\n\n" + line.
  const from = lineStart >= 2 && slice(lineStart - 2, lineStart) === "\n\n" ? lineStart - 2 : lineStart >= 1 ? lineStart - 1 : 0;
  return { from, to: length };
}

/** The editor's hiding and guarding of the ID line; `isRemote` tells the extension's own changes, which may touch it. */
export function idLineGuard(isRemote: (tr: Transaction) => boolean): Extension {
  const field = StateField.define<{ from: number; to: number } | null>({
    create: (state) => idLineRange(state.doc),
    update: (value, tr) => (tr.docChanged ? idLineRange(tr.newDoc) : value),
  });
  const hidden = (state: EditorState) => {
    const r = state.field(field);
    return r && r.to > r.from ? Decoration.set(Decoration.replace({}).range(r.from, r.to)) : Decoration.none;
  };
  return [
    field,
    EditorView.decorations.compute([field], hidden),
    EditorView.atomicRanges.of((view) => hidden(view.state)),
    // Edits stop where the line begins (the extension's own changes excepted).
    EditorState.changeFilter.of((tr) => {
      if (isRemote(tr)) return true;
      const r = tr.startState.field(field);
      // (Ranges where changes are suppressed.)
      return r && r.to > r.from ? [r.from, r.to] : true;
    }),
    // The cursor never sits past the writing (Mod-End, a click below the text): typing there would go nowhere.
    EditorState.transactionFilter.of((tr) => {
      if (!tr.selection && !tr.docChanged) return tr;
      const r = idLineRange(tr.newDoc);
      if (!r) return tr;
      const sel = tr.newSelection;
      if (!sel.ranges.some((x) => x.anchor > r.from || x.head > r.from)) return tr;
      const clamp = (n: number) => Math.min(n, r.from);
      return [tr, { selection: EditorSelection.create(sel.ranges.map((x) => EditorSelection.range(clamp(x.anchor), clamp(x.head))), sel.mainIndex), sequential: true }];
    }),
  ];
}

/** True when a change from the extension only adds the ID line at the end (kept out of undo). */
export function onlyAddsIdLine(removed: string, inserted: string): boolean {
  return removed === "" && /^\s*(?:\[\[\s*highwater:\s*[0-9A-Za-z-]{8,}\s*\]\]|<!--\s*highwater:\s*[0-9A-Za-z-]{8,}\s*-->)\s*$/.test(inserted);
}
