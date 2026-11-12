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
  /**
   * Changes the Bin as a step of the page's undo history (Highland's: ⌘Z puts back a drag in or
   * out, or a deleted item). With `cut`, also takes that text out of the page if it is what is being
   * dragged from it (dragging to the Bin moves the text).
   */
  bin(op: BinOp, cut?: string): void;
}

/** A change to the Bin that undo can reverse: an item added or removed at an index, or moved. */
export type BinOp = { kind: "add" | "remove"; index: number; text: string } | { kind: "move"; from: number; to: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MIN_WIDTH = 240;
const MAX_WIDTH = 520;

export class Sidebar {
  #state: SidebarState = { open: true, panel: "navigator", width: 264 };
  readonly #nav: NavigatorPanel;
  readonly #scratch: ScratchpadPanel;
  readonly #bin: BinPanel;
  readonly #assets: AssetsPanel;
  readonly #history: HistoryPanel;
  readonly #works: WorksPanel;

  constructor(private readonly deps: SidebarDeps) {
    this.#nav = new NavigatorPanel(deps);
    this.#scratch = new ScratchpadPanel(deps);
    this.#bin = new BinPanel(deps);
    this.#assets = new AssetsPanel(deps);
    this.#history = new HistoryPanel(deps);
    this.#works = new WorksPanel(deps);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#sbicons [data-panel]")) b.onclick = () => this.show(b.dataset.panel as PanelName);
    $("tbsidebar").onclick = () => this.toggle();
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
    // Leaving the Writing History lets go of its selected save.
    if (panel !== this.#state.panel) this.#history.deselect();
    this.#state = { ...this.#state, panel, open: true };
    this.#apply();
    this.#save();
    if (panel === "scratchpad") this.#scratch.focus();
  }

  /** How many items the Bin holds (a new one goes at the end). */
  binCount(): number {
    return this.#bin.count;
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
    else if (msg.type === "history") this.#history.show(msg as unknown as HistoryMessage);
    else if (msg.type === "works") this.#works.show(msg.items as WorkRow[]);
    else if (msg.type === "workSaves") this.#works.saves(msg.i as number, msg.saves as WorkSaveRow[]);
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
    el.dataset.tip = `${c.name}\nDrag into the text to use it; double-click to open it.`;
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
      faintDragImage(e, c.label);
    });
    el.addEventListener("dblclick", () => this.deps.post({ type: "assetOpen", name: c.name }));
    return el;
  }
}

/** A small icon button with a tooltip. */
function button(tip: string, path: string, run: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `sb-button ${cls}`.trim();
  b.dataset.tip = tip;
  b.setAttribute("aria-label", tip);
  b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  b.onclick = (e) => {
    e.stopPropagation();
    run();
  };
  return b;
}

// ---------------------------------------------------------------------------------------------
// Writing History (Highwater's, not Highland's): this document's saves, newest first, under a
// heading for each day. A click selects a save, which shows Compare and Revert where its word change
// was; Escape, a click beside the saves or leaving the panel lets go of it. The foot shows whether the history is recording and how the
// mirror is doing, with the record (off or on for this document), export and gear (the rest) buttons.

interface HistorySave {
  hash: string;
  /** Milliseconds since 1970. */
  at: number;
  kind: string;
  note: string;
  delta: string;
  words: string;
}

interface MenuItem {
  label: string;
  command: string;
  sep?: boolean;
}

interface HistoryMessage {
  title: string;
  note: string;
  saves: HistorySave[];
  state: "on" | "paused" | "off" | "none";
  document: boolean;
  mirror: { at: number | null; error: string | null; signIn: boolean } | null;
  menu: MenuItem[];
}

const COMPARE_ICON = '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/><path d="M6 9h2M6 12h2M16 9h2M16 12h2M16 15h2"/>';
const REVERT_ICON = '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>';

class HistoryPanel {
  readonly #list = $("histlist");
  readonly #note = $("histnote");
  readonly #record = $<HTMLButtonElement>("histrecord");
  #saves: HistorySave[] = [];
  #selected: string | null = null;
  #menu: MenuItem[] = [];

