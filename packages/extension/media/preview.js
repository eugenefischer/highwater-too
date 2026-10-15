// The preview webview: shows the PDF the extension renders, page by page with pdf.js, and keeps
// its scroll position in step with the editor using the extension's anchors (page, y, offset).
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const pagesEl = $("pages");
const status = $("status");
const templateEl = $("template");
const zoomEl = $("zoom");
const syncEl = $("sync");

let pdfjs;
let pdf = null;
let sizes = []; // [width, height] in points per page
const rendered = new Map(); // page index -> generation it was drawn for
let generation = 0;
let anchors = []; // [{ page, y, offset }] in print order
let summary = "";
/** The editor's top line (a source offset), as last heard from the extension or sent to it. */
let editorAt = null;

// The editor leads, except while the writer scrolls the preview: only scrolling the writer does
// here (wheel or trackpad, keys, dragging the scrollbar) is sent to the editor. Scrolls the preview
// makes itself (a refresh, a resize, pages finishing drawing) never move the editor.
// A press on the scrollbar is noticed, but the browser may never report its release, so a press
// counts only while the scrolling it causes goes on: it lapses 400 ms after the last scroll.
let userUntil = 0;
let pressed = false;
const intent = () => (userUntil = performance.now() + 400);
const userScrolling = () => performance.now() < userUntil;

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
if (state.sync === false) syncEl.checked = false;
const save = (patch) => vscode.setState({ ...(vscode.getState() ?? {}), ...patch });

templateEl.onchange = () => vscode.postMessage({ type: "template", template: templateEl.value });
zoomEl.onchange = () => {
  save({ zoom: zoomEl.value });
  layoutPages(true);
};
syncEl.onchange = () => save({ sync: syncEl.checked });
$("export").onclick = () => vscode.postMessage({ type: "export" });
$("exportDocx").onclick = () => vscode.postMessage({ type: "exportDocx" });
window.addEventListener("resize", () => zoomEl.value === "fit" && layoutPages(true));
pagesEl.addEventListener("wheel", intent, { passive: true });
pagesEl.addEventListener("touchmove", intent, { passive: true });
window.addEventListener("keydown", (e) => ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key) && intent());
// A press on the scrolling area itself (not on a page) is the scrollbar.
pagesEl.addEventListener("pointerdown", (e) => {
  if (e.target !== pagesEl) return;
  pressed = true;
  intent();
});
for (const ev of ["pointerup", "pointercancel", "blur"]) window.addEventListener(ev, () => (pressed = false));

const scale = () => (zoomEl.value === "fit" ? Math.max(0.3, (pagesEl.clientWidth - 40) / 612) : Number(zoomEl.value));
const pageEls = () => [...pagesEl.querySelectorAll(".page")];
/** A page's top within the scrolling area (offsetTop counts from the body, above the toolbar). */
const topOf = (el) => el.offsetTop - pagesEl.offsetTop;

const observer = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && draw(Number(e.target.dataset.index))), { root: pagesEl, rootMargin: "800px 0px" });

/**
 * Sizes one placeholder per page, then puts the editor's top line at the top again (with sync on
 * and the writer not scrolling here); otherwise keeps the scroll position as a fraction.
 */
function layoutPages(redraw) {
  const fraction = pagesEl.scrollHeight > 0 ? pagesEl.scrollTop / pagesEl.scrollHeight : 0;
  const s = scale();
  const existing = pageEls();
  existing.slice(sizes.length).forEach((el) => el.remove());
  sizes.forEach(([w, h], i) => {
    let el = existing[i];
    if (!el) {
      el = document.createElement("div");
      el.className = "page";
      el.dataset.index = String(i);
      el.addEventListener("click", (ev) => clicked(i, ev));
      pagesEl.appendChild(el);
      observer.observe(el);
    }
    el.style.width = `${w * s}px`;
    el.style.height = `${h * s}px`;
  });
  if (redraw) rendered.clear();
  if (syncEl.checked && editorAt !== null && anchors.length && !userScrolling()) scrollToOffset(editorAt);
  else pagesEl.scrollTop = fraction * pagesEl.scrollHeight;
  drawVisible();
}

