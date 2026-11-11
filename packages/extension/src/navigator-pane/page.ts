/**
 * The Navigator pane's page (M15), in a VS Code webview view: Highland's list of scenes, sections
 * and the rest, the current one highlighted, a filter box at the foot, and scenes and sections
 * dragged to a new place with a line showing where they will land.
 */
import type { NavigatorRow } from "../syntax/navigator.ts";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();

const list = document.getElementById("list")!;
const empty = document.getElementById("empty")!;
const filter = document.getElementById("filter") as HTMLInputElement;
const dropLine = document.getElementById("drop")!;

let rows: NavigatorRow[] = [];
/** The colour variables a Highland theme set, to clear when it changes. */
let themed: string[] = [];
let length = 0;
let current = -1;
let dragging: NavigatorRow | null = null;
let gap: Gap | null = null;

function render(): void {
  const words = filter.value.trim().toLowerCase();
  list.replaceChildren();
  rows.forEach((row, i) => {
    if (words && !row.label.toLowerCase().includes(words)) return;
    const el = document.createElement("div");
    el.className = `row ${row.type}${i === current ? " current" : ""}`;
    el.dataset.index = String(i);
    el.style.paddingLeft = `${10 + (words ? 0 : row.depth) * 12}px`;
    el.textContent = row.label;
    el.title = row.label;
    // Scenes, sections and headings can be dragged (not while filtering: the gaps would be hidden).
    if (row.blockEnd !== null && !words) el.dataset.draggable = "true";
    list.append(el);
  });
  empty.hidden = rows.length > 0;
}

function showCurrent(): void {
  for (const el of list.querySelectorAll(".current")) el.classList.remove("current");
  const el = list.querySelector<HTMLElement>(`[data-index="${current}"]`);
  if (!el) return;
  el.classList.add("current");
  el.scrollIntoView({ block: "nearest" });
}

list.addEventListener("click", (e) => {
  if (justDragged) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".row");
  if (!el) return;
  const row = rows[Number(el.dataset.index)];
  if (row) vscode.postMessage({ type: "reveal", start: row.start });
});

filter.addEventListener("input", render);
document.getElementById("types")!.addEventListener("click", () => vscode.postMessage({ type: "chooseTypes" }));

// ---------------------------------------------------------------------------------------------
// Dragging: a scene, section or heading drops before another one, or at the end of the text.
// A place inside the dragged block (or right before or after it) changes nothing, so it isn't offered.
//
// With the pointer, not the browser's drag and drop: VS Code stops sending a webview mouse events
// once a browser drag passes over the rest of the window, until the drag ends, so a drag that left
// the pane and came back would lose its drop line. A captured pointer keeps reporting wherever it goes.

const THRESHOLD = 4; // pixels the pointer moves before a press becomes a drag
let pressed: { row: NavigatorRow; el: HTMLElement; y: number; pointer: number } | null = null;
let justDragged = false;

list.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".row");
  const row = el ? rows[Number(el.dataset.index)] : undefined;
  if (!el || !row || el.dataset.draggable !== "true") return;
  pressed = { row, el, y: e.clientY, pointer: e.pointerId };
});

list.addEventListener("pointermove", (e) => {
  if (!pressed || e.pointerId !== pressed.pointer) return;
  if (!dragging) {
    if (Math.abs(e.clientY - pressed.y) < THRESHOLD) return;
    dragging = pressed.row;
    pressed.el.setPointerCapture(e.pointerId);
    pressed.el.classList.add("dragging");
    document.body.classList.add("dragging");
  }
  pointer = { x: e.clientX, y: e.clientY };
  place();
  // Near the top or bottom edge (or past it), keep scrolling while the pointer stays there.
  if (edgeSpeed() !== 0 && !scrolling) scrolling = requestAnimationFrame(autoScroll);
});

let pointer = { x: 0, y: 0 };
let scrolling = 0;
const EDGE = 32; // pixels from the top or bottom where the list scrolls

/** Pixels a frame to scroll: faster the nearer the edge, fastest past it; 0 away from the edges. */
function edgeSpeed(): number {
  if (!dragging) return 0;
  const box = list.getBoundingClientRect();
  if (pointer.x < box.left || pointer.x > box.right) return 0;
  const step = (depth: number) => Math.round(2 + 14 * Math.min(1, depth / EDGE));
  if (pointer.y < box.top + EDGE) return -step(box.top + EDGE - pointer.y);
  if (pointer.y > box.bottom - EDGE) return step(pointer.y - (box.bottom - EDGE));
  return 0;
}

