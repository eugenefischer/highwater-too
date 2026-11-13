import type { Document, Element, Inline, Span } from "@highwater/parser";

/** Highland's Navigator item types, named as in navigatorFilters.json. */
export const NAVIGATOR_TYPES = ["sceneHeaders", "sectionHeaders", "synopses", "notes", "images", "links", "referenceLinks", "includedFiles", "markers"] as const;
export type NavigatorType = (typeof NAVIGATOR_TYPES)[number];
export type NavigatorFilters = Record<NavigatorType, boolean>;

export const NAVIGATOR_LABELS: Record<NavigatorType, string> = {
  sceneHeaders: "Scene headings",
  sectionHeaders: "Sections and headings",
  synopses: "Synopses",
  notes: "Notes",
  images: "Images",
  links: "Links",
  referenceLinks: "Reference links",
  includedFiles: "Included files",
  markers: "Markers",
};

/** Highland's defaults for a new document: everything shown. */
export const DEFAULT_FILTERS: NavigatorFilters = Object.fromEntries(NAVIGATOR_TYPES.map((t) => [t, true])) as NavigatorFilters;

export interface NavigatorItem {
  type: NavigatorType;
  label: string;
  /** Sections and headings: their level (1 = #); others: null. */
  level: number | null;
  span: Span;
  children: NavigatorItem[];
}

/** Reads navigatorFilters.json; missing or bad keys keep their defaults. */
export function parseFilters(json: string | undefined): NavigatorFilters {
  const out = { ...DEFAULT_FILTERS };
  if (!json) return out;
  try {
    const data = JSON.parse(json) as Record<string, unknown>;
    for (const t of NAVIGATOR_TYPES) if (typeof data[t] === "boolean") out[t] = data[t] as boolean;
  } catch {
    // keep defaults
  }
  return out;
}

/**
 * The Navigator's items in document order, nested under the section or heading they fall in.
 * Hidden types are left out (their children move up to the nearest shown parent).
 */
export function navigatorItems(doc: Document, filters: NavigatorFilters = DEFAULT_FILTERS): NavigatorItem[] {
  const flat: NavigatorItem[] = [];
  const add = (type: NavigatorType, label: string, span: Span, level: number | null = null) => {
    // A marker or other {{…}} inside a heading isn't part of its name.
    const name = type === "sceneHeaders" || type === "sectionHeaders" ? label.replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ") : label;
    if (filters[type]) flat.push({ type, label: name.trim() || "(untitled)", level, span, children: [] });
  };
  for (const e of doc.elements) {
    switch (e.kind) {
      case "sceneHeading":
        add("sceneHeaders", e.sceneNumber ? `${e.text} #${e.sceneNumber.text}#` : e.text, e.span);
        break;
      case "section":
        add("sectionHeaders", e.text, e.span, e.level);
        break;
      case "heading":
        add("sectionHeaders", e.text, e.span, e.level);
        break;
      case "synopsis":
        add("synopses", e.text, e.span);
        break;
      case "linkDefinition":
        add("referenceLinks", `[${e.label}] ${e.url}`, e.span);
        break;
      default:
        break;
    }
    if (e.kind === "directiveLine")
      for (const d of e.directives) {
        if (d.directive.kind === "include") add("includedFiles", d.directive.path, d.span);
        else if (d.directive.kind === "marker") add("markers", d.directive.label, d.span);
      }
    for (const nodes of inlineOf(e)) walk(nodes);
  }

  function walk(nodes: Inline[]): void {
    for (const n of nodes) {
      // The note tying a plain file to its writing history ("highwater: <ID>") is not the writer's.
      if (n.kind === "note") {
        if (!/^\s*highwater:\s*[0-9A-Za-z-]{8,}\s*$/.test(n.text)) add("notes", n.text, n.span);
      }
      else if (n.kind === "image") add("images", n.alt || n.src, n.span);
      else if (n.kind === "link") {
        add(n.reference !== null ? "referenceLinks" : "links", `${textOf(n.children)}${n.url ? ` — ${n.url}` : ""}`, n.span);
        walk(n.children);
      } else if (n.kind === "styled") walk(n.children);
      else if (n.kind === "directive") {
        if (n.directive.kind === "include") add("includedFiles", n.directive.path, n.span);
        else if (n.directive.kind === "marker") add("markers", n.directive.label, n.span);
      }
    }
  }

  // Nest under sections/headings by level; everything else under the latest one.
  const roots: NavigatorItem[] = [];
  const stack: NavigatorItem[] = [];
  for (const item of flat) {
    if (item.level !== null) {
      while (stack.length && stack.at(-1)!.level! >= item.level) stack.pop();
      (stack.at(-1)?.children ?? roots).push(item);
      stack.push(item);
    } else (stack.at(-1)?.children ?? roots).push(item);
  }
  return roots;
}

