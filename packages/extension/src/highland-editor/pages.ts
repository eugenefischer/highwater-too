/**
 * The Highwater Editor's preview mode, as Highland 2's: the same tab shows the printed pages
 * instead of the text (⌘E toggles), with zoom, "Page x of y" and the template at the top and the
 * print options and Save As PDF at the foot. Pages are drawn with pdf.js from the PDF the extension
 * lays out; anchors (page, y, source offset) map between the text and the pages, so switching
 * keeps your place.
 */
import type { FromPage, PdfMessage } from "./messages.ts";

type PdfPage = { getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } };
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; loadingTask?: { destroy(): Promise<void> } };
type PdfJs = { getDocument(o: { data: Uint8Array }): { promise: Promise<PdfDoc> }; GlobalWorkerOptions: { workerPort: Worker } };

export interface PrintBox {
  key: string;
  label: string;
}

export const PRINT_BOXES: PrintBox[] = [
  { key: "printRevisionColor", label: "Color Revisions" },
  { key: "printRevisionStars", label: "Star Revisions" },
  { key: "printParagraphNumbers", label: "Paragraph Numbers" },
  { key: "printSynopses", label: "Synopses" },
  { key: "printInlineNotes", label: "Notes" },
  { key: "printTitlePage", label: "Title Page" },
];

