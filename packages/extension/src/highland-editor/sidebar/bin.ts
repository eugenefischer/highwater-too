import type { BinCard } from "../messages.ts";
import { $, button, faintDragImage, keys, type SidebarDeps } from "./ui.ts";

// ---------------------------------------------------------------------------------------------
// The Bin, as Highland 2's: each item a card showing its text (six lines, then "…"). Click a card
// to select it (a delete button appears at its top right; Delete or Backspace works too), double-
// click to edit it in place. Drag text from the page onto the Bin to move it there (no Shift: the
// page and the Bin are one webview); drag a card into the page to put it back; drag cards to reorder
// them. The Filter at the foot narrows the cards by their words.

export const BIN_TYPE = "application/x-highwater-bin";
/** Marks an image reference dragged from Assets (the page puts it in as a paragraph of its own). */
export const ASSET_TYPE = "application/x-highwater-asset";

export class BinPanel {
  readonly #list = $("binlist");
  readonly #empty = $("binempty");
  readonly #filter = $<HTMLInputElement>("binfilter");
  #cards: BinCard[] = [];
  #selected = -1;
  /** The card being edited, and its edit not yet saved. */
  #editing: { index: number; area: HTMLTextAreaElement; timer: ReturnType<typeof setTimeout> | undefined } | null = null;
  #available = false;
  get count(): number {
    return this.#cards.length;
  }
  /** A new item was asked for with +: open it for editing when it arrives at this index. */
  #newAt = -1;

  constructor(private readonly deps: SidebarDeps) {
    this.#filter.addEventListener("input", () => this.#render());
    this.#popover();
    $("binnew").onclick = () => {
      this.#newAt = this.#cards.length;
      deps.bin({ kind: "add", index: this.#cards.length, text: "" });
    };
    $("binexport").onclick = () => deps.post({ type: "binExport" });
    const panel = $("binpanel");
    panel.addEventListener("dragover", (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (!this.#available || (!types.includes("text/plain") && !types.includes(BIN_TYPE))) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = types.includes(BIN_TYPE) ? "move" : "copy";
      this.#mark(e);
    });
    panel.addEventListener("dragleave", (e) => {
      if (!panel.contains(e.relatedTarget as Node | null)) this.#unmark();
    });
    panel.addEventListener("drop", (e) => {
      e.preventDefault();
      const target = this.#dropIndex(e);
      this.#unmark();
      const own = e.dataTransfer?.getData(BIN_TYPE);
      if (own) {
        const from = Number(own);
        // Dropped after itself or right before itself: nothing moves.
        let to = target ?? this.#cards.length;
        if (to > from) to--;
        to = Math.min(to, this.#cards.length - 1);
        if (to !== from) deps.bin({ kind: "move", from, to });
        return;
      }
      const text = e.dataTransfer?.getData("text/plain");
      if (!text || !text.trim()) return;
      // Text dragged from the page moves into the Bin, as Cut to Bin does.
      deps.bin({ kind: "add", index: this.#cards.length, text }, text);
    });
    // Clicking the panel's empty space clears the selection.
    panel.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".bincard")) this.#select(-1);
    });
    this.#list.tabIndex = 0;
    this.#list.addEventListener("keydown", (e) => {
      if (this.#editing || this.#selected < 0) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.#delete(this.#selected);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.#select(Math.max(0, Math.min(this.#cards.length - 1, this.#selected + (e.key === "ArrowDown" ? 1 : -1))));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const el = this.#list.querySelector<HTMLElement>(`[data-index="${this.#selected}"]`);
        if (el) this.#edit(this.#selected, el);
      }
    });
  }

  show(cards: BinCard[], available: boolean): void {
    this.#available = available;
    // While an item is open in the popover, keep its text as typed (the saved copy may lag behind).
    const e = this.#editing;
    if (e && cards[e.index] !== undefined) cards[e.index] = { ...cards[e.index]!, text: e.area.value };
    else if (e) this.#close();
    this.#cards = cards;
    if (this.#selected >= cards.length) this.#selected = -1;
    this.#render();
    if (this.#newAt >= 0 && cards.length > this.#newAt) {
      const at = this.#newAt;
      this.#newAt = -1;
      this.#filter.value = "";
      this.#render();
      const el = this.#list.querySelector<HTMLElement>(`[data-index="${at}"]`);
      if (el) {
        this.#select(at);
        this.#edit(at, el);
      }
    }
    $("binnew").hidden = $("binexport").hidden = !available;
    this.#empty.textContent = available ? `The Bin holds blocks of text. Drag and drop text in and out, or use Cut to Bin (${keys("⌥⌘X")}) and Copy to Bin (${keys("⌥⌘C")}).` : "Open a document to use its Bin.";
  }

  #render(): void {
    const words = this.#filter.value.trim().toLowerCase();
    this.#list.replaceChildren(...this.#cards.flatMap((c, i) => (words && !c.text.toLowerCase().includes(words) ? [] : [this.#card(c, i)])));
    this.#empty.hidden = this.#cards.length > 0;
  }

