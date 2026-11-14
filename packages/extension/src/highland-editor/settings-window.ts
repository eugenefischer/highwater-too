import { COLUMN_WIDTHS, EDITOR_FONTS, GENERAL_DEFAULTS, LINE_SPACINGS, SIDEBAR_TEXTS, type GeneralSettings } from "./general-settings.ts";
import { DOCUMENT_DEFAULTS, type DocumentSettings } from "./document-settings.ts";
import { INTERNATIONAL_DEFAULTS, type InternationalSettings } from "./international-settings.ts";
import type { FromPage } from "./messages.ts";
import { ThemeWindow } from "./theme-window.ts";

export const SETTINGS_TABS = ["general", "document", "international", "themes"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
const TAB_NAMES: Record<SettingsTab, string> = { general: "General", document: "Document", international: "International", themes: "Themes" };

/**
 * The Settings window, as Highland 2's: a tab for each group of settings (General, Document,
 * International and Themes; Highland's Backup is the writing history's job here). Settings are for every document and kept as VS Code
 * settings; each change is saved as it is made.
 */
export class SettingsWindow {
  readonly #root: HTMLElement;
  readonly #title: HTMLElement;
  readonly #panes = new Map<SettingsTab, HTMLElement>();
  readonly themes: ThemeWindow;
  readonly #general: GeneralPane;
  readonly #document: DocumentPane;
  readonly #international: InternationalPane;
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
    this.#document = new DocumentPane(post, this.#panes.get("document")!);
    this.#international = new InternationalPane(post, this.#panes.get("international")!);
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

  /** The Document settings' values, from the extension. */
  document(values: DocumentSettings): void {
    this.#document.update(values);
  }

  /** The International settings' values, from the extension. */
  international(values: InternationalSettings): void {
    this.#international.update(values);
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
    // A copy: choosing an option changes it before the extension confirms, and the page must
    // still see the old value then (a new column width lays the text out again).
    this.#values = { ...values };
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

/** The Document tab, laid out as Highland's: scene headers, dialogue, synopses. */
class DocumentPane {
  #values: DocumentSettings = { ...DOCUMENT_DEFAULTS };

  constructor(
    private readonly post: (msg: FromPage) => void,
    private readonly root: HTMLElement,
  ) {
    const box = (key: keyof DocumentSettings, label: string) => `<label class="st-check"><input type="checkbox" data-key="${key}"> ${label}</label>`;
    root.innerHTML = `<div class="st-form">
  <div class="st-row"><span class="st-label">Scene Headers:</span><span class="st-checks">${box("sceneHeadingBold", "Bold")}${box("sceneHeadingUnderline", "Underlined")}${box("sceneHeadingDoubleSpaced", "Double-Spaced")}</span></div>
  <div class="st-row"><span class="st-label"></span>${box("autoUppercaseSceneHeadings", "Auto-uppercase INT. and EXT.")}</div>
  <div class="st-row"><span class="st-label"></span>${box("autoCompleteLocations", "Auto-complete locations")}</div>
  <div class="st-rule"></div>
  <div class="st-row"><span class="st-label">Dialogue:</span>${box("autoCompleteCharacterNames", "Auto-complete character names")}</div>
  <div class="st-row"><span class="st-label"></span>${box("moreContd", "MORE/CONT’D for dialogue across page breaks")}</div>
  <div class="st-rule"></div>
  <div class="st-row"><span class="st-label">Synopses:</span>${box("synopsesItalic", "Italicized")}</div>
  <div class="st-foot"><button class="st-restore">Restore Defaults</button></div>
</div>`;
    for (const input of root.querySelectorAll<HTMLInputElement>("input[type=checkbox]"))
      input.onchange = () => {
        const key = input.dataset.key as keyof DocumentSettings;
        this.#values[key] = input.checked;
        this.post({ type: "settingSet", key, value: input.checked });
      };
    root.querySelector<HTMLButtonElement>(".st-restore")!.onclick = () => this.post({ type: "settingsRestore", tab: "document" });
    this.#fill();
  }

  update(values: DocumentSettings): void {
    this.#values = { ...values };
    this.#fill();
  }

  #fill(): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")) input.checked = this.#values[input.dataset.key as keyof DocumentSettings];
  }
}

type ListKey = "customLocations" | "customTimes" | "customTransitions";

/**
 * The International tab, laid out as Highland's: Use custom terms, three lists (scene-heading
 * prefixes, times of day, transitions) with + and −, and the words for MORE and CONTINUED. The
 * lists and words can be changed only with Use custom terms on.
 */
class InternationalPane {
  #values: InternationalSettings = structuredClone(INTERNATIONAL_DEFAULTS);
  readonly #selected: Record<ListKey, number> = { customLocations: -1, customTimes: -1, customTransitions: -1 };

  constructor(
    private readonly post: (msg: FromPage) => void,
    private readonly root: HTMLElement,
  ) {
    const list = (key: ListKey, label: string) =>
      `<div class="st-list" data-key="${key}"><div class="st-list-head">${label}</div><div class="st-list-items" role="listbox" aria-label="${label}"></div><div class="st-list-foot"><button class="st-add" aria-label="Add">+</button><button class="st-remove" aria-label="Remove">−</button></div></div>`;
    root.innerHTML = `<div class="st-form st-intl">
  <label class="st-check st-center"><input type="checkbox" class="st-custom"> Use custom terms</label>
  <div class="st-lists">${list("customLocations", "Location")}${list("customTimes", "Time of Day")}${list("customTransitions", "Transition")}</div>
  <div class="st-words"><label>MORE: <input type="text" class="st-word" data-key="customMore" spellcheck="false"></label><label>CONTINUED: <input type="text" class="st-word" data-key="customContd" spellcheck="false"></label></div>
  <div class="st-foot"><button class="st-restore">Restore Defaults</button></div>
</div>`;
    const custom = root.querySelector<HTMLInputElement>(".st-custom")!;
    custom.onchange = () => this.#set("useCustomTerms", custom.checked);
    for (const box of root.querySelectorAll<HTMLElement>(".st-list")) {
      const key = box.dataset.key as ListKey;
      box.querySelector<HTMLButtonElement>(".st-add")!.onclick = () => {
        const items = [...this.#values[key], ""];
        this.#values[key] = items;
        this.#selected[key] = items.length - 1;
        this.#fill();
        box.querySelector<HTMLInputElement>(`.st-item[data-i="${items.length - 1}"]`)?.focus();
      };
      box.querySelector<HTMLButtonElement>(".st-remove")!.onclick = () => {
        const i = this.#selected[key];
        if (i < 0) return;
        this.#set(key, this.#values[key].filter((_, k) => k !== i));
        this.#selected[key] = Math.min(i, this.#values[key].length - 1);
        this.#fill();
      };
    }
    for (const input of root.querySelectorAll<HTMLInputElement>(".st-word"))
      input.onchange = () => {
        const key = input.dataset.key as "customMore" | "customContd";
        if (input.value.trim()) this.#set(key, input.value.trim());
        else input.value = this.#values[key];
      };
    root.querySelector<HTMLButtonElement>(".st-restore")!.onclick = () => this.post({ type: "settingsRestore", tab: "international" });
    this.#fill();
  }

  update(values: InternationalSettings): void {
    // An item being typed (not yet saved) stays.
    if (this.root.contains(document.activeElement) && document.activeElement?.classList.contains("st-item")) return;
    this.#values = structuredClone(values);
    this.#fill();
  }

  #set<K extends keyof InternationalSettings>(key: K, value: InternationalSettings[K]): void {
    this.#values[key] = value;
    this.#fill();
    this.post({ type: "settingSet", key, value });
  }

  #fill(): void {
    const on = this.#values.useCustomTerms;
    this.root.querySelector<HTMLInputElement>(".st-custom")!.checked = on;
    this.root.querySelector(".st-intl")!.classList.toggle("st-off", !on);
    for (const box of this.root.querySelectorAll<HTMLElement>(".st-list")) {
      const key = box.dataset.key as ListKey;
      const items = box.querySelector<HTMLElement>(".st-list-items")!;
      items.replaceChildren(
        ...this.#values[key].map((text, i) => {
          const input = document.createElement("input");
          input.type = "text";
          input.className = `st-item${i === this.#selected[key] ? " st-selected" : ""}`;
          input.dataset.i = String(i);
          input.value = text;
          input.disabled = !on;
          input.spellcheck = false;
          input.onfocus = () => {
            this.#selected[key] = i;
            for (const el of items.querySelectorAll(".st-item")) el.classList.toggle("st-selected", el === input);
          };
          // Saved when you leave the item or press Enter; an emptied item goes.
          const save = () => {
            const list = this.#values[key].map((t, k) => (k === i ? input.value.trim() : t)).filter(Boolean);
            if (JSON.stringify(list) !== JSON.stringify(this.#values[key].filter(Boolean))) this.#set(key, list);
            else if (!input.value.trim()) {
              this.#values[key] = list;
              this.#fill();
            }
          };
          input.onblur = save;
          input.onkeydown = (e) => {
            if (e.key === "Enter") input.blur();
          };
          return input;
        }),
      );
      for (const b of box.querySelectorAll<HTMLButtonElement>("button")) b.disabled = !on;
    }
    for (const input of this.root.querySelectorAll<HTMLInputElement>(".st-word")) {
      input.disabled = !on;
      if (document.activeElement !== input) input.value = this.#values[input.dataset.key as "customMore" | "customContd"];
    }
  }
}

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
