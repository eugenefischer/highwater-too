/**
 * Highland 2's sidebar, inside the Highwater Editor: a row of icons at its top
 * (Navigator, Bin, Statistics, Assets, Scratchpad, then Highwater's Writing History and Works),
 * one panel below. Its width, whether it shows, and the panel shown are kept for every document.
 * This file is the page's side, with each panel in sidebar/; the extension's is sidebar-host.ts.
 */
import { PANELS, type PanelName, type SidebarState, type ToPage } from "./messages.ts";
import { $, localizeKeys, type SidebarDeps } from "./sidebar/ui.ts";
import { NavigatorPanel } from "./sidebar/navigator.ts";
import { ScratchpadPanel } from "./sidebar/scratchpad.ts";
import { BinPanel } from "./sidebar/bin.ts";
import { AssetsPanel } from "./sidebar/assets.ts";
import { HistoryPanel } from "./sidebar/history.ts";
import { WorksPanel } from "./sidebar/works.ts";

export { ASSET_TYPE, BIN_TYPE } from "./sidebar/bin.ts";

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
    localizeKeys(document);
    for (const b of document.querySelectorAll<HTMLButtonElement>("#sbicons [data-panel]")) b.onclick = () => this.show(b.dataset.panel as PanelName);
    $("tbsidebar").onclick = () => this.toggle();
    this.#resizer();
    this.#apply();
  }

  /** The General settings' "Show markup (#, =, [[ ]]) in Navigator". */
  navigatorMarkup(on: boolean): void {
    this.#nav.markup(on);
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
    // Leaving the Writing History or Works lets go of its selection.
    if (panel !== this.#state.panel) {
      this.#history.deselect();
      this.#works.deselect();
    }
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
  /** The save the page is comparing with, or null: outlined in the Writing History. */
  compared(hash: string | null): void {
    this.#history.compared(hash);
  }

  cursorMoved(): void {
    this.#nav.cursorMoved();
  }

  receive(msg: ToPage): boolean {
    if (msg.type === "sidebar") this.restore(msg.state);
    else if (msg.type === "navFilters") this.#nav.filters(msg.json, msg.filters);
    else if (msg.type === "scratchpad") this.#scratch.load(String(msg.text ?? ""), !!msg.force);
    else if (msg.type === "scratchpadSaved") this.#scratch.saved(String(msg.text ?? ""));
    else if (msg.type === "bin") this.#bin.show(msg.items, !!msg.available);
    else if (msg.type === "assets") this.#assets.show(msg.items, !!msg.available);
    else if (msg.type === "history") this.#history.show(msg);
    else if (msg.type === "works") this.#works.show(msg.items, msg.mirror ?? null, typeof msg.computer === "string" ? msg.computer : "");
    else if (msg.type === "workSaves") this.#works.saves(msg.i, msg.saves);
    else if (msg.type === "showPanel" && PANELS.includes(msg.panel)) this.show(msg.panel);
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
