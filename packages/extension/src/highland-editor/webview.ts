/**
 * The Highland-style editor's page (M15 spike), running in a VS Code webview: CodeMirror 6 with
 * every line styled and indented from the parser, so wrapped dialogue stays indented, as in
 * Highland. Edits go to the extension, which applies them to the document; changes made
 * elsewhere (the text editor, Highland 2, a revert) come back as a new text.
 */
import { history, defaultKeymap, historyKeymap, indentWithTab, invertedEffects, isolateHistory, redo, undo } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, Transaction, type ChangeSpec, type Range, type Text } from "@codemirror/state";
import { Decoration, dropCursor, EditorView, highlightWhitespace, keymap, ViewPlugin, WidgetType, type DecorationSet, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { parse, type Document, type Mode } from "@highwater/parser";
import { screenplayCompletion } from "./complete.ts";
import { Pages, type PdfMessage } from "./pages.ts";
import { TemplateWindow, type OptionValues } from "./template-window.ts";
import { ASSET_TYPE, BIN_TYPE, Sidebar, type BinOp } from "./sidebar.ts";

/**
 * Bin changes made from the page ride in its undo history, as Highland's do: each is an effect on
 * a transaction (with the text it cut or put in, if any), undo applies the opposite one, and every
 * such effect, done or undone, is sent to the extension to change the Bin.
 */
const binEffect = StateEffect.define<BinOp>();
const opposite = (op: BinOp): BinOp => (op.kind === "move" ? { kind: "move", from: op.to, to: op.from } : { ...op, kind: op.kind === "add" ? "remove" : "add" });
const binHistory = invertedEffects.of((tr) => tr.effects.filter((e) => e.is(binEffect)).map((e) => binEffect.of(opposite(e.value as BinOp))));
import { columnMinimum, columnWidth, inlineMarks, lineStyles, paragraphNumbers, type InlineMark } from "./line-styles.ts";
import { nextMisspelling, Spelling, spellingMenu, spellingPlugin } from "./spelling.ts";

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
  const numbers = paragraphNumbers(parsed);
  const ranges: Range<Decoration>[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const s = styles.get(line.from);
    // Highland's paragraph number, shown in the margin when numbers are on (a class on the page).
    const number = numbers.get(line.from);
    if (!s && number === undefined) continue;
    const cls = s ? [`hl-${s.kind}`, s.level ? `hl-level-${s.level}` : "", s.align ? `hl-${s.align}` : ""].filter(Boolean).join(" ") : "";
    const attributes: Record<string, string> = { ...(cls ? { class: cls } : {}), ...(s ? lineCss(s.indent, s.width) : {}), ...(number !== undefined ? { "data-n": String(number) } : {}) };
    ranges.push(Decoration.line({ attributes }).range(line.from));
  }
  // Emphasis, notes and omitted text styled where they stand.
  for (const m of inlineMarks(parsed)) if (m.to <= doc.length) ranges.push(MARKS[m.kind].range(m.from, m.to));
  return Decoration.set(ranges, true);
}

/** A line's indent (wrapped lines too), and the width it wraps at; in a column narrower than that, it wraps at the column's edge. */
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
const HIGHLAND_KEYS = new Set(["Mod-b", "Mod-i", "Mod-u", "Mod-/", "Mod-y", "Mod-Shift-.", "Ctrl-Shift-=", "Ctrl-u", "Ctrl-Shift-u", "Ctrl-m", "Ctrl-Alt-m", "Mod-e", "Mod-0", "Mod-1", "Mod-2", "Mod-3", "Mod-4", "Mod-5", "Mod-Alt-x", "Mod-Alt-c", "Ctrl-g", "Mod-Shift-i", "Mod-=", "Mod--", "Mod-Alt-0"]);
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

/** Where a Bin item or image dropped at the pointer goes: exactly there, mid-sentence if so (as Highland). */
function dropPlace(v: EditorView, e: DragEvent): number {
  return v.posAtCoords({ x: e.clientX, y: e.clientY }, false);
}

/** The drop caret: a text cursor drawn at the place, over the page (CodeMirror's own is for its own drags). */
let dropCaret: HTMLElement | null = null;
function showDropCaret(v: EditorView, at: number): void {
  const c = v.coordsAtPos(at, 1) ?? v.coordsAtPos(at, -1);
  if (!c) return hideDropCaret();
  dropCaret ??= Object.assign(document.body.appendChild(document.createElement("div")), { className: "hl-dropcaret" });
  dropCaret.style.left = `${Math.round(c.left)}px`;
  dropCaret.style.top = `${Math.round(c.top)}px`;
  dropCaret.style.height = `${Math.round(c.bottom - c.top)}px`;
  dropCaret.hidden = false;
}
function hideDropCaret(): void {
  if (dropCaret) dropCaret.hidden = true;
}
/** The text being dragged out of the page, while the drag lasts. */
let dragged: { from: number; to: number; text: string } | null = null;
const spelling = new Spelling(
  () => view,
  () => parsed,
  (msg) => vscode.postMessage(msg),
);
const spellingMarks = spellingPlugin(spelling);