function textOf(nodes: Inline[]): string {
  return nodes.map((n) => (n.kind === "text" ? n.text : n.kind === "styled" || n.kind === "link" ? textOf(n.children) : "")).join("");
}

/** Every inline array in an element. */
function inlineOf(e: Element): Inline[][] {
  switch (e.kind) {
    case "dialogue":
      return e.parts.flatMap((p) => (p.kind === "empty" ? [] : [p.inline]));
    case "blockQuote":
      return e.paragraphs.map((p) => p.inline);
    case "list":
      return e.items.map((i) => i.inline);
    case "termList":
      return e.items.flatMap((i) => [i.termInline, i.definitionInline]);
    case "table":
      return [...e.header, ...e.rows.flat()].map((c) => c.inline);
    default:
      return "inline" in e ? [e.inline] : [];
  }
}

// ---------------------------------------------------------------------------------------------
// Drag to reorder: a scene runs to the next scene, section or heading; a section or heading runs
// to the next one at its level or above.

type Block = { start: number; end: number };

/** The text a scene, section or heading starting at `start` covers, or null if none starts there. */
export function blockAt(doc: Document, start: number): Block | null {
  const i = doc.elements.findIndex((e) => e.span.start === start && (e.kind === "sceneHeading" || e.kind === "section" || e.kind === "heading"));
  if (i < 0) return null;
  const head = doc.elements[i]!;
  const level = head.kind === "sceneHeading" ? Infinity : (head as { level: number }).level;
  for (const e of doc.elements.slice(i + 1)) {
    if (e.kind === "sceneHeading" && level === Infinity) return { start, end: e.span.start };
    if ((e.kind === "section" || e.kind === "heading") && e.level <= (level === Infinity ? Infinity : level)) return { start, end: e.span.start };
  }
  return { start, end: doc.source.length };
}

/**
 * Edits that move a block to just before `to` (or to the end of the text when `to` is null), as
 * a delete and an insert in the original text's offsets. Null when the move changes nothing.
 */
export function moveBlock(source: string, block: Block, to: number | null): { delete: Block; insert: { at: number; text: string } } | null {
  const at = to ?? source.length;
  if (at >= block.start && at <= block.end) return null;
  let text = source.slice(block.start, block.end);
  // Every moved block ends with an empty line, as blocks between headings do.
  if (!text.endsWith("\n\n")) text = text.replace(/\n?$/, "\n\n");
  // Moving to the end: keep an empty line between the last text and the block.
  const prefix = to === null && !/\n\n$/.test(source) ? (source.endsWith("\n") ? "\n" : "\n\n") : "";
  return { delete: block, insert: { at, text: prefix + text } };
}

// ---------------------------------------------------------------------------------------------
// Rows for the Navigator pane: the items in document order, flat, with
// their depth, and for scenes, sections and headings the text they cover, so the pane can tell
// which drop places would move something.

export interface NavigatorRow {
  type: NavigatorType;
  label: string;
  depth: number;
  /** Where the item starts in the source. */
  start: number;
  /** Scenes, sections and headings: the end of the text they cover (they can be dragged, and dropped before). */
  blockEnd: number | null;
}

export function navigatorRows(doc: Document, items: NavigatorItem[]): NavigatorRow[] {
  const rows: NavigatorRow[] = [];
  const visit = (list: NavigatorItem[], depth: number) => {
    for (const item of list) {
      const movable = item.type === "sceneHeaders" || item.type === "sectionHeaders";
      rows.push({ type: item.type, label: item.label, depth, start: item.span.start, blockEnd: movable ? (blockAt(doc, item.span.start)?.end ?? null) : null });
      visit(item.children, depth + 1);
    }
  };
  visit(items, 0);
  return rows;
}

/** The row the cursor is in: the last one starting at or before it (rows are in document order). */
export function currentRow(rows: readonly NavigatorRow[], offset: number): number {
  let found = -1;
  for (let i = 0; i < rows.length && rows[i]!.start <= offset; i++) found = i;
  return found;
}
