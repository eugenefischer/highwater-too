/** Shared pieces of the Highwater Editor's sidebar: shortcut labels, small buttons, dates, the help popover, the popup menu and the drag image. */
import type { BinOp, FromPage, MenuItem } from "../messages.ts";
import type { Document } from "@highwater/parser";

/** On a Mac, shortcuts are written as Highland writes them (⌥⌘X); elsewhere as VS Code does there (Ctrl+Alt+X). */
export const MAC = /Mac/.test(navigator.platform || navigator.userAgent);
/** The page's own labels and tooltips, with their shortcuts written for this computer. */
export function localizeKeys(root: ParentNode): void {
  if (MAC) return;
  const fix = (t: string) => t.replace(/[⌃⌥⇧⌘]+[A-Z0-9=+\-↑↓]/g, (m) => keys(m));
  for (const el of root.querySelectorAll<HTMLElement>("[aria-label], [data-tip]")) {
    const label = el.getAttribute("aria-label");
    if (label) el.setAttribute("aria-label", fix(label));
    if (el.dataset.tip) el.dataset.tip = fix(el.dataset.tip);
  }
}
export function keys(mac: string): string {
  if (MAC) return mac;
  const mods = [mac.includes("⌃") || mac.includes("⌘") ? "Ctrl" : "", mac.includes("⌥") ? "Alt" : "", mac.includes("⇧") ? "Shift" : ""].filter(Boolean);
  return [...mods, mac.replace(/[⌃⌘⌥⇧]/g, "")].join("+");
}

export interface SidebarDeps {
  post(msg: FromPage): void;
  /** The latest parse of the text. */
  parsed(): Document | null;
  /** The text's length, and the cursor's offset. */
  length(): number;
  head(): number;
  /** Goes to an offset in the text (or the pages, when they show), moving the cursor there. */
  reveal(offset: number): void;
  /** Changes the text as the writer's own edit (sent on to the document; undoable). */
  edit(changes: { from: number; to: number; insert: string }[]): void;
  /** Puts text in at the cursor (a Bin item, an image reference). */
  insert(text: string): void;
  /**
   * Changes the Bin as a step of the page's undo history (Highland's: ⌘Z puts back a drag in or
   * out, or a deleted item). With `cut`, also takes that text out of the page if it is what is being
   * dragged from it (dragging to the Bin moves the text).
   */
  bin(op: BinOp, cut?: string): void;
}

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** A small icon button with a tooltip. */
export function button(tip: string, path: string, run: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `sb-button ${cls}`.trim();
  b.dataset.tip = tip;
  b.setAttribute("aria-label", tip);
  b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  b.onclick = (e) => {
    e.stopPropagation();
    run();
  };
  return b;
}

/** TODAY, YESTERDAY, then NOV 10, 2026. */
export function dayHeading(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "TODAY";
  if (d.toDateString() === yesterday.toDateString()) return "YESTERDAY";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

/** "3:42 PM" today, else "Nov 10, 3:42 PM". */
export function shortWhen(d: Date): string {
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * Help for one of Highwater's own panels: a popover beside the sidebar, its arrow at the ? button.
 * Escape, a click elsewhere or the ? again closes it.
 */
export function openHelp(anchor: HTMLElement, html: string): void {
  const pop = $("sbhelp");
  if (!pop.hidden) return closeHelp();
  $("sbhelptext").innerHTML = html;
  pop.hidden = false;
  const a = anchor.getBoundingClientRect();
  const side = $("sidebar").getBoundingClientRect();
  const height = Math.min(560, window.innerHeight - 24);
  const middle = a.top + a.height / 2;
  const top = Math.max(12, Math.min(window.innerHeight - height - 12, middle - 24));
  pop.style.left = `${Math.round(side.right + 10)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.height = `${height}px`;
  pop.style.setProperty("--arrow", `${Math.round(Math.max(16, Math.min(height - 16, middle - top)))}px`);
  $("sbhelptext").scrollTop = 0;
  pop.focus();
  const away = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeHelp();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeHelp();
      anchor.focus();
    }
  };
  document.addEventListener("mousedown", away, true);
  pop.addEventListener("keydown", keys);
  closeHelp = () => {
    pop.hidden = true;
    document.removeEventListener("mousedown", away, true);
    pop.removeEventListener("keydown", keys);
    closeHelp = () => {};
  };
}
let closeHelp: () => void = () => {};

/**
 * The sidebar's popup menu, above (or below) the button that opened it, like Highland's own
 * pop-up menus. Escape, a click elsewhere or a choice closes it; the arrow keys move through it.
 */
export function openMenu(anchor: HTMLElement, items: MenuItem[], pick: (command: string) => void): void {
  const menu = $("sbmenu");
  if (!menu.hidden) return closeMenu();
  menu.replaceChildren(
    ...items.flatMap((item) => {
      const b = document.createElement("button");
      b.setAttribute("role", "menuitem");
      if (item.danger) b.className = "danger";
      b.textContent = item.label;
      b.onclick = () => {
        closeMenu();
        pick(item.command);
      };
      return item.sep ? [document.createElement("hr"), b] : [b];
    }),
  );
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = `${Math.round(Math.max(4, Math.min(window.innerWidth - w - 4, r.right - w)))}px`;
  menu.style.top = `${Math.round(r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6)}px`;
  menu.querySelector<HTMLElement>("button")?.focus();
  const away = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) closeMenu();
  };
  const keys = (e: KeyboardEvent) => {
    const buttons = [...menu.querySelectorAll<HTMLElement>("button")];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      anchor.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      buttons[(i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }
  };
  document.addEventListener("mousedown", away, true);
  menu.addEventListener("keydown", keys);
  window.addEventListener("blur", closeMenu);
  closeMenu = () => {
    menu.hidden = true;
    document.removeEventListener("mousedown", away, true);
    menu.removeEventListener("keydown", keys);
    window.removeEventListener("blur", closeMenu);
    closeMenu = () => {};
  };
}
let closeMenu: () => void = () => {};

/**
 * What follows the pointer while a card is dragged: as in Highland, a small, nearly invisible
 * outline of it, so the drop caret in the text shows through (the browser's own picture is the
 * whole card).
 */
export function faintDragImage(e: DragEvent, text: string): void {
  const ghost = document.createElement("div");
  ghost.className = "sb-dragghost";
  ghost.textContent = text.split("\n").find((l) => l.trim())?.trim().slice(0, 60) ?? "";
  document.body.append(ghost);
  e.dataTransfer?.setDragImage(ghost, 40, 12);
  // The picture is taken now; the element itself can go.
  requestAnimationFrame(() => ghost.remove());
}
