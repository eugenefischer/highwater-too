/**
 * Highland 2's sidebar, inside the Highland-Style Editor (0.6.0): a row of icons at its top
 * (Navigator, Bin, Statistics, Assets, Scratchpad, then Highwater's Writing History and Works),
 * one panel below. Its width, whether it shows, and the panel shown are kept for every document.
 * This file is the page's side; the extension's is sidebar-host.ts.
 */
import type { Document } from "@highwater/parser";
import { blockAt, currentRow, moveBlock, navigatorItems, navigatorRows, parseFilters, type NavigatorFilters, type NavigatorRow } from "../syntax/navigator.ts";

export const PANELS = ["navigator", "bin", "stats", "assets", "scratchpad", "history", "works"] as const;
export type PanelName = (typeof PANELS)[number];

export interface SidebarState {
  open: boolean;
  panel: PanelName;
  width: number;
}

export interface SidebarDeps {
  post(msg: unknown): void;
  /** The latest parse of the text. */
  parsed(): Document | null;
  /** The text's length, and the cursor's offset. */
  length(): number;
  head(): number;
  /** Goes to an offset in the text (or the pages, when they show), moving the cursor there. */
  reveal(offset: number): void;
  /** Changes the text as the writer's own edit (sent on to the document; undoable). */
  edit(changes: { from: number; to: number; insert: string }[]): void;
  /** Puts text in at the cursor (a Bin item, an image reference). */
  insert(text: string): void;
  /** Takes out of the page the text being dragged from it, if this is that text (dragging to the Bin cuts). */
  cutDragged(text: string): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MIN_WIDTH = 240;
const MAX_WIDTH = 520;

export class Sidebar {
  #state: SidebarState = { open: true, panel: "navigator", width: 264 };
  readonly #nav: NavigatorPanel;
  readonly #scratch: ScratchpadPanel;
  readonly #bin: BinPanel;
  readonly #assets: AssetsPanel;

  constructor(private readonly deps: SidebarDeps) {
    this.#nav = new NavigatorPanel(deps);
    this.#scratch = new ScratchpadPanel(deps);
    this.#bin = new BinPanel(deps);
    this.#assets = new AssetsPanel(deps);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#sbicons [data-panel]")) b.onclick = () => this.show(b.dataset.panel as PanelName);
    $("tbsidebar").onclick = () => this.toggle();
    for (const b of document.querySelectorAll<HTMLButtonElement>("[data-view]")) b.onclick = () => deps.post({ type: "showView", view: b.dataset.view });
    this.#resizer();
    this.#apply();
  }

  /** The saved state, from the extension. */
  restore(state: Partial<SidebarState>): void {
    this.#state = {
      open: state.open ?? this.#state.open,
      panel: PANELS.includes(state.panel as PanelName) ? (state.panel as PanelName) : this.#state.panel,
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, state.width ?? this.#state.width)),
    };
    this.#apply();
  }

  toggle(): void {
    this.#state.open = !this.#state.open;
    this.#apply();
    this.#save();
  }

  /** Shows a panel (opening the sidebar if it is hidden). */
  show(panel: PanelName): void {
    this.#state = { ...this.#state, panel, open: true };
    this.#apply();
    this.#save();
    if (panel === "scratchpad") this.#scratch.focus();
  }

  /** The text changed or the cursor moved. */
  textChanged(): void {
    this.#nav.textChanged();
  }
  cursorMoved(): void {
    this.#nav.cursorMoved();
  }

  receive(msg: { type: string } & Record<string, unknown>): boolean {
    if (msg.type === "sidebar") this.restore(msg.state as Partial<SidebarState>);
    else if (msg.type === "navFilters") this.#nav.filters(msg.json as string | undefined, msg.filters as NavigatorFilters | undefined);
    else if (msg.type === "scratchpad") this.#scratch.load(String(msg.text ?? ""), !!msg.force);
    else if (msg.type === "scratchpadSaved") this.#scratch.saved(String(msg.text ?? ""));
    else if (msg.type === "bin") this.#bin.show(msg.items as BinCard[], !!msg.available);
    else if (msg.type === "assets") this.#assets.show(msg.items as AssetCard[], !!msg.available);
    else if (msg.type === "showPanel" && PANELS.includes(msg.panel as PanelName)) this.show(msg.panel as PanelName);
    else if (msg.type === "toggleSidebar") this.toggle();
    else return false;
    return true;
  }

