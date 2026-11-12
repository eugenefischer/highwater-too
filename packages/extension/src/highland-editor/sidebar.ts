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
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MIN_WIDTH = 240;
const MAX_WIDTH = 520;

export class Sidebar {
  #state: SidebarState = { open: true, panel: "navigator", width: 264 };
  readonly #nav: NavigatorPanel;
  readonly #scratch: ScratchpadPanel;

  constructor(private readonly deps: SidebarDeps) {
    this.#nav = new NavigatorPanel(deps);
    this.#scratch = new ScratchpadPanel(deps);
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
