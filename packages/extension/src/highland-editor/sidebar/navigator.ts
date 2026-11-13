import { blockAt, currentRow, moveBlock, navigatorItems, navigatorRows, parseFilters, type NavigatorFilters, type NavigatorRow } from "../../syntax/navigator.ts";
import { $, type SidebarDeps } from "./ui.ts";

// ---------------------------------------------------------------------------------------------
// The Navigator: the document's scenes, sections and the rest, worked out here from the page's
// own text. Click to go there; drag a scene or section to move it (the move is an ordinary edit,
// so ⌘Z takes it back); filter by words at the foot, or choose what it lists with the eye.

/** The eye popover's kinds, in Highland's order, with its names and marks. */
const navSvg = (path: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const NAV_KINDS: [keyof NavigatorFilters, string, string][] = [
  ["sectionHeaders", "Sections", "<b>#</b>"],
  ["synopses", "Synopses", "<b>=</b>"],
  ["sceneHeaders", "Scene Headers", "<b>I/E</b>"],
  ["notes", "Notes", "<b>[[ ]]</b>"],
  ["includedFiles", "Included files", navSvg('<path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/>')],
  ["images", "Images", navSvg('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>')],
  ["links", "Inline links", navSvg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>')],
  ["referenceLinks", "Reference links", navSvg('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3" fill="currentColor"/>')],
  ["markers", "Markers", navSvg('<path d="M7 3h10v18l-5-4-5 4z" fill="currentColor"/>')],
];
let closeNavPop: () => void = () => {};

export class NavigatorPanel {
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
    const eye = $("navtypes");
    eye.onclick = () => this.#chooseTypes(eye);
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

  /**
   * Highland's eye popover above the eye button: a checkbox for each kind of item, with Hide All
   * and Show All. Each change applies at once and is kept for the document.
   */
  #chooseTypes(eye: HTMLElement): void {
    const pop = $("navpop");
    if (!pop.hidden) return closeNavPop();
    const set = (next: NavigatorFilters) => {
      this.#filters = next;
      this.#list_();
      this.deps.post({ type: "navFiltersSet", filters: next });
      for (const box of pop.querySelectorAll<HTMLInputElement>("input[data-type]")) box.checked = next[box.dataset.type as keyof NavigatorFilters];
    };
    const rows = NAV_KINDS.map(([type, label, glyph]) => {
      const row = document.createElement("label");
      row.className = "navpop-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.type = type;
      box.checked = this.#filters[type];
      box.onchange = () => set({ ...this.#filters, [type]: box.checked });
      const icon = document.createElement("span");
      icon.className = "navpop-icon";
      icon.innerHTML = glyph;
      row.append(box, icon, label);
      return row;
    });
    const all = (on: boolean) => set(Object.fromEntries(NAV_KINDS.map(([t]) => [t, on])) as NavigatorFilters);
    const buttons = document.createElement("div");
    buttons.className = "navpop-buttons";
    const hide = document.createElement("button");
    hide.textContent = "Hide All";
    hide.onclick = () => all(false);
    const show = document.createElement("button");
    show.textContent = "Show All";
    show.onclick = () => all(true);
    buttons.append(hide, show);
    pop.replaceChildren(...rows, buttons);
    pop.hidden = false;
    // Above the eye, its arrow pointing down at it, inside the window.
    const r = eye.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(6, r.top - pop.offsetHeight - 12))}px`;
    pop.style.setProperty("--arrow", `${Math.round(r.left + r.width / 2 - left)}px`);
    pop.querySelector<HTMLElement>("input")?.focus();
    const away = (e: MouseEvent) => {
      if (!pop.contains(e.target as Node) && !eye.contains(e.target as Node)) closeNavPop();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeNavPop();
        eye.focus();
      }
    };
    document.addEventListener("mousedown", away, true);
    pop.addEventListener("keydown", keys);
    window.addEventListener("blur", closeNavPop);
    closeNavPop = () => {
      pop.hidden = true;
      document.removeEventListener("mousedown", away, true);
      pop.removeEventListener("keydown", keys);
      window.removeEventListener("blur", closeNavPop);
      closeNavPop = () => {};
    };
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
