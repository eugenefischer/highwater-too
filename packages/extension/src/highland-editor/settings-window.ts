import { COLUMN_WIDTHS, EDITOR_FONTS, GENERAL_DEFAULTS, LINE_SPACINGS, SIDEBAR_TEXTS, type GeneralSettings } from "./general-settings.ts";
import type { FromPage } from "./messages.ts";
import { ThemeWindow } from "./theme-window.ts";

export const SETTINGS_TABS = ["general", "themes"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const TAB_NAMES: Record<SettingsTab, string> = { general: "General", themes: "Themes" };

/**
 * The Settings window, as Highland 2's: a tab for each group of settings (General and Themes so
 * far; Document and International to come). Settings are for every document and kept as VS Code
 * settings; each change is saved as it is made.
 */
export class SettingsWindow {
  readonly #root: HTMLElement;
  readonly #title: HTMLElement;
  readonly #panes = new Map<SettingsTab, HTMLElement>();
  readonly themes: ThemeWindow;
  readonly #general: GeneralPane;
  #tab: SettingsTab = "general";

  constructor(post: (msg: FromPage) => void) {
    this.#root = document.createElement("div");
    this.#root.id = "setwin";
    this.#root.hidden = true;
    const tabs = SETTINGS_TABS.map((t) => `<button role="tab" data-tab="${t}">${TAB_NAMES[t]}</button>`).join("");
    const panes = SETTINGS_TABS.map((t) => `<div class="st-pane" role="tabpanel" data-pane="${t}" hidden></div>`).join("");
    this.#root.innerHTML = `<div class="tw-sheet tm-sheet st-sheet" role="dialog" aria-modal="true" aria-labelledby="st-title">
  <div class="tw-head"><h1 id="st-title"></h1><button class="tw-done">Done</button></div>
  <div class="st-tabs" role="tablist">${tabs}</div>
  ${panes}
</div>`;
    document.body.append(this.#root);
    this.#title = this.#root.querySelector("#st-title")!;
    for (const t of SETTINGS_TABS) this.#panes.set(t, this.#root.querySelector<HTMLElement>(`[data-pane="${t}"]`)!);
    for (const b of this.#root.querySelectorAll<HTMLButtonElement>(".st-tabs button")) b.onclick = () => this.#show(b.dataset.tab as SettingsTab);
    this.#general = new GeneralPane(post, this.#panes.get("general")!);
    this.themes = new ThemeWindow(post, this.#panes.get("themes")!);
    this.#root.querySelector<HTMLButtonElement>(".tw-done")!.onclick = () => this.close();
    this.#root.addEventListener("mousedown", (e) => e.target === this.#root && this.close());
    this.#root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  get shown(): boolean {
    return !this.#root.hidden;
  }

  /** Opens at a tab (the last one shown, if none is named). */
  open(tab: SettingsTab = this.#tab): void {
    this.#root.hidden = false;
    this.#show(tab);
    this.#root.querySelector<HTMLButtonElement>(".tw-done")!.focus();
  }

  close(): void {
    if (this.#tab === "themes") this.themes.close();
    this.#root.hidden = true;
  }

  /** The General settings' values, from the extension. */
  general(values: GeneralSettings): void {
    this.#general.update(values);
  }

  #show(tab: SettingsTab): void {
    if (this.#tab === "themes" && tab !== "themes") this.themes.close();
    this.#tab = tab;
    this.#title.textContent = TAB_NAMES[tab];
    for (const [t, pane] of this.#panes) pane.hidden = t !== tab;
    for (const b of this.#root.querySelectorAll<HTMLButtonElement>(".st-tabs button")) {
      const on = b.dataset.tab === tab;
      b.classList.toggle("st-on", on);
      b.setAttribute("aria-selected", String(on));
    }
    if (tab === "themes") this.themes.open();
  }
}

type Choice<K extends keyof GeneralSettings> = { key: K; label: string; options: readonly { value: GeneralSettings[K]; label: string }[] };

/** The General tab, laid out as Highland's. */
class GeneralPane {
  #values: GeneralSettings = { ...GENERAL_DEFAULTS };

  constructor(
    private readonly post: (msg: FromPage) => void,
    private readonly root: HTMLElement,
  ) {
    const choices: Choice<"editorFont" | "columnWidth" | "lineSpacing" | "sidebarText">[] = [
      { key: "editorFont", label: "Editor Font", options: EDITOR_FONTS.map((f) => ({ value: f, label: f })) },
      { key: "columnWidth", label: "Column Width", options: COLUMN_WIDTHS.map((v) => ({ value: v, label: cap(v) })) },
      { key: "lineSpacing", label: "Line Spacing", options: LINE_SPACINGS.map((v) => ({ value: v, label: cap(v) })) },
      { key: "sidebarText", label: "Sidebar Text", options: SIDEBAR_TEXTS.map((v) => ({ value: v, label: cap(v) })) },
    ];
    const segmented = (c: (typeof choices)[number]) =>
      `<div class="st-row"><span class="st-label">${c.label}:</span><span class="st-seg" role="radiogroup" aria-label="${c.label}" data-key="${c.key}">${c.options.map((o) => `<button role="radio" data-value="${o.value}">${o.label}</button>`).join("")}</span></div>`;
    const box = (key: keyof GeneralSettings, label: string) => `<div class="st-row"><span class="st-label"></span><label class="st-check"><input type="checkbox" data-key="${key}"> ${label}</label></div>`;
    root.innerHTML = `<div class="st-form">
  ${segmented(choices[0]!)}
  ${segmented(choices[1]!)}
  ${segmented(choices[2]!)}
  <div class="st-row"><span class="st-label">Invisibles Brightness:</span><input type="range" class="st-range" min="0" max="100" step="1" data-key="invisiblesBrightness" aria-label="Invisibles Brightness"></div>
  ${box("saveCursorPosition", "Save cursor position in document")}
  <div class="st-rule"></div>
  ${segmented(choices[3]!)}
  ${box("navigatorMarkup", "Show markup (#, =, [[ ]]) in Navigator")}
  ${box("excludeNotesFromWordCount", "Exclude notes from document word count")}
  <div class="st-foot"><button class="st-restore">Restore Defaults</button></div>
</div>`;
    for (const seg of root.querySelectorAll<HTMLElement>(".st-seg"))
      for (const b of seg.querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => this.#set(seg.dataset.key as keyof GeneralSettings, b.dataset.value!);
    for (const input of root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) input.onchange = () => this.#set(input.dataset.key as keyof GeneralSettings, input.checked);
    const range = root.querySelector<HTMLInputElement>(".st-range")!;
    range.oninput = () => this.#set("invisiblesBrightness", Number(range.value));
    root.querySelector<HTMLButtonElement>(".st-restore")!.onclick = () => this.post({ type: "settingsRestore", tab: "general" });
    this.#fill();
  }

  update(values: GeneralSettings): void {
    this.#values = values;
    this.#fill();
  }

  #set(key: keyof GeneralSettings, value: string | number | boolean): void {
    (this.#values as unknown as Record<string, unknown>)[key] = value;
    this.#fill();
    this.post({ type: "settingSet", key, value });
  }

  #fill(): void {
    const v = this.#values as unknown as Record<string, unknown>;
    for (const seg of this.root.querySelectorAll<HTMLElement>(".st-seg"))
      for (const b of seg.querySelectorAll<HTMLButtonElement>("button")) {
        const on = v[seg.dataset.key!] === b.dataset.value;
        b.classList.toggle("st-on", on);
        b.setAttribute("aria-checked", String(on));
      }
    for (const input of this.root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) input.checked = v[input.dataset.key!] === true;
    const range = this.root.querySelector<HTMLInputElement>(".st-range")!;
    if (document.activeElement !== range) range.value = String(v.invisiblesBrightness);
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