  #card(c: BinCard, index: number): HTMLElement {
    const el = document.createElement("div");
    el.className = `bincard${index === this.#selected ? " selected" : ""}`;
    el.draggable = true;
    el.dataset.index = String(index);
    const text = document.createElement("div");
    text.className = "bincard-text";
    text.textContent = c.text;
    el.append(text, button("Delete", '<circle cx="12" cy="12" r="9"/><path d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/>', () => this.#delete(index), "bincard-delete"));
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", this.#cards[index]?.text ?? "");
      e.dataTransfer!.setData(BIN_TYPE, String(index));
      e.dataTransfer!.effectAllowed = "copyMove";
      faintDragImage(e, this.#cards[index]?.text ?? "");
    });
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.#select(index);
    });
    el.addEventListener("dblclick", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      this.#edit(index, el);
    });
    return el;
  }

  #select(index: number): void {
    if (index === this.#selected) return;
    this.#selected = index;
    for (const el of this.#list.querySelectorAll<HTMLElement>(".bincard")) el.classList.toggle("selected", Number(el.dataset.index) === index);
    if (index >= 0) {
      this.#list.focus({ preventScroll: true });
      this.#list.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
    }
  }

  #delete(index: number): void {
    this.#selected = -1;
    const text = this.#cards[index]?.text;
    if (text !== undefined) this.deps.bin({ kind: "remove", index, text });
  }

  /**
   * Opens an item in Highland's editing popover: a plain-text box beside the sidebar, its arrow
   * pointing at the card. What is typed is saved as you go; Escape, ⌘Enter or a click outside closes it.
   */
  #edit(index: number, el: HTMLElement): void {
    if (this.#editing?.index === index) return;
    this.#finish();
    const pop = $("binpop");
    const area = $<HTMLTextAreaElement>("binpoptext");
    area.value = this.#cards[index]?.text ?? "";
    pop.hidden = false;
    // Beside the sidebar, as tall as it can be up to 345 px, centred on the card where it fits.
    const card = el.getBoundingClientRect();
    const side = $("sidebar").getBoundingClientRect();
    const height = Math.min(345, window.innerHeight - 24);
    const middle = card.top + Math.min(card.height, 80) / 2;
    const top = Math.max(12, Math.min(window.innerHeight - height - 12, middle - height / 2));
    pop.style.left = `${Math.round(side.right + 10)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.height = `${height}px`;
    pop.style.setProperty("--arrow", `${Math.round(Math.max(16, Math.min(height - 16, middle - top)))}px`);
    const editing = { index, area, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.#editing = editing;
    this.#select(index);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  /** Saves what the popover holds (if changed). */
  #save(): void {
    const e = this.#editing;
    if (!e) return;
    clearTimeout(e.timer);
    const text = e.area.value;
    if (text !== this.#cards[e.index]?.text) {
      this.#cards[e.index] = { ...this.#cards[e.index]!, text };
      this.deps.post({ type: "binEdit", index: e.index, text });
    }
  }

  /** Wires the popover once: saving as you type, and closing. */
  #popover(): void {
    const pop = $("binpop");
    const area = $<HTMLTextAreaElement>("binpoptext");
    area.addEventListener("input", () => {
      const e = this.#editing;
      if (!e) return;
      clearTimeout(e.timer);
      e.timer = setTimeout(() => this.#save(), 600);
    });
    area.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[biuy/.=\-]$/i.test(e.key)) e.stopPropagation();
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        this.#close();
      }
    });
    // A click anywhere outside it closes it.
    window.addEventListener(
      "mousedown",
      (e) => {
        if (this.#editing && !pop.contains(e.target as Node)) this.#close();
      },
      true,
    );
    window.addEventListener("blur", () => this.#save());
  }

  #close(): void {
    if (!this.#editing) return;
    this.#save();
    this.#finish();
    $("binpop").hidden = true;
    this.#render();
    this.#list.focus({ preventScroll: true });
  }

  #finish(): void {
    if (!this.#editing) return;
    clearTimeout(this.#editing.timer);
    this.#editing = null;
  }

  /** The card the pointer is over (dropping goes before it), or null for the end. */
  #dropIndex(e: DragEvent): number | null {
    for (const el of this.#list.querySelectorAll<HTMLElement>(".bincard")) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return Number(el.dataset.index);
    }
    return null;
  }

  #mark(e: DragEvent): void {
    $("binpanel").classList.add("dropping");
    const at = this.#dropIndex(e);
    for (const el of this.#list.querySelectorAll<HTMLElement>(".bincard")) el.classList.toggle("drop-before", Number(el.dataset.index) === at);
    this.#list.classList.toggle("drop-end", at === null);
  }

  #unmark(): void {
    $("binpanel").classList.remove("dropping");
    for (const el of this.#list.querySelectorAll(".drop-before")) el.classList.remove("drop-before");
    this.#list.classList.remove("drop-end");
  }
}