function start(text: string): void {
  view?.destroy();
  view = new EditorView({
    parent: document.getElementById("editor")!,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        binHistory,
        search({ top: true }),
        keymap.of([{ key: "Mod-;", run: (v) => (void nextMisspelling(v, spelling), true) }]),
        keymap.of(withoutHighlandKeys([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab])),
        EditorView.lineWrapping,
        // A Bin item or an image dropped from the sidebar goes in exactly where it is let go, as in
        // Highland, with a caret showing the place while it is dragged.
        EditorView.domEventHandlers({
          // What is dragged out of the page, so a drop on the Bin can take it out (dragend comes after the drop).
          dragstart: (_e, v) => {
            const r = v.state.selection.main;
            dragged = r.empty ? null : { from: r.from, to: r.to, text: v.state.sliceDoc(r.from, r.to) };
            return false;
          },
          dragend: () => {
            dragged = null;
            hideDropCaret();
            return false;
          },
          // While a Bin item or image is over the text, a caret shows where it will go.
          dragover: (e, v) => {
            const types = e.dataTransfer?.types ?? [];
            if (!types.includes(BIN_TYPE) && !types.includes(ASSET_TYPE)) return false;
            e.preventDefault();
            e.dataTransfer!.dropEffect = types.includes(BIN_TYPE) ? "move" : "copy";
            showDropCaret(v, dropPlace(v, e));
            return true;
          },
          dragleave: (e, v) => {
            if (!v.dom.contains(e.relatedTarget as Node | null)) hideDropCaret();
            return false;
          },
          drop: (e, v) => {
            hideDropCaret();
            const types = e.dataTransfer?.types ?? [];
            if (!types.includes(BIN_TYPE) && !types.includes(ASSET_TYPE)) return false;
            const insert = e.dataTransfer!.getData("text/plain");
            e.preventDefault();
            const at = dropPlace(v, e);
            // A Bin item dragged into the text leaves the Bin, in the same undoable step.
            const index = types.includes(BIN_TYPE) ? Number(e.dataTransfer!.getData(BIN_TYPE)) : NaN;
            const take = Number.isInteger(index) ? [binEffect.of({ kind: "remove", index, text: e.dataTransfer!.getData("text/plain") })] : [];
            // The typing cursor stays where it was (as Highland), moved along by the insertion if after it.
            v.dispatch({ changes: { from: at, insert }, effects: take, userEvent: "input.drop", annotations: isolateHistory.of("full") });
            v.focus();
            return true;
          },
        }),
        // After the handlers above, so a Bin item shows only its own caret.
        dropCursor(),
        styling,
        spellingMarks,
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
          if (u.docChanged) sidebar.textChanged();
          for (const tr of u.transactions) for (const e of tr.effects) if (e.is(binEffect)) vscode.postMessage({ type: "binOp", op: e.value });
          if (u.selectionSet || u.docChanged) sidebar.cursorMoved();
        }),
      ],
    }),
  });
  view.scrollDOM.addEventListener("scroll", reportScroll);
  spellingMenu(view, spelling, spellingMarks);
  view.focus();
  sidebar.textChanged();
}

let scrollPending = false;
/** Tells the extension the offset at the top of the view (once a frame), for the Preview to follow. */
function reportScroll(): void {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    if (!view || pages.shown) return;
    vscode.postMessage({ type: "scroll", top: topOffset() });
  });
}

/** The offset at the top of the visible text. */
function topOffset(): number {
  if (!view) return 0;
  const visibleTop = Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop);
  const block = view.lineBlockAtHeight(visibleTop);
  // The first line wholly in view (one cut off at the top doesn't count).
  if (block.top < visibleTop - 2 && block.to < view.state.doc.length) return view.lineBlockAt(block.to + 1).from;
  return block.from;
}

