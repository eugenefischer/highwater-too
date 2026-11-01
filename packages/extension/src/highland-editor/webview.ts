/**
 * The Highland-style editor's page (M15 spike), running in a VS Code webview: CodeMirror 6 with
 * every line styled and indented from the parser, so wrapped dialogue stays indented, as in
 * Highland. Edits go to the extension, which applies them to the document; changes made
 * elsewhere (the text editor, Highland 2, a revert) come back as a new text.
 */
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, EditorState, RangeSetBuilder, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { parse, type Mode } from "@highwater/parser";
import { columnMinimum, columnWidth, lineStyles } from "./line-styles.ts";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

/** Marks transactions that came from the extension, so they are not sent back. */
const remote = Annotation.define<boolean>();

let mode: Mode = "fountain";

function decorate(doc: Text): DecorationSet {
  const parsed = parse(doc.toString(), { mode });
  const styles = lineStyles(parsed);
  const column = columnWidth(parsed);
  document.documentElement.style.setProperty("--column", `${column}ch`);
  document.documentElement.style.setProperty("--column-min", `${columnMinimum(parsed)}ch`);
  const b = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const s = styles.get(line.from);
    if (!s) continue;
    const cls = [`hl-${s.kind}`, s.level ? `hl-level-${s.level}` : "", s.align ? `hl-${s.align}` : ""].filter(Boolean).join(" ");
    b.add(line.from, line.from, Decoration.line({ attributes: { class: cls, ...lineCss(s.indent, s.width) } }));
  }
  return b.finish();
}

/** A line's indent, and the width it wraps at; in a column narrower than that, it wraps at the column's edge. */
function lineCss(left: number, width?: number): { style?: string } {
  const parts = [left ? `padding-left: ${left}ch` : "", width ? `max-width: ${width}ch` : ""].filter(Boolean);
  return parts.length ? { style: parts.join("; ") } : {};
}

const styling = StateField.define<DecorationSet>({
  create: (state) => decorate(state.doc),
  update: (value, tr) => (tr.docChanged ? decorate(tr.state.doc) : value),
  provide: (f) => EditorView.decorations.from(f),
});

let view: EditorView | null = null;

function start(text: string): void {
  view?.destroy();
  view = new EditorView({
    parent: document.getElementById("editor")!,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        search({ top: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.lineWrapping,
        styling,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged || u.transactions.some((t) => t.annotation(remote))) return;
          const changes: { from: number; to: number; insert: string }[] = [];
          // Offsets in the document as it was before this update, applied in order by the extension.
          u.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => changes.push({ from: fromA, to: toA, insert: inserted.toString() }));
          vscode.postMessage({ type: "edit", changes });
        }),
        // After the edit, so the extension reads the offsets against the edited document.
        EditorView.updateListener.of((u) => {
          if (u.selectionSet || u.docChanged) vscode.postMessage({ type: "selection", ranges: u.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head })) });
        }),
      ],
    }),
  });
  view.scrollDOM.addEventListener("scroll", reportScroll);
  view.focus();
}

let scrollPending = false;
/** Tells the extension the offset at the top of the view (once a frame), for the Preview to follow. */
function reportScroll(): void {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    if (!view) return;
    const visibleTop = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    vscode.postMessage({ type: "scroll", top: view.lineBlockAtHeight(Math.max(0, visibleTop)).from });
  });
}

/** Scrolls to an offset from the extension (Navigator, Preview); with `select`, moves the cursor there too. */
function reveal(offset: number, how: "top" | "center", select: boolean): void {
  if (!view) return;
  const at = Math.min(Math.max(0, offset), view.state.doc.length);
  view.dispatch({ ...(select ? { selection: { anchor: at } } : {}), effects: EditorView.scrollIntoView(at, { y: how === "top" ? "start" : "center" }), annotations: remote.of(true) });
  if (select) view.focus();
}

/** Replaces the text with the document's, changing only what differs, so the cursor stays put. */
function replace(text: string): void {
  if (!view) return start(text);
  const old = view.state.doc.toString();
  if (old === text) return;
  let a = 0;
  while (a < old.length && a < text.length && old[a] === text[a]) a++;
  let b = 0;
  while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
  view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, annotations: remote.of(true) });
}

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type: string; text?: string; mode?: Mode; offset?: number; how?: "top" | "center"; select?: boolean };
  if (msg.type === "init") {
    mode = msg.mode ?? "fountain";
    document.body.dataset.mode = mode;
    start(msg.text ?? "");
  } else if (msg.type === "update") replace(msg.text ?? "");
  else if (msg.type === "reveal") reveal(msg.offset ?? 0, msg.how ?? "center", msg.select ?? false);
});
vscode.postMessage({ type: "ready" });