function drawVisible() {
  for (const el of pageEls()) {
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

// ---------------------------------------------------------------------------------------------
// Scroll sync

/** Scroll position (in #pages) of an anchor's line, a little above its baseline. */
function position(a) {
  const el = pageEls()[a.page];
  return el ? topOf(el) + (a.y - 16) * scale() : 0;
}

/** Where the text at `offset` prints: between the anchors around it, by offset. */
function positionOf(offset) {
  if (!anchors.length) return null;
  let i = -1;
  for (let k = 0; k < anchors.length; k++) if (anchors[k].offset <= offset) i = k;
  if (i < 0) return position(anchors[0]);
  const a = anchors[i];
  const b = anchors.slice(i + 1).find((n) => n.offset > a.offset);
  const pa = position(a);
  if (!b || b.page !== a.page) return pa;
  return pa + ((position(b) - pa) * (offset - a.offset)) / (b.offset - a.offset);
}

/** The source offset printed at scroll position `top`. */
function offsetAt(top) {
  if (!anchors.length) return null;
  let i = 0;
  for (let k = 0; k < anchors.length; k++) if (position(anchors[k]) <= top) i = k;
  const a = anchors[i];
  const b = anchors[i + 1];
  if (!b || b.page !== a.page || b.offset <= a.offset) return a.offset;
  const pa = position(a);
  const f = Math.min(1, Math.max(0, (top - pa) / (position(b) - pa)));
  return Math.round(a.offset + f * (b.offset - a.offset));
}


function scrollToOffset(offset) {
  const top = positionOf(offset);
  if (top === null) return;
  pagesEl.scrollTop = Math.max(0, top);
  drawVisible();
}

let pending = 0;
pagesEl.addEventListener("scroll", () => {
  showPage();
  if (pressed && userScrolling()) intent(); // a scrollbar drag in progress
  else pressed = false;
  if (!syncEl.checked || !userScrolling()) return;
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    const offset = offsetAt(pagesEl.scrollTop);
    if (offset === null) return;
    editorAt = offset; // the editor follows
    vscode.postMessage({ type: "reveal", offset });
  });
});

/** Click on a page: put the editor's cursor at the line printed nearest the click. */
function clicked(i, ev) {
  const rect = ev.currentTarget.getBoundingClientRect();
  const y = (ev.clientY - rect.top) / scale();
  let best = null;
  for (const a of anchors) if (a.page === i && (!best || Math.abs(a.y - 4 - y) < Math.abs(best.y - 4 - y))) best = a;
  if (best) vscode.postMessage({ type: "jump", offset: best.offset });
}

function showPage() {
  if (!sizes.length) return;
  const mid = pagesEl.scrollTop + pagesEl.clientHeight / 3;
  let n = 1;
  for (const el of pageEls()) if (topOf(el) <= mid) n = Number(el.dataset.index) + 1;
  status.textContent = `Page ${n} of ${sizes.length}${summary}`;
}

// ---------------------------------------------------------------------------------------------

window.addEventListener("message", async ({ data: msg }) => {
  if (msg.type === "busy") status.textContent = "Updating…";
  else if (msg.type === "scrollTo") {
    editorAt = msg.offset;
    if (syncEl.checked && !userScrolling()) scrollToOffset(msg.offset);
  } else if (msg.type === "empty") {
    $("exportDocx").hidden = true;
    pdf = null;
    sizes = [];
    anchors = [];
    pagesEl.replaceChildren(Object.assign(document.createElement("div"), { id: "message", textContent: msg.message }));
    status.textContent = "";
  } else if (msg.type === "pdf") {
    templateEl.replaceChildren(...msg.templates.map((t) => new Option(t, t, false, t === msg.template)));
    // Word export is for manuscripts only.
    $("exportDocx").hidden = msg.template !== "Manuscript";
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
      anchors = [];
      for (let k = 0; k + 2 < msg.anchors.length; k += 3) anchors.push({ page: msg.anchors[k], y: msg.anchors[k + 1], offset: msg.anchors[k + 2] });
      generation++;
      pagesEl.querySelector("#message")?.remove();
      if (msg.at !== null) editorAt = msg.at;
      layoutPages(false);
      void old?.loadingTask?.destroy();
      summary = msg.problems.length ? ` · ${msg.problems.join("; ")}` : "";
      showPage();
    } catch (error) {
      status.textContent = `Could not show the PDF: ${error.message}`;
    }
  }
});

vscode.postMessage({ type: "ready" });