  constructor(private readonly deps: SidebarDeps) {
    const run = (command: string) => deps.post({ type: "historyCommand", command });
    this.#record.onclick = () => run("highwater.toggleDocumentHistory");
    $("histexport").onclick = () => run("highwater.exportHistory");
    const help = $("histhelp");
    help.onclick = () => openHelp(help, HISTORY_HELP);
    const gear = $("histgear");
    gear.onclick = () => openMenu(gear, this.#menu, run);
    $("histmirror").onclick = () => {
      if ($("histmirror").classList.contains("attention")) run("highwater.signInHistoryMirror");
    };
    this.#list.addEventListener("keydown", (e) => {
      const i = this.#saves.findIndex((x) => x.hash === this.#selected);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = this.#saves[Math.max(0, Math.min(this.#saves.length - 1, i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) this.#select(next.hash, true);
      } else if (e.key === "Escape" && this.#selected) {
        e.preventDefault();
        this.deselect();
      }
    });
    // A click in the list but not on a save lets go of the selection.
    this.#list.addEventListener("mousedown", (e) => {
      if (!(e.target as HTMLElement).closest(".hist-row")) this.deselect();
    });
  }

  show(msg: HistoryMessage): void {
    $("histtitle").textContent = msg.title;
    this.#note.textContent = msg.note;
    this.#note.hidden = !msg.note;
    this.#saves = msg.saves;
    this.#menu = msg.menu;
    if (!this.#saves.some((x) => x.hash === this.#selected)) this.#selected = null;
    this.#foot(msg);
    const rows: HTMLElement[] = [];
    let day = "";
    for (const save of msg.saves) {
      const date = new Date(save.at);
      const heading = dayHeading(date);
      if (heading !== day) {
        day = heading;
        const h = document.createElement("div");
        h.className = "sb-day";
        h.textContent = heading;
        rows.push(h);
      }
      const row = document.createElement("div");
      row.className = "sb-row hist-row";
      row.dataset.hash = save.hash;
      row.setAttribute("role", "option");
      row.dataset.tip = `${save.kind}, ${date.toLocaleString([], { dateStyle: "full", timeStyle: "short" })}${save.words ? `\n${save.words} words` : ""}`;
      const main = document.createElement("div");
      main.className = "sb-row-main";
      const time = document.createElement("span");
      time.className = "sb-row-when";
      time.textContent = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const kind = document.createElement("span");
      kind.className = "sb-row-kind";
      kind.textContent = save.kind;
      const delta = document.createElement("span");
      delta.className = "hist-delta";
      delta.textContent = save.delta;
      main.append(time, kind, delta);
      row.append(main);
      if (save.note) {
        const note = document.createElement("div");
        note.className = "sb-row-detail";
        note.textContent = save.note;
        row.append(note);
      }
      const tools = document.createElement("div");
      tools.className = "sb-row-tools";
      tools.append(
        button("Compare with Now", COMPARE_ICON, () => this.#compare(save.hash)),
        button("Revert to This Save…", REVERT_ICON, () => this.deps.post({ type: "historyRevert", hash: save.hash })),
      );
      row.append(tools);
      row.addEventListener("mousedown", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        this.#select(save.hash, false);
      });
      rows.push(row);
    }
    this.#list.replaceChildren(...rows);
    this.#mark();
  }

  /** No save selected (on leaving the panel, Escape, or a click beside the saves). */
  deselect(): void {
    if (this.#selected === null) return;
    this.#selected = null;
    this.#mark();
  }

  #select(hash: string, scroll: boolean): void {
    this.#selected = hash;
    this.#mark();
    if (scroll) this.#list.querySelector<HTMLElement>(".hist-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  #mark(): void {
    for (const r of this.#list.querySelectorAll<HTMLElement>(".hist-row")) {
      const on = r.dataset.hash === this.#selected;
      r.classList.toggle("selected", on);
      r.setAttribute("aria-selected", String(on));
    }
  }

  #compare(hash: string): void {
    this.deps.post({ type: "historyCompare", hash });
  }

  /** The foot: whether this document's saves are being recorded, and the mirror's last outcome. */
  #foot(msg: HistoryMessage): void {
    const last = msg.saves[0] ? new Date(msg.saves[0].at) : null;
    $("histstate").textContent = !msg.document
      ? "Not saved yet"
      : msg.state === "off"
        ? "Writing history is off"
        : msg.state === "paused"
          ? "Paused for this document"
          : last
            ? `Recording · last save ${shortWhen(last)}`
            : "Starts with the next save";
    const rec = this.#record;
    rec.hidden = !msg.document || msg.state === "off";
    const paused = msg.state === "paused";
    rec.classList.toggle("paused", paused);
    const tip = paused ? "Turn Writing History On for This Document" : "Turn Writing History Off for This Document";
    rec.dataset.tip = tip;
    rec.setAttribute("aria-label", tip);
    const mirror = $("histmirror");
    mirror.hidden = !msg.mirror || msg.state === "off";
    mirror.classList.toggle("attention", !!msg.mirror?.signIn);
    if (msg.mirror?.error) mirror.dataset.tip = msg.mirror.error;
    else delete mirror.dataset.tip;
    mirror.textContent = !msg.mirror
      ? ""
      : msg.mirror.signIn
        ? "Mirror needs you to sign in"
        : msg.mirror.error
          ? "Not mirrored yet"
          : msg.mirror.at
            ? `Mirrored ${shortWhen(new Date(msg.mirror.at))}`
            : "Mirror set up";
  }
}

