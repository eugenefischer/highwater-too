import { Compartment, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { wordDiff, type Change } from "./word-diff.ts";

/**
 * Comparing a save in the page: the text as it is now, with what changed since the save marked
 * word by word (added words green and underlined, removed ones red and struck through where they
 * were), a bar at the top (‹ › between changes, Revert…, Done) and marks beside the scroll bar.
 * Escape or Done ends it; so does any change to the text (typing goes in), the Preview, or
 * another document.
 */

/** Spaces, tabs and line breaks drawn as marks (·, →, ¶), so a change of nothing but those shows. */
export function visibleSpace(text: string): string {
  return text.replace(/\n/g, "¶").replace(/\t/g, "→").replace(/ /g, "·");
}

/** Removed text, struck through where it was; when it is only spaces or line breaks, as their marks. */
class Removed extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: Removed): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cmp-del";
    s.textContent = /^\s+$/.test(this.text) ? visibleSpace(this.text) : this.text;
    return s;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const added = Decoration.mark({ class: "cmp-add" });

/** Added spaces or line breaks alone: their marks, in the added colour (the text itself shows nothing). */
class AddedSpace extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: AddedSpace): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "cmp-add cmp-space";
    s.textContent = visibleSpace(this.text);
    return s;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

export class Compare {
  readonly extension: Extension;
  readonly #slot = new Compartment();
  #changes: Change[] = [];
  #at = -1;
  #hash = "";
  readonly #bar: HTMLElement;
  readonly #marks: HTMLElement;
  /** True while a save is being compared. */
  active = false;

  constructor(
    private readonly view: () => EditorView | null,
    private readonly post: (msg: object) => void,
  ) {
    this.extension = this.#slot.of([]);
    this.#bar = document.getElementById("cmpbar")!;
    this.#marks = document.createElement("div");
    this.#marks.id = "cmpmarks";
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
    this.#changes = wordDiff(base, v.state.doc.toString());
    const ranges: Range<Decoration>[] = [];
    const doc = v.state.doc;
    for (const c of this.#changes) {
      if (c.deleted) ranges.push(Decoration.widget({ widget: new Removed(c.deleted), side: -1 }).range(c.from));
      if (c.to > c.from) {
        const text = doc.sliceString(c.from, c.to);
        if (/^\s+$/.test(text)) ranges.push(Decoration.widget({ widget: new AddedSpace(text), side: -1 }).range(c.from));
        else ranges.push(added.range(c.from, c.to));
      }
    }
    v.dispatch({ effects: this.#slot.reconfigure(EditorView.decorations.of(Decoration.set(ranges, true))) });
    this.active = true;
    document.body.classList.add("comparing");
    const n = this.#changes.length;
    const when = new Date(at).toLocaleString([], { month: "short", day: "numeric", year: new Date(at).getFullYear() === new Date().getFullYear() ? undefined : "numeric", hour: "numeric", minute: "2-digit" });
    this.#bar.querySelector(".cmp-what")!.textContent = `Comparing with ${when} · ${n === 0 ? "no changes" : n === 1 ? "1 change" : `${n.toLocaleString()} changes`}`;
    for (const b of this.#bar.querySelectorAll<HTMLButtonElement>(".cmp-prev, .cmp-next")) b.disabled = n === 0;
    this.#bar.hidden = false;
    v.dom.append(this.#marks);
    this.#at = -1;
    this.#placeMarks();
    if (n) requestAnimationFrame(() => this.#go(1));
  }

  /** Back to the text as usual. */
  end(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove("comparing");
    this.#bar.hidden = true;
    this.#marks.remove();
    this.#changes = [];
    this.view()?.dispatch({ effects: this.#slot.reconfigure([]) });
  }

  #go(step: number): void {
    const v = this.view();
    if (!v || !this.#changes.length) return;
    const n = this.#changes.length;
    this.#at = this.#at < 0 ? (step > 0 ? 0 : n - 1) : (this.#at + step + n) % n;
    const c = this.#changes[this.#at]!;
    v.dispatch({ selection: { anchor: c.from }, effects: EditorView.scrollIntoView(c.from, { y: "center" }) });
    this.#bar.querySelector(".cmp-where")!.textContent = `${this.#at + 1} of ${n}`;
  }

  #placeMarks(): void {
    const v = this.view();
    if (!v || !this.active) return;
    // By where each change is in the text, not by line heights: CodeMirror only estimates those
    // for lines not yet shown, and the marks moved as it measured them while scrolling.
    const length = Math.max(1, v.state.doc.length);
    this.#marks.replaceChildren(
      ...this.#changes.map((c, i) => {
        const m = document.createElement("div");
        m.className = c.to > c.from ? "cmp-mark" : "cmp-mark cmp-mark-del";
        m.style.top = `${((c.from / length) * 100).toFixed(3)}%`;
        m.onclick = () => {
          this.#at = i - 1;
          this.#go(1);
        };
        return m;
      }),
    );
  }
}