function autoScroll(): void {
  const speed = edgeSpeed();
  const before = list.scrollTop;
  if (speed !== 0) list.scrollTop += speed;
  if (speed === 0 || list.scrollTop === before) {
    scrolling = 0; // at the edge of the list, or the pointer moved away
    return;
  }
  place();
  scrolling = requestAnimationFrame(autoScroll);
}

/** The drop line at the nearest place to the pointer, or hidden outside the list. */
function place(): void {
  const box = list.getBoundingClientRect();
  const inside = pointer.x >= box.left && pointer.x <= box.right && pointer.y >= box.top && pointer.y <= box.bottom;
  if (!inside) return hideDrop();
  const y = pointer.y - box.top + list.scrollTop;
  // The nearest place, including the ones that would leave the block where it is: hovering over
  // where it already was hides the line, and letting go there moves nothing.
  let best: (Gap & { moves: boolean }) | null = null;
  for (const g of gaps()) if (!best || Math.abs(g.y - y) < Math.abs(best.y - y)) best = g;
  gap = best?.moves ? best : null;
  if (!gap) return hideDrop();
  dropLine.style.top = `${gap.y - 1 - list.scrollTop + list.offsetTop}px`;
  dropLine.style.left = `${12 + gap.depth * 12}px`;
  dropLine.hidden = false;
}


list.addEventListener("pointerup", (e) => {
  if (!pressed || e.pointerId !== pressed.pointer) return;
  if (dragging) {
    if (gap) vscode.postMessage({ type: "move", from: dragging.start, to: gap.to });
    justDragged = true; // the click that follows isn't a click on the row
    setTimeout(() => (justDragged = false), 0);
  }
  endDrag();
});
list.addEventListener("pointercancel", () => endDrag());
list.addEventListener("lostpointercapture", () => endDrag());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && dragging) endDrag();
});

function endDrag(): void {
  cancelAnimationFrame(scrolling);
  scrolling = 0;
  pressed?.el.classList.remove("dragging");
  document.body.classList.remove("dragging");
  pressed = null;
  dragging = null;
  hideDrop();
}

type Gap = { to: number | null; y: number; depth: number };

/**
 * The places a block could land, with the line's position: before each scene, section or heading,
 * and at the end. Those inside the block, or just before or after it, wouldn't move it (`moves` false).
 */
function gaps(): (Gap & { moves: boolean })[] {
  const d = dragging!;
  const top = list.getBoundingClientRect().top - list.scrollTop;
  const moves = (at: number) => !(at >= d.start && at <= d.blockEnd!);
  const out: (Gap & { moves: boolean })[] = [];
  for (const el of list.querySelectorAll<HTMLElement>(".row")) {
    const row = rows[Number(el.dataset.index)]!;
    if (row.blockEnd !== null) out.push({ to: row.start, y: el.getBoundingClientRect().top - top, depth: row.depth, moves: moves(row.start) });
  }
  const last = list.lastElementChild as HTMLElement | null;
  if (last) out.push({ to: null, y: last.getBoundingClientRect().bottom - top, depth: 0, moves: moves(length) });
  return out;
}

function hideDrop(): void {
  gap = null;
  dropLine.hidden = true;
}

// ---------------------------------------------------------------------------------------------

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type: string; vars?: Record<string, string> | null; rows?: NavigatorRow[]; length?: number; current?: number; empty?: string };
  if (msg.type === "rows") {
    rows = msg.rows ?? [];
    length = msg.length ?? 0;
    current = msg.current ?? -1;
    empty.textContent = msg.empty ?? "";
    if (!dragging) render();
  } else if (msg.type === "theme") {
    const root = document.documentElement.style;
    for (const name of themed) root.removeProperty(name);
    themed = msg.vars ? Object.keys(msg.vars) : [];
    for (const [name, value] of Object.entries(msg.vars ?? {})) root.setProperty(name, value);
  } else if (msg.type === "current") {
    current = msg.current ?? -1;
    showCurrent();
  }
});
vscode.postMessage({ type: "ready" });
