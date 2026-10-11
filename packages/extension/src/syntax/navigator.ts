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
    if (filters[type]) flat.push({ type, label: label.trim() || "(untitled)", level, span, children: [] });
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
      if (n.kind === "note") add("notes", n.text, n.span);
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
