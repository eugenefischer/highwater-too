/**
 * Comparing a save in the page, with CodeMirror's merge view (@codemirror/merge): the text as it
 * is now, with what changed since the save marked in place (added text tinted green, removed text
 * shown where it was, tinted red and struck through), and a bar at the top (‹ › between changes,
 * Changes Only / Show All, Revert…, Done). The merge view lays all of this out itself, so nothing
 * here works out pixel positions: switching in and out keeps the same line of text at the top, as
 * the pages view does.
 *
 * The text can't be changed while comparing. Typing shows a hint in the bar; double-clicking a spot
 * in the text ends the comparison with the cursor there, ready to type. Escape or Done ends it too,
 * as does the pages view or another document.
 */
import { Compartment, EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getChunks, uncollapseUnchanged, unifiedMergeView } from "@codemirror/merge";
import type { FromPage } from "./messages.ts";

/** How long the bar's hint shows after an edit is refused. */
const HINT_MS = 3000;

export class Compare {
  readonly extension: Extension;
  readonly #slot = new Compartment();
  #base = "";
  #hash = "";
  #at = 0;
  /** Long unchanged passages folded away ("Changes Only"); the whole text shows by default. */
  #folded = false;
  readonly #bar: HTMLElement;
  #hintTimer: ReturnType<typeof setTimeout> | undefined;
  /** When a folded passage was last opened: the second click of a double-click on it is not "edit here". */
  #unfoldedAt = 0;
  /** True while a save is being compared. */
  active = false;

