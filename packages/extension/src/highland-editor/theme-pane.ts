import { customId, HIGHLAND_THEMES, swatches, type CustomTheme } from "./themes.ts";
import type { FromPage } from "./messages.ts";

/**
 * The theme menu, as Highland 2's: dropped from the theme button, Light, Dark and Custom themes
 * each with its five swatches (background, primary, secondary, scene heading, cursor), and VS
 * Code's own colours at the top. ↑ ↓ try each theme on the page (and the window) as you go;
 * Enter or a click keeps it, Escape puts back the one you had. Manage Themes… opens the theme window.
 */
interface Row {
  id: string;
  name: string;
  swatches: string[];
}

export class ThemePane {
  readonly #root: HTMLElement;
  readonly #list: HTMLElement;
  #rows: Row[] = [];
  #current = "vscode";
  #customs: CustomTheme[] = [];
  #at = -1;
  #closing = false;

  constructor(
    private readonly post: (msg: FromPage) => void,
    private readonly anchor: HTMLElement,
    private readonly manage: () => void,
  ) {
    this.#root = document.createElement("div");
    this.#root.id = "thpane";
    this.#root.hidden = true;
    this.#root.setAttribute("role", "dialog");
    this.#root.setAttribute("aria-label", "Theme");
    this.#root.innerHTML = `<div class="th-title">Theme</div><div class="th-list" role="listbox" tabindex="0" aria-label="Themes"></div><button class="th-manage">Manage Themes…</button>`;
    document.body.append(this.#root);
    this.#list = this.#root.querySelector(".th-list")!;
    this.#root.querySelector<HTMLButtonElement>(".th-manage")!.onclick = () => {
      this.close(true);
      this.manage();
    };
    this.#list.addEventListener("keydown", (e) => this.#key(e));
    // A click anywhere else keeps the theme on show and closes the menu.
    document.addEventListener(
      "mousedown",
      (e) => {
        if (!this.#root.hidden && !this.#root.contains(e.target as Node) && !this.anchor.contains(e.target as Node)) this.close(true);
      },
      true,
    );
  }

  get shown(): boolean {
    return !this.#root.hidden;
  }

  /** The themes there are and the one in use (from the extension). */
  update(current: string, customs: CustomTheme[]): void {
    this.#current = current;
    this.#customs = customs;
    if (this.shown) this.#render();
  }

  toggle(): void {
    if (this.shown) this.close(true);
    else this.open();
  }

  open(): void {
    this.post({ type: "themePaneOpen" });
    this.#root.hidden = false;
    const r = this.anchor.getBoundingClientRect();
    this.#root.style.top = `${r.bottom + 8}px`;
    this.#root.style.right = `${Math.max(8, window.innerWidth - r.right - 24)}px`;
    this.#render();
    this.#list.focus();
    this.#list.querySelector(".th-on")?.scrollIntoView({ block: "nearest" });
  }

  /** Closes the menu: `keep` keeps the theme on show, otherwise the one there was before comes back. */
  close(keep: boolean): void {
    if (this.#root.hidden || this.#closing) return;
    this.#closing = true;
    this.#root.hidden = true;
    this.post({ type: "themePaneClose", keep });
    this.#closing = false;
  }

  #render(): void {
    const themes = Object.entries(HIGHLAND_THEMES).map(([id, t]) => ({ id, name: t.name, mode: t.mode, swatches: swatches(t) }));
    const custom = this.#customs.map((t) => ({ id: customId(t), name: t.name || "Custom Theme", mode: t.mode, swatches: swatches(t) }));
    const groups: [string, Row[]][] = [
      ["", [{ id: "vscode", name: "Match VS Code", swatches: [] }]],
      ["LIGHT", themes.filter((t) => t.mode === "light")],
      ["DARK", themes.filter((t) => t.mode === "dark")],
      ["CUSTOM", custom],
    ];
    this.#rows = groups.flatMap(([, rows]) => rows);
    this.#at = this.#rows.findIndex((r) => r.id === this.#current);
    this.#list.replaceChildren();
    for (const [title, rows] of groups) {
      if (title) {
        const head = document.createElement("div");
        head.className = "th-group";
        head.textContent = title;
        this.#list.append(head);
      }
      for (const row of rows) {
        const el = document.createElement("div");
        el.className = `th-row${row.id === this.#current ? " th-on" : ""}`;
        el.setAttribute("role", "option");
        el.setAttribute("aria-selected", String(row.id === this.#current));
        el.dataset.id = row.id;
        const name = document.createElement("span");
        name.className = "th-name";
        name.textContent = row.name;
        const chips = document.createElement("span");
        chips.className = "th-swatches";
        for (const c of row.swatches) {
          const chip = document.createElement("span");
          chip.style.background = c;
          chips.append(chip);
        }
        el.append(name, chips);
        el.onclick = () => {
          this.#show(this.#rows.indexOf(row));
          this.close(true);
        };
        this.#list.append(el);
      }
    }
    if (!this.#customs.length) {
      const none = document.createElement("div");
      none.className = "th-none";
      none.textContent = "None yet";
      this.#list.append(none);
    }
  }

  /** Puts a theme on show: on the page, and in the window when that follows. */
  #show(i: number): void {
    const row = this.#rows[i];
    if (!row) return;
    this.#at = i;
    this.#current = row.id;
    for (const el of this.#list.querySelectorAll<HTMLElement>(".th-row")) {
      const on = el.dataset.id === row.id;
      el.classList.toggle("th-on", on);
      el.setAttribute("aria-selected", String(on));
      if (on) el.scrollIntoView({ block: "nearest" });
    }
    this.post({ type: "themePreview", id: row.id });
  }

  #key(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, Math.min(this.#rows.length - 1, this.#at + (e.key === "ArrowDown" ? 1 : -1)));
      if (next !== this.#at) this.#show(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.close(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close(false);
    }
  }
}
