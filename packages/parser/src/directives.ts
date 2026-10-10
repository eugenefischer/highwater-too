import type { Directive, Element, Inline, PageTextPart, PageTextSlots, PlacedDirective } from "./ast.ts";
import { offsetAt, type LogicalText } from "./overlays.ts";

const SHAPE = /^\{\{\s*([^:{}]*?)\s*(?::([\s\S]*))?\}\}$/;
const PAGE_TOKEN = /%pp|%p|%#/g;

/** Reads one `{{…}}` directive (braces included). Names are case-insensitive. */
export function parseDirective(text: string): Directive {
  const m = SHAPE.exec(text);
  const rawName = m?.[1] ?? text.slice(2, -2).trim();
  const value = m?.[2] === undefined ? null : m[2].trim();
  const name = rawName.toUpperCase();
  switch (name) {
    case "HEADER":
    case "FOOTER":
      return pageText(name === "HEADER" ? "header" : "footer", value ?? "");
    case "PAGENUMBER":
      return { kind: "pageNumber", value: value !== null && /^\d+$/.test(value) ? Number(value) : null };
    case "INCLUDE":
      return { kind: "include", path: value ?? "" };
    case "SERIES":
      if (value !== null && /^\d+$/.test(value)) return { kind: "series", start: Number(value), label: null };
      return { kind: "series", start: null, label: value || null };
    case "TIMESTAMP":
      return { kind: "timestamp", format: value || null };
    case "TOC": {
      const levels = (value ?? "").match(/#+/g)?.map((h) => h.length) ?? [];
      return { kind: "toc", levels: levels.length ? [...new Set(levels)].sort((a, b) => a - b) : null };
    }
    case "%M":
      return { kind: "marker", label: value ?? "" };
    default:
      return { kind: "other", name: rawName, value };
  }
}

/**
 * Header/footer alignment, per Highland's cheat sheet: one segment uses the default (headers right,
 * footers centred); "A | B" is left and right; "A | B | C" is left, centre and right. Empty segments
 * print nothing, so "A |" is left only and "| A |" centre only.
 */
function pageText(kind: "header" | "footer", value: string): Directive {
  const empty: PageTextSlots = { left: null, center: null, right: null };
  if (/%none\b/i.test(value)) return { kind, off: true, slots: empty };
  const segs = value.split("|").map((s) => s.trim());
  const slots: PageTextSlots = { ...empty };
  if (segs.length === 1) slots[kind === "header" ? "right" : "center"] = parts(segs[0]!);
  else if (segs.length === 2) {
    slots.left = parts(segs[0]!);
    slots.right = parts(segs[1]!);
  } else {
    slots.left = parts(segs[0]!);
    slots.center = parts(segs.slice(1, -1).join(" | "));
    slots.right = parts(segs.at(-1)!);
  }
  return { kind, off: false, slots };
}

function parts(segment: string): PageTextPart[] | null {
  if (segment === "") return null;
  const out: PageTextPart[] = [];
  let last = 0;
  for (const m of segment.matchAll(PAGE_TOKEN)) {
    if (m.index > last) out.push({ kind: "text", text: segment.slice(last, m.index) });
    out.push(m[0] === "%pp" ? { kind: "pageCount" } : m[0] === "%p" ? { kind: "page" } : { kind: "section" });
    last = m.index + m[0].length;
  }
  if (last < segment.length) out.push({ kind: "text", text: segment.slice(last) });
  return out;
}

/** The directives on a directive-only line, with source spans. */
export function directivesInLine(lt: LogicalText): PlacedDirective[] {
  const out: PlacedDirective[] = [];
  for (const m of lt.text.matchAll(/\{\{[^{}]*\}\}/g)) {
    const a = m.index;
    const b = a + m[0].length;
    out.push({ directive: parseDirective(m[0]), text: m[0], span: { start: offsetAt(lt, a), end: offsetAt(lt, b - 1) + 1 }, inline: false });
  }
  return out;
}

/** Every directive in the elements, in reading order. */
export function collectDirectives(elements: Element[]): PlacedDirective[] {
  const out: PlacedDirective[] = [];
  const visit = (nodes: Inline[]): void => {
    for (const n of nodes) {
      if (n.kind === "directive") out.push({ directive: n.directive, text: n.text, span: n.span, inline: true });
      else if (n.kind === "styled" || n.kind === "link") visit(n.children);
    }
  };
  for (const e of elements) {
    switch (e.kind) {
      case "directiveLine":
        out.push(...e.directives);
        break;
      case "dialogue":
        for (const p of e.parts) if (p.kind !== "empty") visit(p.inline);
        break;
      case "blockQuote":
        for (const p of e.paragraphs) visit(p.inline);
        break;
      case "list":
        for (const it of e.items) visit(it.inline);
        break;
      case "termList":
        for (const it of e.items) {
          visit(it.termInline);
          visit(it.definitionInline);
        }
        break;
      case "table":
        for (const c of e.header) visit(c.inline);
        for (const row of e.rows) for (const c of row) visit(c.inline);
        break;
      case "pageBreak":
      case "sceneBreak":
      case "linkDefinition":
        break;
      default:
        visit(e.inline);
    }
  }
  return out;
}

/**
 * Numbers `{{SERIES}}` directives in reading order. Call it once per printed document (after
 * includes are merged) and pass each series directive in turn. There is one counter: a number
 * sets it, anything else adds 1. Checked in Highland 2: SERIES, SERIES: test, SERIES, SERIES: 5,
 * SERIES printed 1, 2, 3, 5, 6.
 */
export function seriesCounter(): (d: Extract<Directive, { kind: "series" }>) => number {
  let n = 0;
  return (d) => (n = d.start ?? n + 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `{{TIMESTAMP}}` as Highland prints it: "Sep 28, 2026". */
export function formatTimestamp(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