// Preview mode (⌘E): the printed pages in place of the text, keeping your place both ways.
const pages = new Pages(
  (msg) => vscode.postMessage(msg),
  (top, cursor) => {
    if (!view) return;
    view.requestMeasure();
    const len = view.state.doc.length;
    if (cursor !== null) {
      const at = Math.min(cursor, len);
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }), annotations: remote.of(true) });
    } else if (top !== null) view.dispatch({ effects: EditorView.scrollIntoView(Math.min(top, len), { y: "start" }), annotations: remote.of(true) });
    view.focus();
  },
  (current) => templateWindow.open(current),
);

// Highland's Document Template window, from the template button in the top bar.
const templateWindow = new TemplateWindow(
  (msg) => {
    if ((msg as { type: string }).type === "previewTemplate" || (msg as { type: string }).type === "templateOption") pages.relayout();
    vscode.postMessage(msg);
  },
  () => pages.pdfjs(),
);

// Tooltips on the top bar's controls (Highland's words), shown after a moment's hover just below the
// control, kept inside the window. Our own, as a webview's title tooltips don't always show.
{
  const tip = document.createElement("div");
  tip.id = "hl-tip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
  };
  for (const el of document.querySelectorAll<HTMLElement>("[data-tip]")) {
    el.addEventListener("mouseenter", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        tip.textContent = el.dataset.tip ?? "";
        tip.hidden = false;
        const r = el.getBoundingClientRect();
        const w = tip.offsetWidth;
        tip.style.top = `${Math.round(r.bottom + 4)}px`;
        tip.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2)))}px`;
      }, 500);
    });
    el.addEventListener("mouseleave", hide);
    el.addEventListener("mousedown", hide);
  }
  window.addEventListener("blur", hide);
}

// ⌘Z and ⇧⌘Z in the sidebar (outside its text boxes) undo and redo the page's history, which holds
// the Bin's drags and deletions; in the Scratchpad or a card being edited, they stay that box's own.
window.addEventListener(
  "keydown",
  (e) => {
    if (!view || !(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z") return;
    const t = e.target as HTMLElement | null;
    if (!t || !t.closest("#sidebar") || t.closest("textarea, input")) return;
    e.preventDefault();
    e.stopPropagation();
    (e.shiftKey ? redo : undo)(view);
  },
  true,
);

// Highland's sidebar: Navigator, Bin, Statistics, Assets, Scratchpad, Writing History, Works.
const sidebar = new Sidebar({
  post: (msg) => vscode.postMessage(msg),
  parsed: () => parsed,
  length: () => view?.state.doc.length ?? 0,
  head: () => view?.state.selection.main.head ?? 0,
  reveal: (offset) => reveal(offset, "top", true),
  edit: (changes) => view?.dispatch({ changes, scrollIntoView: false }),
  bin: (op, cut) => {
    if (!view) return;
    let changes: ChangeSpec | undefined;
    const d = dragged;
    dragged = null;
    if (cut !== undefined && d && d.text === cut && view.state.sliceDoc(d.from, d.to) === cut) {
      // Whole paragraphs taken out take one blank line with them, so no gap is left.
      const doc = view.state.doc;
      let { from, to } = d;
      if (doc.lineAt(from).from === from && doc.lineAt(to).to === to) {
        if (doc.sliceString(to, to + 2) === "\n\n") to += 2;
        else if (doc.sliceString(from - 2, from) === "\n\n") from -= 2;
      }
      changes = { from, to };
    }
    view.dispatch({ ...(changes ? { changes } : {}), effects: binEffect.of(op), userEvent: "bin", annotations: [isolateHistory.of("full"), Transaction.addToHistory.of(true)] });
  },
  insert: (text) => {
    if (!view) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  },
});

// The top bar: Text and Pages (as ⌘E), and Choose Theme.
document.getElementById("tbtext")!.onclick = () => pages.shown && togglePreview();
document.getElementById("tbpages")!.onclick = () => !pages.shown && togglePreview();
document.getElementById("tbtheme")!.onclick = () => vscode.postMessage({ type: "chooseTheme" });

/** Highland's counts at the foot of the text. */
function showCounts(c: { characters: number; words: number; pages: number | null }): void {
  const n = (x: number) => x.toLocaleString("en-US");
  const el = document.getElementById("counts")!;
  // The page count comes from laying out the pages; until then, none.
  const parts = [`${n(c.characters)} characters`, `${n(c.words)} words`, ...(c.pages === null ? [] : [`${n(c.pages)} ${c.pages === 1 ? "page" : "pages"}`])];
  el.replaceChildren(...parts.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
}

function togglePreview(): void {
  if (pages.shown) return pages.hide();
  if (!view) return;
  const at = topOffset();
  view.contentDOM.blur();
  pages.show(at);
  document.getElementById("pages")?.focus();
}

/** Scrolls to an offset from the extension (Navigator, Preview); with `select`, moves the cursor there too. */
function reveal(offset: number, how: "top" | "center", select: boolean): void {
  if (!view) return;
  const at = Math.min(Math.max(0, offset), view.state.doc.length);
  if (pages.shown) {
    // The pages stay showing (EJ): they go to the place, and the cursor waits there in the text.
    if (select) view.dispatch({ selection: { anchor: at }, annotations: remote.of(true) });
    pages.reveal(at, how);
    return;
  }
  view.dispatch({ ...(select ? { selection: { anchor: at } } : {}), effects: EditorView.scrollIntoView(at, { y: how === "top" ? "start" : "center" }), annotations: remote.of(true) });
  if (select) view.focus();
}

let themed: string[] = [];
/** A Highland theme's colours for the page, or none (VS Code's). */
function applyTheme(vars: Record<string, string> | null): void {
  const root = document.documentElement.style;
  for (const name of themed) root.removeProperty(name);
  themed = vars ? Object.keys(vars) : [];
  for (const [name, value] of Object.entries(vars ?? {})) root.setProperty(name, value);
}

/** Cut to Bin (⌥⌘X) and Copy to Bin (⌥⌘C): the selection becomes a Bin item, as an undoable step of the page. */
function toBin(cut: boolean): void {
  if (!view) return;
  const ranges = view.state.selection.ranges.filter((r) => !r.empty);
  if (!ranges.length) return;
  const text = ranges.map((r) => view!.state.sliceDoc(r.from, r.to)).join("\n\n");
  view.dispatch({
    ...(cut ? { changes: ranges.map((r) => ({ from: r.from, to: r.to })) } : {}),
    effects: binEffect.of({ kind: "add", index: sidebar.binCount(), text }),
    userEvent: "bin",
    annotations: isolateHistory.of("full"),
  });
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
  const msg = event.data as { type: string; px?: number | null; vars?: Record<string, string> | null; on?: boolean; text?: string; mode?: Mode; offset?: number; how?: "top" | "center"; select?: boolean; ranges?: { anchor: number; head: number }[] };
  if (sidebar.receive(event.data as { type: string } & Record<string, unknown>)) return;
  if (msg.type === "init") {
    mode = msg.mode ?? "fountain";
    document.body.dataset.mode = mode;
    start(msg.text ?? "");
  } else if (msg.type === "update") replace(msg.text ?? "");
  else if (msg.type === "reveal") reveal(msg.offset ?? 0, msg.how ?? "center", msg.select ?? false);
  else if (msg.type === "select" && msg.ranges) select(msg.ranges);
  else if (msg.type === "togglePreview") togglePreview();
  else if (msg.type === "toBin") toBin(!!(event.data as { cut?: boolean }).cut);
  else if (msg.type === "binRefused" && view) undo(view);
  else if (msg.type === "pdf") void pages.receive(event.data as PdfMessage);
  else if (msg.type === "previewEmpty") pages.empty(String((event.data as { message?: string }).message ?? ""));
  else if (msg.type === "theme") applyTheme(msg.vars ?? null);
  else if (msg.type === "numbers") {
    document.documentElement.classList.toggle("hl-numbers", !!msg.on);
    view?.requestMeasure();
  }
  else if (msg.type === "fontSize") {
    if (msg.px) document.documentElement.style.setProperty("--hl-font-size", `${msg.px}px`);
    else document.documentElement.style.removeProperty("--hl-font-size");
    view?.requestMeasure();
  }
  else if (msg.type === "template") {
    const t = event.data as { template: string; templates: string[] };
    pages.templates(t.templates, t.template);
    templateWindow.template(t.template);
  } else if (msg.type === "templateValues") templateWindow.values((event.data as { values: OptionValues }).values);
  else if (msg.type === "templateThumb") {
    const t = event.data as { template: string; data: Uint8Array | null; message?: string };
    void templateWindow.thumbnail(t.template, t.data, t.message ?? "");
  } else if (msg.type === "counts") showCounts(event.data as { characters: number; words: number; pages: number | null });
  else if (msg.type === "spelling") spelling.configure(!!msg.on, (event.data as { words?: string[] }).words ?? []);
  else if (msg.type === "nextMisspelling") {
    if (view) void nextMisspelling(view, spelling);
  }
  else if (msg.type === "invisibles") {
    showInvisibles = !!msg.on;
    view?.dispatch({ effects: invisibles.reconfigure(invisibleMarks(showInvisibles)) });
  }
});
vscode.postMessage({ type: "ready" });
