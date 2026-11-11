/**
 * Check Spelling While Typing in the Highland-Style Editor (highwater.spellCheck, off by default):
 * misspelled words underlined with red dots, as macOS draws them in Highland 2. Right-click one
 * for guesses, Ignore Spelling or Learn Spelling; ⌘; goes to the next misspelling. The dictionary
 * is Hunspell's American English (SCOWL), checked in a worker; learned words are a setting.
 */
import { EditorSelection, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { Document } from "@highwater/parser";
import { key, matchCase, spellContext, wordsToCheck, type SpellContext, type Word } from "./spell-words.ts";

const recheck = StateEffect.define<null>();
const misspelled = Decoration.mark({ class: "hl-misspelled" });

export class Spelling {
  on = false;
  /** Learn Spelling (kept in highwater.spellingWords), and Ignore Spelling (this tab, until closed). */
  #learned = new Set<string>();
  #ignored = new Set<string>();
  /** Dictionary answers by word: true when spelled correctly. */
  #known = new Map<string, boolean>();
  #asked = new Set<string>();
  #worker: Worker | null = null;
  #next = 0;
  #replies = new Map<number, (data: { bad?: string[]; list?: string[] }) => void>();
  #flush: ReturnType<typeof setTimeout> | null = null;
  #context: { doc: Document; ctx: SpellContext } | null = null;

  constructor(
    private readonly views: () => EditorView | null,
    private readonly parsed: () => Document | null,
    private readonly post: (msg: unknown) => void,
  ) {}

  /** From the extension: on or off, and the learned words. */
  configure(on: boolean, words: string[]): void {
    this.on = on;
    this.#learned = new Set(words.map(key));
    if (on) this.#start();
    this.refresh();
  }

  refresh(): void {
    this.views()?.dispatch({ effects: recheck.of(null) });
  }

  /** The words worth checking in the source between two offsets. */
  words(text: string, from: number): Word[] {
    const doc = this.parsed();
    if (!doc) return [];
    if (this.#context?.doc !== doc) this.#context = { doc, ctx: spellContext(doc) };
    return wordsToCheck(text, from, this.#context.ctx);
  }

  /** True or false when known; undefined (and asked for) when not yet. */
  bad(word: string): boolean | undefined {
    const k = key(word);
    if (this.#learned.has(k) || this.#ignored.has(k) || this.#learned.has(k.toLowerCase())) return false;
    const known = this.#known.get(k);
    if (known !== undefined) return !known;
    this.#ask([k]);
    return undefined;
  }

  /** Checks words not yet known, all at once (Next Misspelling). */
  async checkAll(words: string[]): Promise<void> {
    const unknown = [...new Set(words.map(key))].filter((k) => !this.#known.has(k));
    if (!unknown.length) return;
    const bad = new Set((await this.#request({ type: "check", words: unknown })).bad ?? []);
    for (const k of unknown) this.#known.set(k, !bad.has(k));
  }

  async suggest(word: string): Promise<string[]> {
    const list = (await this.#request({ type: "suggest", word: key(word) })).list ?? [];
    return [...new Set(list.map((s) => matchCase(word, s)))];
  }

  ignore(word: string): void {
    this.#ignored.add(key(word));
    this.refresh();
  }

  learn(word: string): void {
    this.#learned.add(key(word));
    this.post({ type: "learnWord", word: key(word) });
    this.refresh();
  }

  #ask(keys: string[]): void {
    for (const k of keys) this.#asked.add(k);
    this.#flush ??= setTimeout(() => {
      this.#flush = null;
      const words = [...this.#asked].filter((k) => !this.#known.has(k));
      this.#asked.clear();
      if (!words.length) return;
      void this.#request({ type: "check", words }).then(({ bad = [] }) => {
        const wrong = new Set(bad);
        for (const k of words) this.#known.set(k, !wrong.has(k));
        this.refresh();
      });
    }, 30);
  }

  #request(msg: { type: "check"; words: string[] } | { type: "suggest"; word: string }): Promise<{ bad?: string[]; list?: string[] }> {
    this.#start();
    const id = ++this.#next;
    return new Promise((resolve) => {
      this.#replies.set(id, resolve);
      this.#worker?.postMessage({ ...msg, id });
    });
  }

  /** Starts the worker and loads the dictionary, the first time spelling is on. */
  #start(): void {
    if (this.#worker) return;
    const data = document.body.dataset;
    // Workers must come from the webview's own origin: load the code and start it from a blob.
    const code = fetch(data.spellWorker!).then((r) => r.text());
    const aff = fetch(data.dictAff!).then((r) => r.text());
    const dic = fetch(data.dictDic!).then((r) => r.text());
    const queue: unknown[] = [];
    const worker = {
      postMessage: (m: unknown) => queue.push(m),
    } as unknown as Worker;
    this.#worker = worker;
    void Promise.all([code, aff, dic]).then(([c, a, d]) => {
      const real = new Worker(URL.createObjectURL(new Blob([c], { type: "text/javascript" })));
      real.onmessage = (e: MessageEvent<{ id: number; bad?: string[]; list?: string[] }>) => {
        this.#replies.get(e.data.id)?.(e.data);
        this.#replies.delete(e.data.id);
      };
      real.postMessage({ type: "init", aff: a, dic: d });
      for (const m of queue) real.postMessage(m);
      this.#worker = real;
    });
  }
}

/** The underlines, for the visible text; the word being typed waits until the cursor leaves it. */
export function spellingPlugin(spelling: Spelling) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      /** Misspellings shown, for the right-click menu. */
      bad: Word[] = [];
      constructor(v: EditorView) {
        this.build(v);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(recheck)))) this.build(u.view);
      }
      build(v: EditorView): void {
        this.bad = [];
        if (!spelling.on) {
          this.decorations = Decoration.none;
          return;
        }
        const doc = v.state.doc;
        const head = v.state.selection.main.head;
        const ranges = [];
        let last = -1;
        for (const r of v.visibleRanges) {
          const from = Math.max(doc.lineAt(r.from).from, last);
          const to = doc.lineAt(r.to).to;
          if (to <= from) continue;
          last = to;
          for (const w of spelling.words(doc.sliceString(from, to), from)) {
            if (w.to === head && v.hasFocus) continue; // still being typed
            if (spelling.bad(w.text)) {
              this.bad.push(w);
              ranges.push(misspelled.range(w.from, w.to));
            }
          }
        }
        this.decorations = Decoration.set(ranges, true);
      }
    },
    { decorations: (p) => p.decorations },
  );
}

