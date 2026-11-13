import { HIGHLAND_THEMES, navigatorColors, pageColors, fromCustom, parseThemeLink, themeFor, themeLink, THEME_COLORS, type CustomTheme } from "./themes.ts";
import type { FromPage } from "./messages.ts";

/**
 * The theme window (Manage Themes… in the theme menu): your own themes, made, imported from a
 * theme link, edited and deleted, as Highland 2's Themes settings and its theme builder together.
 * A theme is Highland's ten colours, a name and light or dark; its link is the one Highland's
 * theme builder writes, so themes travel both ways. Changes are saved as you make them, and a
 * theme in use changes on the page as you edit it.
 */
export class ThemeWindow {
  readonly #root: HTMLElement;
  readonly #list: HTMLElement;
  readonly #editor: HTMLElement;
  readonly #empty: HTMLElement;
  readonly #sample: HTMLElement;
  readonly #name: HTMLInputElement;
  readonly #import: HTMLElement;
  readonly #importText: HTMLInputElement;
  readonly #importNote: HTMLElement;
  #customs: CustomTheme[] = [];
  #current = "vscode";
  #selected: string | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly post: (msg: FromPage) => void) {
    this.#root = document.createElement("div");
    this.#root.id = "thwin";
    this.#root.hidden = true;
    const rows = THEME_COLORS.map(
      (c) => `<label class="tm-color"><span>${c.label}</span><input type="color" data-key="${c.key}" aria-label="${c.label}"><input type="text" class="tm-hex" data-key="${c.key}" spellcheck="false" maxlength="7" aria-label="${c.label} (hex)"></label>`,
    ).join("");
    this.#root.innerHTML = `<div class="tw-sheet tm-sheet" role="dialog" aria-modal="true" aria-labelledby="tm-title">
  <div class="tw-head"><h1 id="tm-title">Themes</h1><button class="tw-done">Done</button></div>
  <div class="tw-body">
    <div class="tm-side">
      <div class="tw-group">CUSTOM THEMES</div>
      <div class="tm-list" role="listbox" aria-label="Custom themes"></div>
      <div class="tm-buttons"><button class="tm-new">New Theme</button><button class="tm-import-show">Import Theme…</button></div>
      <div class="tm-import" hidden><input type="text" class="tm-import-text" placeholder="Paste a theme link" spellcheck="false"><button class="tm-import-go">Import</button><div class="tm-import-note"></div></div>
    </div>
    <div class="tm-detail">
      <div class="tm-empty">Make a theme with New Theme (it starts as a copy of the theme in use), or import one from a theme link.</div>
      <div class="tm-editor" hidden>
        <div class="tm-row"><input type="text" class="tm-name" aria-label="Theme name" spellcheck="false"><span class="tm-mode" role="radiogroup" aria-label="Light or dark"><button data-mode="light">Light</button><button data-mode="dark">Dark</button></span></div>
        <div class="tm-colors">${rows}</div>
        <div class="tm-sample" aria-hidden="true">
          <div class="tm-s-side"><div class="tm-s-icons"><span class="tm-s-icon tm-s-on"></span><span class="tm-s-icon"></span><span class="tm-s-icon"></span></div><div class="tm-s-item tm-s-current">Act One</div><div class="tm-s-item">INT. COFFEE SHOP - DAY</div><div class="tm-s-item tm-s-note">fair-trade?</div></div>
          <div class="tm-s-page"><div class="tm-s-top"><span class="tm-s-text"></span></div><div class="tm-s-section"># Act One</div><div class="tm-s-synopsis">= Mary and Tom meet</div><div class="tm-s-scene">INT. COFFEE SHOP - DAY<span class="tm-s-ws">¶</span></div><div class="tm-s-action">TOM carries two cups of <span class="tm-s-note">[[fair-trade?]]</span> coffee<span class="tm-s-ws">·</span>past the <span class="tm-s-sel">power cords</span>.<span class="tm-s-caret"></span></div></div>
        </div>
        <div class="tm-actions"><button class="tm-copy">Copy Theme Link</button><button class="tm-delete">Delete Theme…</button></div>
      </div>
    </div>
  </div>
</div>`;
    document.body.append(this.#root);
    const q = <T extends HTMLElement>(sel: string) => this.#root.querySelector(sel) as T;
    this.#list = q(".tm-list");
    this.#editor = q(".tm-editor");
    this.#empty = q(".tm-empty");
    this.#sample = q(".tm-sample");
    this.#name = q(".tm-name");
    this.#import = q(".tm-import");
    this.#importText = q(".tm-import-text");
    this.#importNote = q(".tm-import-note");
    q<HTMLButtonElement>(".tw-done").onclick = () => this.close();
    this.#root.addEventListener("mousedown", (e) => e.target === this.#root && this.close());
    this.#root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    q<HTMLButtonElement>(".tm-new").onclick = () => this.#new();
    q<HTMLButtonElement>(".tm-import-show").onclick = () => {
      this.#import.hidden = !this.#import.hidden;
      this.#importNote.textContent = "";
      if (!this.#import.hidden) this.#importText.focus();
    };
    const doImport = () => this.#importLink(this.#importText.value);
    q<HTMLButtonElement>(".tm-import-go").onclick = doImport;
    this.#importText.addEventListener("keydown", (e) => e.key === "Enter" && doImport());
    q<HTMLButtonElement>(".tm-copy").onclick = () => {
      const t = this.#theme();
      if (t) this.post({ type: "copyText", text: themeLink(t), note: `Copied the link for ${t.name || "Custom Theme"}.` });
    };
    q<HTMLButtonElement>(".tm-delete").onclick = () => this.#selected && this.post({ type: "customThemeDelete", id: this.#selected });
    this.#name.addEventListener("input", () => this.#change({ name: this.#name.value }));
    for (const b of this.#root.querySelectorAll<HTMLButtonElement>(".tm-mode button")) b.onclick = () => this.#change({ mode: b.dataset.mode as CustomTheme["mode"] });
    for (const input of this.#root.querySelectorAll<HTMLInputElement>(".tm-colors input")) {
      const key = input.dataset.key as (typeof THEME_COLORS)[number]["key"];
      if (input.type === "color") input.addEventListener("input", () => this.#change({ [key]: input.value }));
      else
        input.addEventListener("change", () => {
          const hex = /^#?([0-9a-f]{6})$/i.exec(input.value.trim())?.[1];
          if (hex) this.#change({ [key]: `#${hex.toLowerCase()}` });
          else this.#fill();
        });
    }
  }

  get shown(): boolean {
    return !this.#root.hidden;
  }

  update(current: string, customs: CustomTheme[]): void {
    this.#current = current;
    // While editing, this window's own copy is newer than what comes back from the settings.
    if (this.#saveTimer === undefined) this.#customs = customs.map((t) => ({ ...t }));
    if (this.#selected && !this.#customs.some((t) => t.id === this.#selected)) this.#selected = null;
    if (this.shown) this.#render();
  }

  open(): void {
    this.#root.hidden = false;
    this.#selected ??= this.#current.startsWith("custom:") ? this.#current.slice(7) : (this.#customs[0]?.id ?? null);
    this.#import.hidden = true;
    this.#render();
    this.#root.querySelector<HTMLButtonElement>(".tw-done")!.focus();
  }

  close(): void {
    this.#flush();
    this.#root.hidden = true;
  }

  #theme(): CustomTheme | undefined {
    return this.#customs.find((t) => t.id === this.#selected);
  }

  #render(): void {
    this.#list.replaceChildren(
      ...this.#customs.map((t) => {
        const b = document.createElement("button");
        b.className = `tw-item${t.id === this.#selected ? " tw-selected" : ""}`;
        b.setAttribute("role", "option");
        b.textContent = t.name || "Custom Theme";
        b.onclick = () => {
          this.#selected = t.id;
          this.#render();
        };
        return b;
      }),
    );
    const t = this.#theme();
    this.#editor.hidden = !t;
    this.#empty.hidden = !!t;
    if (t) this.#fill();
  }

  /** The editor's fields and sample, from the selected theme. */
  #fill(): void {
    const t = this.#theme();
    if (!t) return;
    if (document.activeElement !== this.#name) this.#name.value = t.name;
    for (const b of this.#root.querySelectorAll<HTMLButtonElement>(".tm-mode button")) b.classList.toggle("tm-on", b.dataset.mode === t.mode);
    for (const input of this.#root.querySelectorAll<HTMLInputElement>(".tm-colors input")) {
      const v = t[input.dataset.key as (typeof THEME_COLORS)[number]["key"]];
      if (document.activeElement !== input) input.value = v;
    }
    const full = fromCustom(t);
    for (const [k, v] of Object.entries({ ...pageColors(full), ...navigatorColors(full) })) this.#sample.style.setProperty(k, v);
  }

  #change(patch: Partial<CustomTheme>): void {
    const t = this.#theme();
    if (!t) return;
    Object.assign(t, patch);
    if (patch.name !== undefined) this.#list.querySelector(".tw-selected")!.textContent = t.name || "Custom Theme";
    this.#fill();
    this.#save();
  }

  /** Saved a moment after the last change (dragging a colour sends many). */
  #save(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#flush(), 250);
  }

  #flush(): void {
    if (this.#saveTimer === undefined) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = undefined;
    this.post({ type: "customThemesSave", themes: this.#customs });
  }

  #add(theme: Omit<CustomTheme, "id">): void {
    const taken = new Set(this.#customs.map((t) => t.name));
    let name = theme.name;
    for (let n = 2; taken.has(name); n++) name = `${theme.name} ${n}`;
    const id = Math.random().toString(36).slice(2, 10);
    this.#customs.push({ ...theme, name, id });
    this.#selected = id;
    this.#render();
    this.#save();
  }

  /** A new theme: a copy of the one in use (Classic when VS Code's colours are). */
  #new(): void {
    const base = themeFor(this.#current, this.#customs) ?? HIGHLAND_THEMES.classic!;
    const copy = { name: "Custom Theme", mode: base.mode } as Omit<CustomTheme, "id">;
    for (const c of THEME_COLORS) copy[c.key] = base[c.key];
    this.#add(copy);
    this.#name.focus();
    this.#name.select();
  }

  #importLink(text: string): void {
    const theme = parseThemeLink(text);
    if (!theme) {
      this.#importNote.textContent = "That isn't a theme link. A theme link looks like https://quoteunquoteapps.com/theme-builder/?Name,L,FFFFFF,…";
      return;
    }
    this.#importText.value = "";
    this.#import.hidden = true;
    this.#add(theme);
  }
}