const icon = (path: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

/** The Writing History's ? button: what it is and what each control does (it is not Highland's). */
const HISTORY_HELP = `
<h2>Writing History</h2>
<p>Each time you save, Highwater Too keeps a copy of the document. You can look back at any earlier version, see what changed, and go back to it.</p>
<p>The copies are kept on this computer. A save is kept only when something changed: the text, or what’s kept with it, such as the Bin, the Scratchpad, images or the template.</p>

<h3>The list</h3>
<p>Saves are listed newest first, by day. Each shows its time, its type, and how many words it added or removed. <b>+0</b> means the word count didn’t change, though something else did: a word replaced by another, punctuation, the Bin, the Scratchpad, an image or the template.</p>
<ul>
<li><b>Save</b>: you saved.</li>
<li><b>Autosave</b>: VS Code saved for you.</li>
<li><b>Close</b>: saved as the document closed.</li>
<li><b>Revert</b>: you went back to an earlier save (its note says which).</li>
<li><b>Restore</b>, <b>Convert</b>, <b>Connect</b>: the document was brought back from its history, changed to another file type, or joined to another document’s history.</li>
</ul>

<h3>Compare or go back</h3>
<p>Click a save, then:</p>
<ul>
<li>${icon(COMPARE_ICON)} <b>Compare</b> shows that save beside your current text, with the changes marked.</li>
<li>${icon(REVERT_ICON)} <b>Revert</b> puts that save’s text, Bin and Scratchpad back and saves the document. The revert is added to the list straight away, and later saves stay there, so you can always go back again. If you have unsaved changes, you can save them first or leave them out.</li>
</ul>

<h3>The bottom of the panel</h3>
<p>The status line says whether this document’s saves are being kept, and when the last one was. If you use a mirror, a second line says when it was last updated.</p>
<ul>
<li>${icon('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>')} <b>Record</b> pauses or resumes the history for this document. Earlier saves are kept.</li>
<li>${icon('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>')} <b>Export</b> saves this document’s whole history as one file you can share or archive.</li>
<li>${icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>')} <b>More</b> holds the less common actions, described below.</li>
</ul>

<h3>More actions</h3>
<ul>
<li><b>Connect to a Work’s History</b>: if a copied or renamed file lost its history, joins it back up. You’ll be asked to confirm.</li>
<li><b>Link Writing History to This File</b> (.fountain and .md files): adds a short line at the end of the file so its history, Bin and Scratchpad follow it if you move or rename it. .highland files don’t need this.</li>
<li><b>Set Up History Mirror</b>: keeps a backup of all your history on a server you choose, such as a private GitHub repository. Your other computers can then see and restore your work. The other mirror items sync now, sign in, or forget the saved sign-in.</li>
<li><b>Reveal Writing History Folder</b> and <b>Change Writing History Location</b>: where the copies are kept on this computer.</li>
</ul>
`;

/** TODAY, YESTERDAY, then NOV 10, 2026. */
function dayHeading(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "TODAY";
  if (d.toDateString() === yesterday.toDateString()) return "YESTERDAY";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

/** "3:42 PM" today, else "Nov 10, 3:42 PM". */
function shortWhen(d: Date): string {
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * Help for one of Highwater's own panels: a popover beside the sidebar, its arrow at the ? button.
 * Escape, a click elsewhere or the ? again closes it.
 */
function openHelp(anchor: HTMLElement, html: string): void {
  const pop = $("sbhelp");
  if (!pop.hidden) return closeHelp();
  $("sbhelptext").innerHTML = html;
  pop.hidden = false;
  const a = anchor.getBoundingClientRect();
  const side = $("sidebar").getBoundingClientRect();
  const height = Math.min(560, window.innerHeight - 24);
  const middle = a.top + a.height / 2;
  const top = Math.max(12, Math.min(window.innerHeight - height - 12, middle - 24));
  pop.style.left = `${Math.round(side.right + 10)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.height = `${height}px`;
  pop.style.setProperty("--arrow", `${Math.round(Math.max(16, Math.min(height - 16, middle - top)))}px`);
  $("sbhelptext").scrollTop = 0;
  pop.focus();
  const away = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeHelp();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeHelp();
      anchor.focus();
    }
  };
  document.addEventListener("mousedown", away, true);
  pop.addEventListener("keydown", keys);
  closeHelp = () => {
    pop.hidden = true;
    document.removeEventListener("mousedown", away, true);
    pop.removeEventListener("keydown", keys);
    closeHelp = () => {};
  };
}
let closeHelp: () => void = () => {};

/**
 * The sidebar's popup menu, above (or below) the button that opened it, like Highland's own
 * pop-up menus. Escape, a click elsewhere or a choice closes it; the arrow keys move through it.
 */
function openMenu(anchor: HTMLElement, items: MenuItem[], pick: (command: string) => void): void {
  const menu = $("sbmenu");
  if (!menu.hidden) return closeMenu();
  menu.replaceChildren(
    ...items.flatMap((item) => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitem");
      b.textContent = item.label;
      b.onclick = () => {
        closeMenu();
        pick(item.command);
      };
      return item.sep ? [document.createElement("hr"), b] : [b];
    }),
  );
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, r.right - w)))}px`;
  menu.style.top = `${Math.round(r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6)}px`;
  menu.querySelector<HTMLElement>("button")?.focus();
  const away = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) closeMenu();
  };
  const keys = (e: KeyboardEvent) => {
    const buttons = [...menu.querySelectorAll<HTMLElement>("button")];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      anchor.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  };
  document.addEventListener("mousedown", away, true);
  menu.addEventListener("keydown", keys);
  window.addEventListener("blur", closeMenu);
  closeMenu = () => {
    menu.hidden = true;
    document.removeEventListener("mousedown", away, true);
    menu.removeEventListener("keydown", keys);
    window.removeEventListener("blur", closeMenu);
    closeMenu = () => {};
  };
}
let closeMenu: () => void = () => {};

// ---------------------------------------------------------------------------------------------
// Works: every work in the writing history. A work here opens with a click; the arrow beside a
// work with its history on this computer lists its saves (click one to read it); ⋯ on a work offers
// restoring, removing from this computer and deleting. The Filter narrows the list; ↻ syncs.

interface WorkRow {
  i: number;
  title: string;
  detail: string;
  tip: string;
  kind: "here" | "local" | "remote";
}

interface WorkSaveRow {
  j: number;
  when: string;
  detail: string;
  tip: string;
}

class WorksPanel {
  readonly #list = $("worklist");
  readonly #filter = $<HTMLInputElement>("workfilter");
  #rows: WorkRow[] = [];
  readonly #open = new Set<number>();
  readonly #saves = new Map<number, WorkSaveRow[]>();

  constructor(private readonly deps: SidebarDeps) {
    this.#filter.addEventListener("input", () => this.#render());
    $("workrefresh").onclick = () => deps.post({ type: "worksRefresh" });
  }

  show(rows: WorkRow[]): void {
    this.#rows = rows;
    this.#saves.clear();
    // Works open before stay open (their saves are asked for again).
    for (const i of this.#open) {
      if (rows[i]?.kind === "remote" || !rows[i]) this.#open.delete(i);
      else this.deps.post({ type: "workSaves", i });
    }
    this.#render();
    $("worknote").hidden = rows.length > 0;
  }

  saves(i: number, saves: WorkSaveRow[]): void {
    this.#saves.set(i, saves);
    this.#render();
  }

  #render(): void {
    const words = this.#filter.value.trim().toLowerCase();
    const out: HTMLElement[] = [];
    for (const w of this.#rows) {
      if (words && !`${w.title} ${w.detail}`.toLowerCase().includes(words)) continue;
      const row = document.createElement("div");
      row.className = `sb-row work work-${w.kind}`;
      row.title = w.tip;
      const main = document.createElement("div");
      main.className = "sb-row-main";
      const twist = document.createElement("span");
      twist.className = "sb-twist";
      twist.textContent = w.kind === "remote" ? "" : this.#open.has(w.i) ? "▾" : "▸";
      twist.onclick = (e) => {
        e.stopPropagation();
        if (w.kind === "remote") return;
        if (this.#open.has(w.i)) this.#open.delete(w.i);
        else {
          this.#open.add(w.i);
          this.deps.post({ type: "workSaves", i: w.i });
        }
        this.#render();
      };
      const title = document.createElement("span");
      title.className = "sb-row-title";
      title.textContent = w.title;
      main.append(twist, title);
      const detail = document.createElement("div");
      detail.className = "sb-row-detail";
      detail.textContent = w.detail;
      row.append(main, detail, button("More…", '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', () => this.deps.post({ type: "workMenu", i: w.i }), "sb-row-tool"));
      row.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        if (w.kind === "here") this.deps.post({ type: "workOpen", i: w.i });
        else this.deps.post({ type: "workMenu", i: w.i });
      });
      out.push(row);
      if (this.#open.has(w.i)) {
        for (const save of this.#saves.get(w.i) ?? []) {
          const r = document.createElement("div");
          r.className = "sb-row save";
          r.title = save.tip;
          const m = document.createElement("div");
          m.className = "sb-row-main";
          m.textContent = save.when;
          const d = document.createElement("div");
          d.className = "sb-row-detail";
          d.textContent = save.detail;
          r.append(m, d);
          r.addEventListener("click", () => this.deps.post({ type: "workSave", i: w.i, j: save.j }));
          out.push(r);
        }
      }
    }
    this.#list.replaceChildren(...out);
  }
}

/**
 * What follows the pointer while a card is dragged: as in Highland, a small, nearly invisible
 * outline of it, so the drop caret in the text shows through (the browser's own picture is the
 * whole card).
 */
function faintDragImage(e: DragEvent, text: string): void {
  const ghost = document.createElement("div");
  ghost.className = "sb-dragghost";
  ghost.textContent = text.split("\n").find((l) => l.trim())?.trim().slice(0, 60) ?? "";
  document.body.append(ghost);
  e.dataTransfer?.setDragImage(ghost, 40, 12);
  // The picture is taken now; the element itself can go.
  requestAnimationFrame(() => ghost.remove());
}
