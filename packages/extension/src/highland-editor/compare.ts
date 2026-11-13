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
  readonly #resize: ResizeObserver;
  #frame = 0;
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
    // Placed again when the page's width or height changes (the window, the sidebar, the text size).
    let last = "";
    this.#resize = new ResizeObserver(() => {
      const v = this.view();
      if (!v || !this.active) return;
      const size = `${Math.round(v.contentDOM.getBoundingClientRect().width)}x${Math.round(v.scrollDOM.clientHeight)}`;
      if (size === last) return;
      last = size;
      cancelAnimationFrame(this.#frame);
      this.#frame = requestAnimationFrame(() => this.#placeMarks());
    });
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
    this.#resize.observe(v.contentDOM);
    this.#resize.observe(v.scrollDOM);
    if (n) requestAnimationFrame(() => this.#go(1));
  }

  /** Back to the text as usual. */
  end(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove("comparing");
    this.#bar.hidden = true;
    this.#marks.remove();
    this.#resize.disconnect();
    cancelAnimationFrame(this.#frame);
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
    // Where each change is, as a share of the text's full height, measured exactly: CodeMirror only
    // estimates the heights of lines not yet shown (marks placed by its heights moved as it measured
    // them while scrolling), and an estimate from line lengths missed by hundreds of pixels in a
    // full-length screenplay, enough to put a mark outside the scroll thumb.
    const at = measure(v, this.#changes);
    const dom = v.dom.getBoundingClientRect();
    const track = v.scrollDOM.getBoundingClientRect();
    this.#marks.style.top = `${track.top - dom.top}px`;
    this.#marks.style.height = `${track.height}px`;
    this.#marks.style.bottom = "auto";
    this.#marks.replaceChildren(
      ...this.#changes.map((c, i) => {
        const m = document.createElement("div");
        m.className = c.to > c.from ? "cmp-mark" : "cmp-mark cmp-mark-del";
        m.style.top = `${(at[i]! * 100).toFixed(4)}%`;
        m.onclick = () => {
          this.#at = i - 1;
          this.#go(1);
        };
        return m;
      }),
    );
  }
}

/**
 * Each change's place, as a share (0–1) of the text's height: the text laid out off the page in
 * a copy of the editor at the same width, with the same line styles, inline styles and removed
 * text, and the middle of each change's row measured.
 */
function measure(v: EditorView, changes: readonly Change[]): number[] {
  const doc = v.state.doc;
  const lineAttrs = new Map<number, { cls: string; style: string }>();
  const marks: { from: number; to: number; cls: string }[] = [];
  for (const source of v.state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? source(v) : source;
    set.between(0, doc.length, (from, to, deco) => {
      const spec = deco.spec as { widget?: unknown; class?: string; attributes?: Record<string, string> };
      if (spec.widget) return;
      const cls = [spec.class ?? "", spec.attributes?.class ?? ""].join(" ").trim();
      if (from === to) {
        const a = lineAttrs.get(from) ?? { cls: "", style: "" };
        a.cls += ` ${cls}`;
        if (spec.attributes?.style) a.style += `;${spec.attributes.style}`;
        lineAttrs.set(from, a);
      } else if (cls) marks.push({ from, to, cls });
    });
  }
  marks.sort((a, b) => a.from - b.from);

  const outer = document.createElement("div");
  outer.style.cssText = "position: fixed; left: -100000px; top: 0; width: 100000px; visibility: hidden; pointer-events: none";
  const editor = outer.appendChild(document.createElement("div"));
  editor.className = v.dom.className;
  editor.style.setProperty("height", "auto", "important");
  const scroller = editor.appendChild(document.createElement("div"));
  scroller.className = v.scrollDOM.className;
  scroller.style.setProperty("overflow", "visible", "important");
  scroller.style.setProperty("height", "auto", "important");
  const content = scroller.appendChild(document.createElement("div"));
  content.className = v.contentDOM.className;
  const width = v.contentDOM.getBoundingClientRect().width;
  for (const [k, value] of [["flex", `0 0 ${width}px`], ["width", `${width}px`], ["max-width", "none"], ["min-width", "0"], ["box-sizing", "border-box"], ["margin", "0"]] as const) {
    content.style.setProperty(k, value, "important");
  }

  const order = changes.map((_, i) => i).sort((a, b) => changes[a]!.from - changes[b]!.from);
  const spots: HTMLElement[] = [];
  let next = 0;
  let firstMark = 0;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const div = content.appendChild(document.createElement("div"));
    const a = lineAttrs.get(line.from);
    div.className = `cm-line${a ? a.cls : ""}`;
    if (a?.style) div.style.cssText = a.style;
    while (firstMark < marks.length && marks[firstMark]!.to <= line.from) firstMark++;
    const inLine: typeof marks = [];
    for (let k = firstMark; k < marks.length && marks[k]!.from < line.to; k++) if (marks[k]!.to > line.from) inLine.push(marks[k]!);
    const here: number[] = [];
    while (next < order.length && changes[order[next]!]!.from <= line.to) here.push(order[next++]!);
    const cuts = new Set([line.from, line.to]);
    for (const m of inLine) cuts.add(Math.max(m.from, line.from)).add(Math.min(m.to, line.to));
    for (const i of here) cuts.add(changes[i]!.from);
    const points = [...cuts].sort((x, y) => x - y);
    for (let j = 0; j < points.length; j++) {
      const from = points[j]!;
      for (const i of here) {
        if (changes[i]!.from !== from) continue;
        const spot = div.appendChild(document.createElement("span"));
        spots[i] = spot;
        const c = changes[i]!;
        if (c.deleted) div.appendChild(new Removed(c.deleted).toDOM());
        if (c.to > c.from && /^\s+$/.test(doc.sliceString(c.from, c.to))) div.appendChild(new AddedSpace(doc.sliceString(c.from, c.to)).toDOM());
      }
      const to = points[j + 1];
      if (to === undefined || to <= from) continue;
      const text = doc.sliceString(from, to);
      const cls = inLine.filter((m) => m.from <= from && m.to >= to).map((m) => m.cls).join(" ");
      if (cls) {
        const span = div.appendChild(document.createElement("span"));
        span.className = cls;
        span.textContent = text;
      } else div.append(text);
    }
    if (!div.textContent) div.appendChild(document.createElement("br"));
  }
  document.body.appendChild(outer);
  const top = content.getBoundingClientRect().top;
  const height = Math.max(1, content.offsetHeight);
  const at = changes.map((_, i) => {
    const r = spots[i]?.getClientRects()[0];
    return r ? Math.min(1, Math.max(0, (r.top + r.height / 2 - top) / height)) : 0;
  });
  outer.remove();
  return at;
}
