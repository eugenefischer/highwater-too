// The preview webview: shows the PDF the extension renders, page by page with pdf.js.
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const pagesEl = $("pages");
const status = $("status");
const templateEl = $("template");
const zoomEl = $("zoom");

let pdfjs;
let pdf = null;
let sizes = []; // [width, height] in points per page
let rendered = new Map(); // page index -> generation it was drawn for
let generation = 0;

try {
  pdfjs = await import(document.body.dataset.pdfjs);
  // Workers must come from the webview's own origin: load the worker's code and start it from a blob.
  const code = await fetch(document.body.dataset.worker).then((r) => r.text());
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })), { type: "module" });
} catch (error) {
  vscode.postMessage({ type: "error", message: `could not start pdf.js (${error.message})` });
}

const state = vscode.getState() ?? {};
if (state.zoom) zoomEl.value = state.zoom;

templateEl.onchange = () => vscode.postMessage({ type: "template", template: templateEl.value });
zoomEl.onchange = () => {
  vscode.setState({ ...vscode.getState(), zoom: zoomEl.value });
  layoutPages(true);
};
$("export").onclick = () => vscode.postMessage({ type: "export" });
window.addEventListener("resize", () => zoomEl.value === "fit" && layoutPages(true));

const scale = () => (zoomEl.value === "fit" ? Math.max(0.3, (pagesEl.clientWidth - 40) / 612) : Number(zoomEl.value));

const observer = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && draw(Number(e.target.dataset.index))), { root: pagesEl, rootMargin: "800px 0px" });

/** Sizes one placeholder per page; keeps the scroll position as a fraction of the document. */
function layoutPages(redraw) {
  const fraction = pagesEl.scrollHeight > 0 ? pagesEl.scrollTop / pagesEl.scrollHeight : 0;
  const s = scale();
  const existing = [...pagesEl.querySelectorAll(".page")];
  existing.slice(sizes.length).forEach((el) => el.remove());
  sizes.forEach(([w, h], i) => {
    let el = existing[i];
    if (!el) {
      el = document.createElement("div");
      el.className = "page";
      el.dataset.index = String(i);
      pagesEl.appendChild(el);
      observer.observe(el);
    }
    el.style.width = `${w * s}px`;
    el.style.height = `${h * s}px`;
  });
  if (redraw) rendered.clear();
  pagesEl.scrollTop = fraction * pagesEl.scrollHeight;
  // Redraw the pages in view now; the observer draws the rest as they scroll in.
  for (const el of pagesEl.querySelectorAll(".page")) {
    const r = el.getBoundingClientRect();
    if (r.bottom > -800 && r.top < window.innerHeight + 800) draw(Number(el.dataset.index));
  }
}

async function draw(i) {
  if (!pdf || rendered.get(i) === generation) return;
  const gen = generation;
  rendered.set(i, gen);
  const page = await pdf.getPage(i + 1);
  if (gen !== generation) return;
  const viewport = page.getViewport({ scale: scale() * (window.devicePixelRatio || 1) });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  if (gen !== generation) return;
  const el = pagesEl.querySelector(`.page[data-index="${i}"]`);
  if (el) el.replaceChildren(canvas);
}

window.addEventListener("message", async ({ data: msg }) => {
  if (msg.type === "busy") status.textContent = "Updating…";
  else if (msg.type === "empty") {
    pdf = null;
    sizes = [];
    pagesEl.replaceChildren(Object.assign(document.createElement("div"), { id: "message", textContent: msg.message }));
    status.textContent = "";
  } else if (msg.type === "pdf") {
    templateEl.replaceChildren(...msg.templates.map((t) => new Option(t, t, false, t === msg.template)));
    try {
      const doc = await pdfjs.getDocument({ data: msg.data }).promise;
      const next = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const v = (await doc.getPage(i)).getViewport({ scale: 1 });
        next.push([v.width, v.height]);
      }
      const old = pdf;
      pdf = doc;
      sizes = next;
      generation++;
      pagesEl.querySelector("#message")?.remove();
      layoutPages(false);
      void old?.loadingTask?.destroy();
      status.textContent = `${msg.pages} ${msg.pages === 1 ? "page" : "pages"}${msg.problems.length ? ` · ${msg.problems.join("; ")}` : ""}`;
    } catch (error) {
      status.textContent = `Could not show the PDF: ${error.message}`;
    }
  }
});

vscode.postMessage({ type: "ready" });
