import { TEMPLATE_INFO, type TemplateInfo } from "../template-info.ts";

/**
 * Highland 2's Document Template window: the templates by group on the left; on the right the
 * chosen one's first page (your text, laid out by the extension), its name and description, and
 * its Template Options. Picking a template changes the document's; the options are app-wide
 * settings, as in Highland.
 */

type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } };
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; loadingTask?: { destroy(): Promise<void> } };
export type PdfJs = { getDocument(o: { data: Uint8Array }): { promise: Promise<PdfDoc> } };

export type OptionValues = Record<string, Record<string, string | boolean>>;

const GROUPS: TemplateInfo["group"][] = ["Scripts", "Literary", "Professional", "Academic", "Unformatted"];
const THUMB_WIDTH = 216;

export class TemplateWindow {
  readonly #root: HTMLElement;
  readonly #list: HTMLElement;
  readonly #thumb: HTMLCanvasElement;
  readonly #thumbNote: HTMLElement;
  readonly #name: HTMLElement;
  readonly #description: HTMLElement;
  readonly #options: HTMLElement;
  #current = "";
  #values: OptionValues = {};
  #thumbFor = "";
  #thumbGeneration = 0;
  #pdf: PdfDoc | null = null;
  shown = false;

  constructor(
    private readonly post: (msg: unknown) => void,
    private readonly pdfjs: () => Promise<PdfJs>,
  ) {
    this.#root = document.createElement("div");
    this.#root.id = "tplwin";
    this.#root.hidden = true;
    this.#root.innerHTML = `<div class="tw-sheet" role="dialog" aria-modal="true" aria-labelledby="tw-title">
  <div class="tw-head"><h1 id="tw-title">Document Template</h1><button class="tw-done">Done</button></div>
  <div class="tw-body">
    <div class="tw-list" role="listbox" aria-label="Templates"></div>
    <div class="tw-detail">
      <div class="tw-thumb"><canvas width="${THUMB_WIDTH}" height="${Math.round((THUMB_WIDTH * 792) / 612)}"></canvas><span class="tw-thumb-note"></span></div>
      <h2 class="tw-name"></h2>
      <div class="tw-description"></div>
      <div class="tw-options"></div>
    </div>
  </div>
</div>`;
    document.body.append(this.#root);
    const q = <T extends HTMLElement>(sel: string) => this.#root.querySelector(sel) as T;
    this.#list = q(".tw-list");
    this.#thumb = q("canvas");
    this.#thumbNote = q(".tw-thumb-note");
    this.#name = q(".tw-name");
    this.#description = q(".tw-description");
    this.#options = q(".tw-options");
    q<HTMLButtonElement>(".tw-done").onclick = () => this.close();
    // A click outside the sheet closes it, as Escape does.
    this.#root.addEventListener("mousedown", (e) => e.target === this.#root && this.close());
    this.#root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const names = TEMPLATE_INFO.map((t) => t.name);
        const i = names.indexOf(this.#current);
        const next = names[Math.min(names.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))]!;
        if (next !== this.#current) this.#choose(next);
      }
    });
    for (const group of GROUPS) {
      const h = document.createElement("div");
      h.className = "tw-group";
      h.textContent = group.toUpperCase();
      this.#list.append(h);
      for (const t of TEMPLATE_INFO.filter((x) => x.group === group)) {
        const b = document.createElement("button");
        b.className = "tw-item";
        b.textContent = t.name;
        b.dataset.name = t.name;
        b.setAttribute("role", "option");
        b.onclick = () => this.#choose(t.name);
        this.#list.append(b);
      }
    }
  }

  open(current: string): void {
    this.shown = true;
    this.#root.hidden = false;
    this.#current = current;
    this.#thumbFor = "";
    this.#show();
    this.post({ type: "templateWindow" });
    (this.#list.querySelector(`[data-name="${CSS.escape(current)}"]`) as HTMLElement | null)?.focus();
  }

  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.#root.hidden = true;
    void this.#pdf?.loadingTask?.destroy();
    this.#pdf = null;
  }

  /** The document's template changed (here or elsewhere). */
  template(current: string): void {
    if (!this.shown || current === this.#current || !current) return;
    this.#current = current;
    this.#show();
  }

  /** The options in effect (sent on opening and whenever a setting changes); redraws the page. */
  values(values: OptionValues): void {
    this.#values = values;
    if (!this.shown) return;
    this.#thumbFor = "";
    this.#show();
  }

  /** The chosen template's first page. */
  async thumbnail(template: string, data: Uint8Array | null, message: string): Promise<void> {
    if (!this.shown || template !== this.#current) return;
    const mine = ++this.#thumbGeneration;
    const canvas = this.#thumb;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.#thumbNote.textContent = data ? "" : message;
    if (!data) return;
    try {
      const pdfjs = await this.pdfjs();
      const doc = await pdfjs.getDocument({ data }).promise;
      if (mine !== this.#thumbGeneration) return void doc.loadingTask?.destroy();
      void this.#pdf?.loadingTask?.destroy();
      this.#pdf = doc;
      const page = await doc.getPage(1);
      const ratio = window.devicePixelRatio || 1;
      const base = page.getViewport({ scale: 1 });
      const scale = (THUMB_WIDTH / base.width) * ratio;
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${THUMB_WIDTH}px`;
      canvas.style.height = `${(viewport.height / ratio).toFixed(1)}px`;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      if (mine === this.#thumbGeneration) this.#thumbNote.textContent = `Could not draw the page: ${(e as Error).message}`;
    }
  }

  #choose(name: string): void {
    this.#current = name;
    this.post({ type: "previewTemplate", template: name });
    this.#show();
    (this.#list.querySelector(`[data-name="${CSS.escape(name)}"]`) as HTMLElement | null)?.focus();
  }

  #show(): void {
    const t = TEMPLATE_INFO.find((x) => x.name === this.#current);
    for (const b of this.#list.querySelectorAll<HTMLElement>(".tw-item")) {
      const on = b.dataset.name === this.#current;
      b.classList.toggle("tw-selected", on);
      b.setAttribute("aria-selected", String(on));
    }
    if (!t) return;
    this.#name.textContent = t.name;
    this.#description.replaceChildren(
      ...t.description.split("\n\n").map((para) => {
        const p = document.createElement("p");
        p.textContent = para;
        return p;
      }),
    );
    this.#options.replaceChildren();
    if (t.options.length) {
      const h = document.createElement("div");
      h.className = "tw-options-head";
      h.textContent = "TEMPLATE OPTIONS";
      this.#options.append(h);
    }
    const values = this.#values[t.name] ?? {};
    for (const o of t.options) {
      const row = document.createElement("label");
      row.className = `tw-option tw-${o.kind}`;
      const value = values[o.key] ?? o.default;
      if (o.kind === "font") {
        const span = document.createElement("span");
        span.textContent = o.label;
        const select = document.createElement("select");
        for (const c of o.choices ?? []) select.append(new Option(c, c, false, c === value));
        select.onchange = () => this.post({ type: "templateOption", template: t.name, key: o.key, value: select.value });
        row.append(span, select);
      } else {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = value === true;
        box.onchange = () => this.post({ type: "templateOption", template: t.name, key: o.key, value: box.checked });
        row.append(box, ` ${o.label}`);
      }
      this.#options.append(row);
    }
    if (this.#thumbFor !== t.name) {
      this.#thumbFor = t.name;
      this.post({ type: "templateThumb", template: t.name });
    }
  }
}