  constructor(
    private readonly view: () => EditorView | null,
    private readonly post: (msg: FromPage) => void,
    /** The offset at the top of the visible text (as for the pages view). */
    private readonly topOffset: () => number,
    /** True for a transaction that brings in the document's text from outside (not the writer's edit). */
    private readonly fromOutside: (tr: Transaction) => boolean,
  ) {
    this.extension = this.#slot.of([]);
    this.#bar = document.getElementById("cmpbar")!;
    const q = (sel: string) => this.#bar.querySelector<HTMLElement>(sel)!;
    q(".cmp-prev").onclick = () => this.#go(-1);
    q(".cmp-next").onclick = () => this.#go(1);
    q(".cmp-fold").onclick = () => this.#setFolded(!this.#folded);
    q(".cmp-revert").onclick = () => this.post({ type: "historyRevert", hash: this.#hash });
    q(".cmp-done").onclick = () => this.end();
    q(".cmp-prev").dataset.tip = "Previous change";
    q(".cmp-next").dataset.tip = "Next change";
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.active && e.key === "Escape" && !document.querySelector("#sbhelp:not([hidden]), #sbmenu:not([hidden]), #binpop:not([hidden])")) {
          e.preventDefault();
          this.end();
        }
      },
      true,
    );
  }

  /** Compares the text now with a save's (`base`, as the page holds text), saved at `at` (ms). */
  start(base: string, hash: string, at: number): void {
    const v = this.view();
    if (!v) return;
    this.#base = base;
    this.#hash = hash;
    this.#at = at;
    this.#folded = false;
    const top = this.topOffset();
    this.#apply();
    this.active = true;
    document.body.classList.add("comparing");
    this.#bar.hidden = false;
    this.#describe();
    this.post({ type: "comparing", on: true });
    this.#showAtTop(top);
  }

  /**
   * Back to the text as usual, keeping the same line at the top; with `at`, the cursor goes there
   * and stays where it is on screen (double-click to edit).
   */
  end(at?: number): void {
    const v = this.view();
    if (!this.active) return;
    const top = this.topOffset();
    const keep = at !== undefined && v ? this.#screenY(v, at) : null;
    this.active = false;
    document.body.classList.remove("comparing");
    this.#bar.hidden = true;
    this.#hint(false);
    this.post({ type: "comparing", on: false });
    if (!v) return;
    v.dispatch({ effects: this.#slot.reconfigure([]) });
    if (at !== undefined) {
      v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "start" }) });
      v.focus();
      // Then back to where the spot was on screen.
      if (keep !== null)
        requestAnimationFrame(() => {
          const c = v.coordsAtPos(at);
          if (c) v.scrollDOM.scrollTop += c.top - keep;
        });
    } else this.#showAtTop(top);
  }

  /** The hint after the writer tried to change the text (also sent by the extension for its commands). */
  refused(): void {
    if (this.active) this.#hint(true);
  }

  #apply(): void {
    this.view()?.dispatch({
      effects: this.#slot.reconfigure([
        unifiedMergeView({
          original: this.#base,
          highlightChanges: true,
          gutter: false,
          syntaxHighlightDeletions: false,
          // A change within a line shows in that line, which keeps its screenplay layout.
          allowInlineDiffs: true,
          mergeControls: false,
          ...(this.#folded ? { collapseUnchanged: { margin: 3, minSize: 4 } } : {}),
        }),
        // The text can't be changed while comparing; text brought in from outside still comes in.
        EditorState.transactionFilter.of((tr) => {
          if (!tr.docChanged || this.fromOutside(tr)) return tr;
          this.#hint(true);
          return [];
        }),
        EditorView.updateListener.of((u) => {
          if (this.active && (u.docChanged || u.selectionSet)) this.#describe();
        }),
        EditorView.domEventHandlers({
          mousedown: (e) => {
            if ((e.target as Element).closest?.(".cm-collapsedLines")) this.#unfoldedAt = Date.now();
            return false;
          },
          // Double-click a spot to edit there: the comparison ends with the cursor at that spot.
          dblclick: (e, v) => {
            if ((e.target as Element).closest?.(".cm-collapsedLines") || Date.now() - this.#unfoldedAt < 600) return false;
            const at = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (at === null) return false;
            e.preventDefault();
            this.end(at);
            return true;
          },
        }),
      ]),
    });
  }

  /** Changes Only (folded) or Show All, keeping the same line at the top. */
  #setFolded(folded: boolean): void {
    const v = this.view();
    if (!v || !this.active || folded === this.#folded) return;
    const top = this.topOffset();
    this.#folded = folded;
    this.#apply();
    this.#describe();
    this.#showAtTop(top);
  }

  /** Puts the line at `offset` at the top; when it is in a folded passage, opens that passage. */
  #showAtTop(offset: number): void {
    const v = this.view();
    if (!v) return;
    const at = Math.min(offset, v.state.doc.length);
    if (this.active && this.#folded) {
      const from = foldAt(v, at);
      if (from !== null) v.dispatch({ effects: uncollapseUnchanged.of(from) });
    }
    v.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start" }) });
  }

  /** Where `at` is in the window (the bar's going doesn't move it). */
  #screenY(v: EditorView, at: number): number | null {
    return v.coordsAtPos(at)?.top ?? null;
  }

  #hint(on: boolean): void {
    clearTimeout(this.#hintTimer);
    this.#bar.classList.toggle("hinting", on);
    if (on) this.#hintTimer = setTimeout(() => this.#bar.classList.remove("hinting"), HINT_MS);
  }

  #chunks() {
    const v = this.view();
    return (v && getChunks(v.state)?.chunks) || [];
  }

  /** "Comparing with Nov 10, 3:42 PM · 4 changes", which change the cursor is at, and the fold button. */
  #describe(): void {
    const chunks = this.#chunks();
    const n = chunks.length;
    const when = new Date(this.#at).toLocaleString([], { month: "short", day: "numeric", year: new Date(this.#at).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
    this.#bar.querySelector(".cmp-what")!.textContent = `Comparing with ${when} · ${n === 0 ? "no changes" : n === 1 ? "1 change" : `${n.toLocaleString()} changes`}`;
    for (const b of this.#bar.querySelectorAll<HTMLButtonElement>(".cmp-prev, .cmp-next")) b.disabled = n === 0;
    const head = this.view()?.state.selection.main.head ?? 0;
    const i = chunks.findIndex((c) => head >= c.fromB && head <= Math.max(c.fromB, c.toB));
    this.#bar.querySelector(".cmp-where")!.textContent = i >= 0 ? `${i + 1} of ${n}` : "";
    const fold = this.#bar.querySelector<HTMLElement>(".cmp-fold")!;
    fold.textContent = this.#folded ? "Show All" : "Changes Only";
    fold.dataset.tip = this.#folded ? "Show the whole text, with the changes marked" : "Fold away long passages that haven't changed";
  }

  /** To the next (1) or previous (-1) change from the cursor, wrapping round, shown mid-screen. */
  #go(step: number): void {
    const v = this.view();
    const chunks = this.#chunks();
    if (!v || !chunks.length) return;
    const head = v.state.selection.main.head;
    const current = chunks.findIndex((c) => head >= c.fromB && head <= Math.max(c.fromB, c.toB));
    let i: number;
    if (current >= 0) i = (current + step + chunks.length) % chunks.length;
    else if (step > 0) i = Math.max(0, chunks.findIndex((c) => c.fromB > head));
    else {
      const before = chunks.map((c) => c.fromB < head).lastIndexOf(true);
      i = before >= 0 ? before : chunks.length - 1;
    }
    const at = chunks[i]!.fromB;
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  }
}

/** Where the folded passage holding `pos` starts, or null if `pos` isn't folded away. */
function foldAt(v: EditorView, pos: number): number | null {
  let found: number | null = null;
  for (const source of v.state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? source(v) : source;
    set.between(pos, pos, (from, to, deco) => {
      const widget = (deco.spec as { widget?: { type?: string } }).widget;
      if (widget?.type === "collapsed-unchanged-code" && from <= pos && pos <= to) {
        found = from;
        return false;
      }
      return undefined;
    });
    if (found !== null) break;
  }
  return found;
}
