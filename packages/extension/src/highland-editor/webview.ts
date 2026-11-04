/**
 * The Highland-style editor's page (M15 spike), running in a VS Code webview: CodeMirror 6 with
 * every line styled and indented from the parser, so wrapped dialogue stays indented, as in
 * Highland. Edits go to the extension, which applies them to the document; changes made
 * elsewhere (the text editor, Highland 2, a revert) come back as a new text.
 */
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState, RangeSetBuilder, StateField, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, highlightWhitespace, keymap, ViewPlugin, WidgetType, type DecorationSet, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { parse, type Document, type Mode } from "@highwater/parser";
import { screenplayCompletion } from "./complete.ts";
import { columnMinimum, columnWidth, inlineMarks, lineStyles, type InlineMark } from "./line-styles.ts";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

/** Marks transactions that came from the extension, so they are not sent back. */
const remote = Annotation.define<boolean>();

let mode: Mode = "fountain";
const MARKS = Object.fromEntries(
  (["bold", "italic", "boldItalic", "underline", "strike", "highlight", "note", "omitted"] as const).map((k) => [k, Decoration.mark({ class: `hl-${k}` })]),
) as Record<InlineMark["kind"], Decoration>;
/** The latest parse of the text, for completion. */
let parsed: Document | null = null;

function decorate(doc: Text): DecorationSet {
  parsed = parse(doc.toString(), { mode });
  const styles = lineStyles(parsed);
  const column = columnWidth(parsed);
  document.documentElement.style.setProperty("--column", `${column}ch`);
  document.documentElement.style.setProperty("--column-min", `${columnMinimum(parsed)}ch`);
  const ranges: Range<Decoration>[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const s = styles.get(line.from);
    if (!s) continue;
    const cls = [`hl-${s.kind}`, s.level ? `hl-level-${s.level}` : "", s.align ? `hl-${s.align}` : ""].filter(Boolean).join(" ");
    ranges.push(Decoration.line({ attributes: { class: cls, ...lineCss(s.indent, s.width) } }).range(line.from));
  }
  // Emphasis, notes and omitted text styled where they stand.
  for (const m of inlineMarks(parsed)) if (m.to <= doc.length) ranges.push(MARKS[m.kind].range(m.from, m.to));
  return Decoration.set(ranges, true);
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

/**
 * Keys that belong to Highwater (bold, italic, underline, note, omit, centre, highlight, case,
 * markers, panes, Preview): CodeMirror must leave them alone so VS Code's keybindings get them.
 */
const HIGHLAND_KEYS = new Set(["Mod-b", "Mod-i", "Mod-u", "Mod-/", "Mod-y", "Mod-Shift-.", "Ctrl-Shift-=", "Ctrl-u", "Ctrl-Shift-u", "Ctrl-m", "Ctrl-Alt-m", "Mod-e", "Mod-0", "Mod-1", "Mod-2", "Mod-4", "Mod-5", "Mod-Alt-x", "Mod-Alt-c", "Ctrl-g"]);
const isMac = /Mac/.test(navigator.platform);

/**
 * CodeMirror's bindings minus Highwater's keys, which instead do nothing here (no browser bold for
 * ⌘B): the webview passes every key press on to VS Code, whose keybindings run the commands.
 */
function withoutHighlandKeys(bindings: readonly KeyBinding[]): KeyBinding[] {
  const used = (k: string | undefined) => k !== undefined && HIGHLAND_KEYS.has(k.replace(/^Cmd-/, "Mod-"));
  const kept = bindings.filter((b) => !used(isMac ? (b.mac ?? b.key) : b.key));
  return [...[...HIGHLAND_KEYS].map((key) => ({ key, run: () => true })), ...kept];
}

/** Show Invisibles: spaces and tabs marked, and "¬" at each line's end, as the text editor's whitespace. */
class LineEnd extends WidgetType {
  override toDOM(): HTMLElement {
    const mark = document.createElement("span");
    mark.className = "hl-eol";
    mark.textContent = "¬";
    return mark;
  }
  override eq(): boolean {
    return true;
  }
}
const lineEndMark = Decoration.widget({ widget: new LineEnd(), side: 1 });
const lineEnds = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(v: EditorView) {
      this.decorations = this.build(v);
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(v: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      let last = -1;
      for (const { from, to } of v.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = v.state.doc.lineAt(pos);
          if (line.to > last) b.add(line.to, line.to, lineEndMark);
          last = line.to;
          pos = line.to + 1;
        }
      }
      return b.finish();
    }
  },
  { decorations: (p) => p.decorations },
);
const invisibles = new Compartment();
let showInvisibles = false;
const invisibleMarks = (on: boolean) => (on ? [highlightWhitespace(), lineEnds] : []);

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
        keymap.of(withoutHighlandKeys([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab])),
        EditorView.lineWrapping,
        styling,
        invisibles.of(invisibleMarks(showInvisibles)),
        screenplayCompletion(() => (mode === "fountain" ? parsed : null)),
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

/** Sets the selections after one of Highwater's writing keys (bold, centre, case…) changed the text. */
function select(ranges: { anchor: number; head: number }[]): void {
  if (!view || !ranges.length) return;
  const len = view.state.doc.length;
  const clamp = (n: number) => Math.min(Math.max(0, n), len);
  view.dispatch({ selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head)))), annotations: remote.of(true), scrollIntoView: true });
  view.focus();
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
  const msg = event.data as { type: string; on?: boolean; text?: string; mode?: Mode; offset?: number; how?: "top" | "center"; select?: boolean; ranges?: { anchor: number; head: number }[] };
  if (msg.type === "init") {
    mode = msg.mode ?? "fountain";
    document.body.dataset.mode = mode;
    start(msg.text ?? "");
  } else if (msg.type === "update") replace(msg.text ?? "");
  else if (msg.type === "reveal") reveal(msg.offset ?? 0, msg.how ?? "center", msg.select ?? false);
  else if (msg.type === "select" && msg.ranges) select(msg.ranges);
  else if (msg.type === "invisibles") {
    showInvisibles = !!msg.on;
    view?.dispatch({ effects: invisibles.reconfigure(invisibleMarks(showInvisibles)) });
  }
});
vscode.postMessage({ type: "ready" });