  #apply(): void {
    document.body.classList.toggle("sb-closed", !this.#state.open);
    document.documentElement.style.setProperty("--sb-width", `${this.#state.width}px`);
    for (const b of document.querySelectorAll<HTMLElement>("#sbicons [data-panel]")) {
      const on = b.dataset.panel === this.#state.panel;
      b.classList.toggle("sb-on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    for (const p of document.querySelectorAll<HTMLElement>("#sbpanels > section")) p.hidden = p.dataset.panel !== this.#state.panel;
  }

  #save(): void {
    this.deps.post({ type: "sidebarState", state: this.#state });
  }

  /** Dragging the sidebar's right edge changes its width. */
  #resizer(): void {
    const grip = $("sbgrip");
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      grip.setPointerCapture(e.pointerId);
      document.body.classList.add("sb-resizing");
      const move = (ev: PointerEvent) => {
        this.#state.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(ev.clientX)));
        document.documentElement.style.setProperty("--sb-width", `${this.#state.width}px`);
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        document.body.classList.remove("sb-resizing");
        this.#save();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up, { once: true });
      grip.addEventListener("lostpointercapture", up, { once: true });
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The Navigator: the document's scenes, sections and the rest, worked out here from the page's
// own text. Click to go there; drag a scene or section to move it (the move is an ordinary edit,
// so ⌘Z takes it back); filter by words at the foot, or choose what it lists with the eye.

class NavigatorPanel {
  #rows: NavigatorRow[] = [];
  #current = -1;
  #filters: NavigatorFilters = parseFilters(undefined);
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #list = $("navlist");
  readonly #empty = $("navempty");
  readonly #filter = $<HTMLInputElement>("navfilter");
  readonly #dropLine = $("navdrop");
  #dragging: NavigatorRow | null = null;
  #gap: (Gap & { moves: boolean }) | null = null;
  #pressed: { row: NavigatorRow; el: HTMLElement; y: number; pointer: number } | null = null;
  #justDragged = false;
  #pointer = { x: 0, y: 0 };
  #scrolling = 0;

  constructor(private readonly deps: SidebarDeps) {
    this.#filter.addEventListener("input", () => this.#render());
    $("navtypes").onclick = () => deps.post({ type: "navTypes" });
    this.#list.addEventListener("click", (e) => {
      if (this.#justDragged) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>(".row");
      const row = el ? this.#rows[Number(el.dataset.index)] : undefined;
      if (row) deps.reveal(row.start);
    });
    this.#dragging_();
  }

  /** The kinds to list: the document's navigatorFilters.json (Highland's), or the writer's choice here. */
  filters(json: string | undefined, chosen: NavigatorFilters | undefined): void {
    this.#filters = chosen ? { ...parseFilters(undefined), ...chosen } : parseFilters(json);
    this.#list_();
  }

  textChanged(): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#list_(), 150);
  }

  cursorMoved(): void {
    const now = currentRow(this.#rows, this.deps.head());
    if (now === this.#current) return;
    this.#current = now;
    for (const el of this.#list.querySelectorAll(".current")) el.classList.remove("current");
    const el = this.#list.querySelector<HTMLElement>(`[data-index="${now}"]`);
    el?.classList.add("current");
    el?.scrollIntoView({ block: "nearest" });
  }

  #list_(): void {
    const parsed = this.deps.parsed();
    this.#rows = parsed ? navigatorRows(parsed, navigatorItems(parsed, this.#filters)) : [];
    this.#current = currentRow(this.#rows, this.deps.head());
    if (!this.#dragging) this.#render();
  }

  #render(): void {
    const words = this.#filter.value.trim().toLowerCase();
    this.#list.replaceChildren();
    this.#rows.forEach((row, i) => {
      if (words && !row.label.toLowerCase().includes(words)) return;
      const el = document.createElement("div");
      el.className = `row ${row.type}${i === this.#current ? " current" : ""}`;
      el.dataset.index = String(i);
      el.style.paddingLeft = `${10 + (words ? 0 : row.depth) * 12}px`;
      el.textContent = row.label;
      el.title = row.label;
      // Scenes, sections and headings can be dragged (not while filtering: the gaps would be hidden).
      if (row.blockEnd !== null && !words) el.dataset.draggable = "true";
      this.#list.append(el);
    });
    // Highland's words when there is nothing to list.
    this.#empty.hidden = this.#rows.length > 0;
  }

  // Dragging: a scene, section or heading drops before another one, or at the end of the text,
  // with a line showing where. With the pointer (captured), not the browser's drag and drop.
  #dragging_(): void {
    const list = this.#list;
    list.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>(".row");
      const row = el ? this.#rows[Number(el.dataset.index)] : undefined;
      if (!el || !row || el.dataset.draggable !== "true") return;
      this.#pressed = { row, el, y: e.clientY, pointer: e.pointerId };
    });
    list.addEventListener("pointermove", (e) => {
      const pressed = this.#pressed;
      if (!pressed || e.pointerId !== pressed.pointer) return;
      if (!this.#dragging) {
        if (Math.abs(e.clientY - pressed.y) < 4) return;
        this.#dragging = pressed.row;
        pressed.el.setPointerCapture(e.pointerId);
        pressed.el.classList.add("dragging");
        document.body.classList.add("nav-dragging");
      }
      this.#pointer = { x: e.clientX, y: e.clientY };
      this.#place();
      if (this.#edgeSpeed() !== 0 && !this.#scrolling) this.#scrolling = requestAnimationFrame(() => this.#autoScroll());
    });
    list.addEventListener("pointerup", (e) => {
      if (!this.#pressed || e.pointerId !== this.#pressed.pointer) return;
      if (this.#dragging) {
        if (this.#gap) this.#move(this.#dragging.start, this.#gap.to);
        this.#justDragged = true; // the click that follows isn't a click on the row
        setTimeout(() => (this.#justDragged = false), 0);
      }
      this.#endDrag();
    });
    list.addEventListener("pointercancel", () => this.#endDrag());
    list.addEventListener("lostpointercapture", () => this.#endDrag());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.#dragging) this.#endDrag();
    });
  }

  #move(from: number, to: number | null): void {
    const parsed = this.deps.parsed();
    if (!parsed) return;
    const block = blockAt(parsed, from);
    const move = block && moveBlock(parsed.source, block, to);
    if (!move) return;
    // Both changes against the text as it is; CodeMirror applies them together.
    this.deps.edit([
      { from: move.insert.at, to: move.insert.at, insert: move.insert.text },
      { from: move.delete.start, to: move.delete.end, insert: "" },
    ]);
  }

  #edgeSpeed(): number {
    if (!this.#dragging) return 0;
    const box = this.#list.getBoundingClientRect();
    const p = this.#pointer;
    if (p.x < box.left || p.x > box.right) return 0;
    const step = (depth: number) => Math.round(2 + 14 * Math.min(1, depth / 32));
    if (p.y < box.top + 32) return -step(box.top + 32 - p.y);
    if (p.y > box.bottom - 32) return step(p.y - (box.bottom - 32));
    return 0;
  }

  #autoScroll(): void {
    const speed = this.#edgeSpeed();
    const before = this.#list.scrollTop;
    if (speed !== 0) this.#list.scrollTop += speed;
    if (speed === 0 || this.#list.scrollTop === before) {
      this.#scrolling = 0;
      return;
    }
    this.#place();
    this.#scrolling = requestAnimationFrame(() => this.#autoScroll());
  }

  #place(): void {
    const list = this.#list;
    const box = list.getBoundingClientRect();
    const p = this.#pointer;
    if (p.x < box.left || p.x > box.right || p.y < box.top || p.y > box.bottom) return this.#hideDrop();
    const y = p.y - box.top + list.scrollTop;
    let best: (Gap & { moves: boolean }) | null = null;
    for (const g of this.#gaps()) if (!best || Math.abs(g.y - y) < Math.abs(best.y - y)) best = g;
    this.#gap = best?.moves ? best : null;
    if (!this.#gap) return this.#hideDrop();
    this.#dropLine.style.top = `${this.#gap.y - 1 - list.scrollTop + list.offsetTop}px`;
    this.#dropLine.style.left = `${12 + this.#gap.depth * 12}px`;
    this.#dropLine.hidden = false;
  }

  #gaps(): (Gap & { moves: boolean })[] {
    const d = this.#dragging!;
    const list = this.#list;
    const top = list.getBoundingClientRect().top - list.scrollTop;
    const moves = (at: number) => !(at >= d.start && at <= d.blockEnd!);
    const out: (Gap & { moves: boolean })[] = [];
    for (const el of list.querySelectorAll<HTMLElement>(".row")) {
      const row = this.#rows[Number(el.dataset.index)]!;
      if (row.blockEnd !== null) out.push({ to: row.start, y: el.getBoundingClientRect().top - top, depth: row.depth, moves: moves(row.start) });
    }
    const last = list.lastElementChild as HTMLElement | null;
    if (last) out.push({ to: null, y: last.getBoundingClientRect().bottom - top, depth: 0, moves: moves(this.deps.length()) });
    return out;
  }

  #hideDrop(): void {
    this.#gap = null;
    this.#dropLine.hidden = true;
  }

  #endDrag(): void {
    cancelAnimationFrame(this.#scrolling);
    this.#scrolling = 0;
    this.#pressed?.el.classList.remove("dragging");
    document.body.classList.remove("nav-dragging");
    this.#pressed = null;
    this.#dragging = null;
    this.#hideDrop();
  }
}

type Gap = { to: number | null; y: number; depth: number };

// ---------------------------------------------------------------------------------------------
// The Scratchpad: Highland's plain-text notes beside the text, saved as you type (in the
// .highland file, or with a plain file's writing history). The button at the bottom right
// exports what it holds to a new document.

class ScratchpadPanel {
  readonly #area = $<HTMLTextAreaElement>("scratch");
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The text last saved (or loaded), to tell the writer's edits from ones made elsewhere. */
  #saved = "";
  #loaded = false;

  constructor(private readonly deps: SidebarDeps) {
    this.#area.addEventListener("input", () => {
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#flush(), 600);
    });
    this.#area.addEventListener("blur", () => this.#flush());
    // Text dragged in from the page is copied, not moved out of it.
    this.#area.addEventListener("dragover", (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    // Put in by hand, so the page keeps its text: at the cursor if the Scratchpad has one, else at the end.
    this.#area.addEventListener("drop", (e) => {
      const text = e.dataTransfer?.getData("text/plain");
      e.preventDefault();
      if (!text) return;
      const area = this.#area;
      const focused = document.activeElement === area;
      const at = focused ? area.selectionStart : area.value.length;
      const end = focused ? area.selectionEnd : at;
      const lead = !focused && area.value && !area.value.endsWith("\n") ? "\n" : "";
      area.setRangeText(lead + text, at, end, "end");
      area.focus();
      area.dispatchEvent(new Event("input"));
    });
    window.addEventListener("blur", () => this.#flush());
    $("scratchexport").onclick = () => {
      this.#flush();
      deps.post({ type: "scratchpadExport", text: this.#area.value });
    };
    // Highwater's formatting keys (⌘B, ⌘I, ⌘U…) would act on the text, not here: keep them from VS Code.
    this.#area.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[biuy/.=\-]$/i.test(e.key)) e.stopPropagation();
    });
  }

  /** The Scratchpad's text from the extension; kept if the writer has changed it since it was last saved. */
  load(text: string, force: boolean): void {
    const edited = this.#area.value !== this.#saved;
    this.#saved = text;
    if (!this.#loaded || force || !edited) this.#area.value = text;
    this.#loaded = true;
  }

  saved(text: string): void {
    this.#saved = text;
  }

  focus(): void {
    this.#area.focus();
  }

  #flush(): void {
    clearTimeout(this.#timer);
    if (!this.#loaded || this.#area.value === this.#saved) return;
    // Taken as saved now (the extension sends the text back if it couldn't be).
    this.#saved = this.#area.value;
    this.deps.post({ type: "scratchpadSave", text: this.#saved });
  }
}

// ---------------------------------------------------------------------------------------------
// The Bin, as Highland 2's: each item a card showing its text (six lines, then "…"). Click a card
// to select it (a delete button appears at its top right; Delete or Backspace works too), double-
// click to edit it in place. Drag text from the page onto the Bin to move it there (no Shift: the
// page and the Bin are one webview); drag a card into the page to put it back; drag cards to reorder
// them. The Filter at the foot narrows the cards by their words.

interface BinCard {
  text: string;
  label: string;
  detail: string;
}

export const BIN_TYPE = "application/x-highwater-bin";
/** Marks an image reference dragged from Assets (the page puts it in as a paragraph of its own). */
export const ASSET_TYPE = "application/x-highwater-asset";

class BinPanel {
  readonly #list = $("binlist");
  readonly #empty = $("binempty");
  readonly #filter = $<HTMLInputElement>("binfilter");
  #cards: BinCard[] = [];
  #selected = -1;
  /** The card being edited, and its edit not yet saved. */
  #editing: { index: number; area: HTMLTextAreaElement; timer: ReturnType<typeof setTimeout> | undefined } | null = null;
  #available = false;

  constructor(private readonly deps: SidebarDeps) {
    this.#filter.addEventListener("input", () => this.#render());
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
        if (to !== from) deps.post({ type: "binMove", from, to: Math.min(to, this.#cards.length - 1) });
        return;
      }
      const text = e.dataTransfer?.getData("text/plain");
      if (!text || !text.trim()) return;
      deps.post({ type: "binAdd", text });
      // Text dragged from the page moves into the Bin, as Cut to Bin does.
      deps.cutDragged(text);
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
    // Don't redraw under the writer's hands: an item being edited keeps its box.
    if (this.#editing && cards[this.#editing.index] !== undefined && document.activeElement === this.#editing.area) {
      this.#cards = cards;
      return;
    }
    this.#editing = null;
    this.#cards = cards;
    if (this.#selected >= cards.length) this.#selected = -1;
    this.#render();
    this.#empty.textContent = available ? "The Bin holds text you set aside. Drag text here, or use Cut to Bin (⌥⌘X) and Copy to Bin (⌥⌘C)." : "Open a document to use its Bin.";
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
    el.append(text, button("Delete", '<path d="M6 6l12 12M18 6 6 18"/>', () => this.#delete(index), "bincard-delete"));
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", this.#cards[index]?.text ?? "");
      e.dataTransfer!.setData(BIN_TYPE, String(index));
      e.dataTransfer!.effectAllowed = "copyMove";
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
    this.deps.post({ type: "binTake", index });
  }

  /** Opens a card for editing in place; what is typed is saved as you go. */
  #edit(index: number, el: HTMLElement): void {
    if (this.#editing?.index === index) return;
    this.#finish();
    const area = document.createElement("textarea");
    area.className = "bincard-edit";
    area.value = this.#cards[index]?.text ?? "";
    area.spellcheck = false;
    el.replaceChildren(area);
    el.draggable = false;
    el.classList.add("editing");
    const editing = { index, area, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.#editing = editing;
    const save = () => {
      clearTimeout(editing.timer);
      if (area.value !== this.#cards[index]?.text) {
        this.#cards[index] = { ...this.#cards[index]!, text: area.value };
        this.deps.post({ type: "binEdit", index, text: area.value });
      }
    };
    const fit = () => {
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight}px`;
    };
    area.addEventListener("input", () => {
      clearTimeout(editing.timer);
      editing.timer = setTimeout(save, 600);
      fit();
    });
    area.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[biuy/.=\-]$/i.test(e.key)) e.stopPropagation();
      if (e.key === "Escape") area.blur();
    });
    area.addEventListener("blur", () => {
      save();
      this.#finish();
      this.#render();
    });
    area.focus();
    fit();
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

// ---------------------------------------------------------------------------------------------
// Assets: the document's images. Drag one into the page to put in its reference; add images
// with the + button, or by dropping files from Finder (VS Code asks for Shift while dragging in).

interface AssetCard {
  name: string;
  label: string;
  detail: string;
  reference: string;
  thumb: string | null;
}

class AssetsPanel {
  readonly #list = $("assetlist");
  readonly #empty = $("assetempty");
  #cards: AssetCard[] = [];
  #available = false;

  constructor(private readonly deps: SidebarDeps) {
    $("assetadd").onclick = () => deps.post({ type: "assetsAdd" });
    const panel = $("assetpanel");
    panel.addEventListener("dragover", (e) => {
      if (!this.#available || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      panel.classList.add("dropping");
    });
    panel.addEventListener("dragleave", (e) => {
      if (!panel.contains(e.relatedTarget as Node | null)) panel.classList.remove("dropping");
    });
    panel.addEventListener("drop", (e) => {
      e.preventDefault();
      panel.classList.remove("dropping");
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.(png|jpe?g|gif|tiff?|heic|webp|pdf)$/i.test(f.name));
      if (!files.length) return;
      void Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))).then((list) => deps.post({ type: "assetsImport", files: list }));
    });
  }

  show(cards: AssetCard[], available: boolean): void {
    this.#available = available;
    this.#cards = cards;
    this.#list.replaceChildren(...cards.map((c) => this.#card(c)));
    this.#empty.hidden = cards.length > 0;
    this.#empty.textContent = available ? "Images for this document. Add them with +, or hold Shift and drag them in from Finder; drag one into the text to use it." : "Open a document to see its assets.";
    $("assetadd").hidden = !available;
  }

  #card(c: AssetCard): HTMLElement {
    const el = document.createElement("div");
    el.className = "assetcard";
    el.draggable = true;
    el.title = `${c.name}\nDrag into the text to use it; double-click to open it.`;
    const pic = document.createElement("div");
    pic.className = "assetcard-pic";
    if (c.thumb) {
      const img = document.createElement("img");
      img.src = c.thumb;
      img.alt = "";
      img.draggable = false;
      pic.append(img);
    }
    const text = document.createElement("div");
    text.className = "assetcard-text";
    const label = document.createElement("div");
    label.className = "bincard-label";
    label.textContent = c.label;
    const detail = document.createElement("div");
    detail.className = "bincard-detail";
    detail.textContent = c.detail;
    text.append(label, detail);
    const tools = document.createElement("div");
    tools.className = "bincard-tools";
    tools.append(button("Delete", '<path d="M6 6l12 12M18 6 6 18"/>', () => this.deps.post({ type: "assetDelete", name: c.name })));
    el.append(pic, text, tools);
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", c.reference);
      e.dataTransfer!.setData(ASSET_TYPE, c.name);
      e.dataTransfer!.effectAllowed = "copy";
    });
    el.addEventListener("dblclick", () => this.deps.post({ type: "assetOpen", name: c.name }));
    return el;
  }
}

/** A small icon button with a tooltip. */
function button(tip: string, path: string, run: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `sb-button ${cls}`.trim();
  b.title = tip;
  b.setAttribute("aria-label", tip);
  b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  b.onclick = (e) => {
    e.stopPropagation();
    run();
  };
  return b;
}