/** ⌘;: selects the next misspelled word after the cursor, from the top again at the end. */
export async function nextMisspelling(view: EditorView, spelling: Spelling): Promise<void> {
  if (!spelling.on) return;
  const text = view.state.doc.toString();
  const words = spelling.words(text, 0);
  await spelling.checkAll(words.map((w) => w.text));
  const head = view.state.selection.main.to;
  const found = words.find((w) => w.from >= head && spelling.bad(w.text)) ?? words.find((w) => spelling.bad(w.text));
  if (!found) return;
  view.dispatch({ selection: EditorSelection.single(found.from, found.to), effects: EditorView.scrollIntoView(found.from, { y: "center" }) });
  view.focus();
}

/** Right-click on a misspelled word: guesses, Ignore Spelling, Learn Spelling (else VS Code's menu). */
export function spellingMenu(view: EditorView, spelling: Spelling, plugin: ViewPlugin<{ bad: Word[] }>): void {
  let menu: HTMLElement | null = null;
  const close = () => {
    menu?.remove();
    menu = null;
  };
  view.dom.addEventListener("contextmenu", (e) => {
    close();
    if (!spelling.on) return;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    const word = pos === null ? undefined : view.plugin(plugin)?.bad.find((w) => w.from <= pos && pos <= w.to);
    if (!word) return;
    e.preventDefault(); // VS Code's own menu shows only when this one doesn't
    view.dispatch({ selection: EditorSelection.single(word.from, word.to) });
    const m = document.createElement("div");
    m.className = "hl-spellmenu";
    m.setAttribute("role", "menu");
    const item = (label: string, run: (() => void) | null, cls = "") => {
      const b = document.createElement("button");
      b.textContent = label;
      b.className = cls;
      b.disabled = !run;
      if (run)
        b.addEventListener("click", () => {
          close();
          run();
          view.focus();
        });
      m.appendChild(b);
      return b;
    };
    const guesses = document.createElement("div");
    guesses.appendChild(item("…", null, "hl-spell-wait"));
    m.appendChild(guesses);
    m.appendChild(document.createElement("hr"));
    item("Ignore Spelling", () => spelling.ignore(word.text));
    item("Learn Spelling", () => spelling.learn(word.text));
    m.style.left = `${e.clientX}px`;
    m.style.top = `${e.clientY}px`;
    document.body.appendChild(m);
    menu = m;
    const place = () => {
      const r = m.getBoundingClientRect();
      if (r.right > window.innerWidth) m.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
      if (r.bottom > window.innerHeight) m.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
    };
    place();
    void spelling.suggest(word.text).then((list) => {
      if (menu !== m) return;
      guesses.replaceChildren();
      const items = list.length ? list : null;
      if (!items) guesses.appendChild(item("No Guesses Found", null));
      for (const s of items ?? []) {
        const b = item(s, () => {
          // Only if the word is still there.
          if (view.state.sliceDoc(word.from, word.to) === word.text) view.dispatch({ changes: { from: word.from, to: word.to, insert: s }, selection: { anchor: word.from + s.length } });
        });
        guesses.appendChild(b);
      }
      place();
    });
  });
  window.addEventListener("mousedown", (e) => menu && !menu.contains(e.target as Node) && close(), true);
  window.addEventListener("keydown", (e) => e.key === "Escape" && close(), true);
  window.addEventListener("blur", close);
  view.scrollDOM.addEventListener("scroll", close);
}
