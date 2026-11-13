import type { Document, Span } from "@highwater/parser";

/** A section, scene or heading with everything under it, for the outline and folding. */
export interface OutlineNode {
  kind: "section" | "scene" | "heading";
  name: string;
  level: number;
  /** The heading line. */
  selection: Span;
  /** From the heading to the end of the last element before the next heading of the same or a higher level. */
  range: Span;
  children: OutlineNode[];
}

/** Scenes sit below every section level. */
const SCENE_LEVEL = 100;

export function outline(doc: Document): OutlineNode[] {
  const entries: { node: OutlineNode; index: number }[] = [];
  doc.elements.forEach((e, index) => {
    let node: OutlineNode | null = null;
    if (e.kind === "section") node = make("section", e.text, e.level, e.span);
    else if (e.kind === "sceneHeading") node = make("scene", e.sceneNumber ? `${e.text} #${e.sceneNumber.text}#` : e.text, SCENE_LEVEL, e.span);
    else if (e.kind === "heading") node = make("heading", e.text, e.level, e.span);
    if (node) entries.push({ node, index });
  });

  // Each entry runs until the next entry at the same or a higher level (a smaller number).
  for (let k = 0; k < entries.length; k++) {
    const { node } = entries[k]!;
    let endIndex = doc.elements.length;
    for (let m = k + 1; m < entries.length; m++) {
      if (entries[m]!.node.level <= node.level) {
        endIndex = entries[m]!.index;
        break;
      }
    }
    node.range = { start: node.selection.start, end: doc.elements[endIndex - 1]!.span.end };
  }

  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const { node } of entries) {
    while (stack.length && stack.at(-1)!.level >= node.level) stack.pop();
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push(node);
  }
  return roots;
}

function make(kind: OutlineNode["kind"], name: string, level: number, span: Span): OutlineNode {
  return { kind, name: name.trim() || "(untitled)", level, selection: span, range: span, children: [] };
}