type Anchor = { page: number; y: number; offset: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Pages {
  #pdfjs: PdfJs | null = null;
  #pdf: PdfDoc | null = null;
  #sizes: [number, number][] = [];
  #anchors: Anchor[] = [];
  #generation = 0;
  #rendered = new Map<number, number>();
  #observer: IntersectionObserver;
  #pending: number | null = null;
  readonly #pages = $("pages");
  readonly #status = $("pstatus");
  readonly #zoom = $<HTMLSelectElement>("pzoom");
  readonly #template = $<HTMLButtonElement>("ptemplate");
  #templateName = "";
  readonly #word = $<HTMLButtonElement>("psaveword");
  shown = false;

  constructor(
    private readonly post: (msg: FromPage) => void,
    /** Leaving the pages: the source offset at their top, and (double-click) where to put the cursor. */
    private readonly onLeave: (top: number | null, cursor: number | null) => void,
    private readonly onTemplate: (current: string) => void,
  ) {
    this.#observer = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && void this.#draw(Number((e.target as HTMLElement).dataset.index))), { root: this.#pages, rootMargin: "800px 0px" });
    this.#zoom.onchange = () => this.#layout(this.#offsetAtTop());
    // The template button opens the Document Template window (template-window.ts).
    this.#template.onclick = () => this.onTemplate(this.#templateName);
    $("psave").onclick = () => post({ type: "previewSave", kind: "pdf" });
    this.#word.onclick = () => post({ type: "previewSave", kind: "docx" });
    const boxes = $("pboxes");
    for (const b of PRINT_BOXES) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.key = b.key;
      box.onchange = () => {
        this.#busy();
        post({ type: "printOption", key: b.key, value: box.checked });
      };
      label.append(box, ` ${b.label}`);
      boxes.append(label);
    }
    this.#pages.addEventListener("scroll", () => this.#showPage());
    window.addEventListener("resize", () => this.shown && this.#zoom.value === "fit" && this.#layout(this.#offsetAtTop()));
  }

  #dark: { background: string; text: string } | null = null;

  /**
   * Dark pages (with a dark theme and "Show dark PDF pages with dark themes"): each page drawn in the
   * theme's Sidebar Background with its Sidebar Text for the print, as Highland 2 shows them. The
   * PDF itself is unchanged.
   */
  darkPages(colors: { background: string; text: string } | null): void {
    if (JSON.stringify(colors) === JSON.stringify(this.#dark)) return;
    this.#dark = colors;
    document.body.classList.toggle("dark-pages", !!colors);
    if (this.shown && this.#pdf) this.#layout(this.#offsetAtTop());
  }

  /** The template menu in the top bar (shown with the text as well as the pages). */
  templates(list: readonly string[], current: string): void {
    this.#templateName = list.length ? current : "";
    this.#template.textContent = this.#templateName;
    this.#template.hidden = !this.#templateName;
    this.#word.hidden = current !== "Manuscript";
  }

  /** pdf.js, loaded once (the template window draws its page with it too). */
  async pdfjs(): Promise<PdfJs> {
    return (this.#pdfjs ??= await this.#load());
  }

  /** The pages are laid out again (a template or option changed in the template window). */
  relayout(): void {
    if (this.shown) this.#busy();
  }

  /** Shows the pages, opening at `at` (the text's top line) once they arrive. */
  show(at: number): void {
    this.shown = true;
    this.#pending = at;
    document.body.classList.add("previewing");
    // The last layout's pages show until the new one arrives: put them at the text's place now,
    // rather than at the place they were left, which then jumped when the new layout came.
    this.#placedTop = null;
    this.#place(at, "top");
    this.#busy();
    this.post({ type: "preview", at });
  }

  /** Scrolls the pages to where the text at `offset` prints (Navigator, search results). */
  reveal(offset: number, how: "top" | "center"): void {
    if (!this.shown) return;
    if (this.#pending !== null || !this.#anchors.length) {
      this.#pending = offset; // still laying out: open there (and go there on the pages showing meanwhile)
      this.#place(offset, how);
      return;
    }
    const top = this.#positionOf(offset);
    if (top === null) return;
    this.#pages.scrollTop = Math.max(0, how === "center" ? top - this.#pages.clientHeight / 2 : top);
  }

  /** Where #place last put the pages, until the new layout arrives (null: not placed). */
  #placedTop: number | null = null;

  /** Scrolls the pages showing (the last layout's, while a new one is made) to where `offset` printed. */
  #place(offset: number, how: "top" | "center"): void {
    const top = this.#positionOf(offset);
    if (top === null) return;
    this.#pages.scrollTop = Math.max(0, how === "center" ? top - this.#pages.clientHeight / 2 : top);
    this.#placedTop = this.#pages.scrollTop;
  }

  /** Back to the text: at what the pages showed at their top, or (double-click) a chosen place. */
  hide(cursor: number | null = null): void {
    if (!this.shown) return;
    const top = this.#offsetAtTop();
    this.shown = false;
    document.body.classList.remove("previewing");
    this.post({ type: "previewClosed" });
    this.onLeave(top, cursor);
  }

  async receive(msg: PdfMessage): Promise<void> {
    if (!this.shown) return;
    this.templates(msg.templates, msg.template);
    for (const box of $("pboxes").querySelectorAll<HTMLInputElement>("input")) box.checked = !!msg.print[box.dataset.key!];
    try {
      this.#pdfjs ??= await this.#load();
      const doc = await this.#pdfjs.getDocument({ data: msg.data }).promise;
      const sizes: [number, number][] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const v = (await doc.getPage(i)).getViewport({ scale: 1 });
        sizes.push([v.width, v.height]);
      }
      // Re-laid out (a template or option changed): stay at the same place in the text. Opening,
      // the place asked for, unless the reader has scrolled the pages showing meanwhile: then theirs.
      const scrolled = this.#placedTop !== null && Math.abs(this.#pages.scrollTop - this.#placedTop) > 1;
      const keep = (scrolled ? this.#offsetAtTop() : this.#pending) ?? this.#offsetAtTop();
      this.#placedTop = null;
      void this.#pdf?.loadingTask?.destroy();
      this.#pdf = doc;
      this.#sizes = sizes;
      this.#anchors = [];
      for (let k = 0; k + 2 < msg.anchors.length; k += 3) this.#anchors.push({ page: msg.anchors[k]!, y: msg.anchors[k + 1]!, offset: msg.anchors[k + 2]! });
      this.#generation++;
      this.#pending = null;
      this.#problems = msg.problems.length ? ` · ${msg.problems.join("; ")}` : "";
      this.#layout(keep);
    } catch (error) {
      this.#status.textContent = `Could not show the pages: ${(error as Error).message}`;
    }
  }

  empty(message: string): void {
    this.#pages.replaceChildren(Object.assign(document.createElement("div"), { className: "pmessage", textContent: message }));
    this.#status.textContent = "";
  }

  #problems = "";

  #busy(): void {
    this.#status.textContent = "Laying out…";
  }

  async #load(): Promise<PdfJs> {
    const pdfjs = (await import(/* @vite-ignore */ document.body.dataset.pdfjs!)) as PdfJs;
    // Workers must come from the webview's own origin: load the worker's code and start it from a blob.
    const code = await fetch(document.body.dataset.worker!).then((r) => r.text());
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })), { type: "module" });
    return pdfjs;
  }

  #scale(): number {
    return this.#zoom.value === "fit" ? Math.max(0.3, (this.#pages.clientWidth - 48) / 612) : Number(this.#zoom.value);
  }

  #pageEls(): HTMLElement[] {
    return [...this.#pages.querySelectorAll<HTMLElement>(".page")];
  }

  /** One placeholder per page, then scrolls to `at` (a source offset). */
  #layout(at: number | null): void {
    const s = this.#scale();
    this.#pages.querySelector(".pmessage")?.remove();
    const existing = this.#pageEls();
    existing.slice(this.#sizes.length).forEach((el) => el.remove());
    this.#sizes.forEach(([w, h], i) => {
      let el = existing[i];
      if (!el) {
        el = document.createElement("div");
        el.className = "page";
        el.dataset.index = String(i);
        el.addEventListener("dblclick", (ev) => this.#doubleClicked(i, ev));
        this.#pages.appendChild(el);
        this.#observer.observe(el);
      }
      el.style.width = `${w * s}px`;
      el.style.height = `${h * s}px`;
    });
    this.#rendered.clear();
    if (at !== null) {
      const top = this.#positionOf(at);
      if (top !== null) this.#pages.scrollTop = Math.max(0, top);
    }
    for (const el of this.#pageEls()) {
      const r = el.getBoundingClientRect();
      if (r.bottom > -800 && r.top < window.innerHeight + 800) void this.#draw(Number(el.dataset.index));
    }
    this.#showPage();
  }

  async #draw(i: number): Promise<void> {
    if (!this.#pdf || this.#rendered.get(i) === this.#generation) return;
    const gen = this.#generation;
    this.#rendered.set(i, gen);
    const page = await this.#pdf.getPage(i + 1);
    if (gen !== this.#generation) return;
    const viewport = page.getViewport({ scale: this.#scale() * (window.devicePixelRatio || 1) });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    if (gen !== this.#generation) return;
    if (this.#dark) darken(canvas, this.#dark.background, this.#dark.text);
    this.#pages.querySelector(`.page[data-index="${i}"]`)?.replaceChildren(canvas);
  }

  /** Where an anchor's line is, in the scrolling area: a little above its baseline. */
  #position(a: Anchor): number {
    const el = this.#pageEls()[a.page];
    return el ? el.offsetTop - this.#pages.offsetTop + (a.y - 16) * this.#scale() : 0;
  }

  /** Where the text at `offset` prints. */
  #positionOf(offset: number): number | null {
    const anchors = this.#anchors;
    if (!anchors.length) return null;
    let i = -1;
    for (let k = 0; k < anchors.length; k++) if (anchors[k]!.offset <= offset) i = k;
    if (i < 0) return this.#position(anchors[0]!);
    const a = anchors[i]!;
    const b = anchors.slice(i + 1).find((n) => n.offset > a.offset);
    const pa = this.#position(a);
    if (!b) return pa;
    // Past the last thing printed on a page (a page break, a directive): the next page's start.
    if (b.page !== a.page) return offset === a.offset ? pa : this.#position(b);
    return pa + ((this.#position(b) - pa) * (offset - a.offset)) / (b.offset - a.offset);
  }

  /** The source offset printed at the top of the visible pages. */
  #offsetAtTop(): number | null {
    const anchors = this.#anchors;
    if (!anchors.length) return null;
    const top = this.#pages.scrollTop;
    let i = 0;
    for (let k = 0; k < anchors.length; k++) if (this.#position(anchors[k]!) <= top) i = k;
    const a = anchors[i]!;
    const b = anchors[i + 1];
    if (!b || b.page !== a.page || b.offset <= a.offset) return a.offset;
    const pa = this.#position(a);
    const f = Math.min(1, Math.max(0, (top - pa) / (this.#position(b) - pa)));
    return Math.round(a.offset + f * (b.offset - a.offset));
  }

  /** Double-click on a page: back to the text, with the cursor at the line printed nearest. */
  #doubleClicked(i: number, ev: MouseEvent): void {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (ev.clientY - rect.top) / this.#scale();
    let best: Anchor | null = null;
    for (const a of this.#anchors) if (a.page === i && (!best || Math.abs(a.y - 4 - y) < Math.abs(best.y - 4 - y))) best = a;
    if (best) this.hide(best.offset);
  }

  #showPage(): void {
    if (!this.#sizes.length) return;
    const mid = this.#pages.scrollTop + this.#pages.clientHeight / 3;
    let n = 1;
    for (const el of this.#pageEls()) if (el.offsetTop - this.#pages.offsetTop <= mid) n = Number(el.dataset.index) + 1;
    this.#status.textContent = `Page ${n} of ${this.#sizes.length}${this.#problems}`;
  }
}

const rgbOf = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * A printed page recoloured dark: white paper becomes `background`, black print `text`, and the
 * greys between in proportion; colours (revision colours, highlights, images) keep their hue.
 */
export function darken(canvas: HTMLCanvasElement, background: string, text: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width || !canvas.height) return;
  const bg = rgbOf(background);
  const fg = rgbOf(text);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const grey = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    const light = grey / 255;
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, fg[c]! + (bg[c]! - fg[c]!) * light + (d[i + c]! - grey) * 0.8));
  }
  ctx.putImageData(image, 0, 0);
}
