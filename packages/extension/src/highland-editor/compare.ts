/**
 * Comparing a save in the page, with CodeMirror's merge view (@codemirror/merge): the text as it
 * is now, with what changed since the save marked in place (added text tinted green, removed text
 * shown above it, tinted red and struck through), long unchanged stretches folded away, and a bar
 * at the top (‹ › between changes, Revert…, Done). The merge view lays all of this out itself, so
 * nothing here works out positions. Escape or Done ends it, as does the pages view or another
 * document; typing goes in as usual, and the marks follow it.
 */
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getChunks, unifiedMergeView } from "@codemirror/merge";
import type { FromPage } from "./messages.ts";

export class Compare {
  readonly extension: Extension;
  readonly #slot = new Compartment();
  #hash = "";
  #at = 0;
  readonly #bar: HTMLElement;
  /** True while a save is being compared. */
  active = false;

  constructor(
    private readonly view: () => EditorView | null,
    private readonly post: (msg: FromPage) => void,
  ) {
    this.extension = this.#slot.of([]);
    this.#bar = document.getElementById("cmpbar")!;
    const q = (sel: string) => this.#bar.querySelector<HTMLElement>(sel)!;
    q(".cmp-prev").onclick = () => this.#go(-1);
    q(".cmp-next").onclick = () => this.#go(1);
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
    this.#hash = hash;
    this.#at = at;
    v.dispatch({
      effects: this.#slot.reconfigure([
        unifiedMergeView({
          original: base,
          highlightChanges: true,
          gutter: false,
          syntaxHighlightDeletions: false,
          // A change within a line shows in that line, which keeps its screenplay layout.
          allowInlineDiffs: true,
          mergeControls: false,
          collapseUnchanged: { margin: 3, minSize: 4 },
        }),
        // The count in the bar follows typing.
        EditorView.updateListener.of((u) => {
          if (this.active && (u.docChanged || u.selectionSet)) this.#describe();
        }),
      ]),
    });
    this.active = true;
    document.body.classList.add("comparing");
    this.#bar.hidden = false;
    this.#describe();
    if (this.#chunks().length) requestAnimationFrame(() => this.#go(1));
  }

  /** Back to the text as usual. */
  end(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove("comparing");
    this.#bar.hidden = true;
    this.view()?.dispatch({ effects: this.#slot.reconfigure([]) });
  }

  #chunks() {
    const v = this.view();
    return (v && getChunks(v.state)?.chunks) || [];
  }

  /** "Comparing with Nov 10, 3:42 PM · 4 changes", and which change the cursor is at. */
  #describe(): void {
    const chunks = this.#chunks();
    const n = chunks.length;
    const when = new Date(this.#at).toLocaleString([], { month: "short", day: "numeric", year: new Date(this.#at).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
    this.#bar.querySelector(".cmp-what")!.textContent = `Comparing with ${when} · ${n === 0 ? "no changes" : n === 1 ? "1 change" : `${n.toLocaleString()} changes`}`;
    for (const b of this.#bar.querySelectorAll<HTMLButtonElement>(".cmp-prev, .cmp-next")) b.disabled = n === 0;
    const head = this.view()?.state.selection.main.head ?? 0;
    const i = chunks.findIndex((c) => head >= c.fromB && head <= Math.max(c.fromB, c.toB));
    this.#bar.querySelector(".cmp-where")!.textContent = i >= 0 ? `${i + 1} of ${n}` : "";
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
