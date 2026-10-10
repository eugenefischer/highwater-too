import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { parse, type Mode } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { highlightRanges, TOKEN_TYPES, type TokenType } from "../src/syntax/highlight.ts";
import { outline, type OutlineNode } from "../src/syntax/structure.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

/** The type painted at the first occurrence of `needle` (after `from`). */
function typeAt(src: string, mode: Mode, needle: string, from = 0): TokenType | null {
  const at = src.indexOf(needle, from);
  if (at < 0) throw new Error(`not found: ${needle}`);
  return highlightRanges(parse(src, { mode })).find((r) => r.start <= at && at < r.end)?.type ?? null;
}

const names = (nodes: OutlineNode[]): unknown[] => nodes.map((n) => (n.children.length ? [n.name, names(n.children)] : n.name));

describe("highlighting", () => {
  it("marks screenplay elements", () => {
    const src = "Title: Test\n\nINT. HOUSE - DAY #12#\n\nBOB (V.O.)\n(quietly)\nHello *there*.\n\nCUT TO:\n\n# Act One\n\n= The setup\n\n> THE END <";
    expect(typeAt(src, "fountain", "Title")).toBe("titleKey");
    expect(typeAt(src, "fountain", "Test")).toBe("titleValue");
    expect(typeAt(src, "fountain", "INT.")).toBe("sceneHeading");
    expect(typeAt(src, "fountain", "#12#")).toBe("sceneNumber");
    expect(typeAt(src, "fountain", "BOB")).toBe("character");
    expect(typeAt(src, "fountain", "(quietly)")).toBe("parenthetical");
    expect(typeAt(src, "fountain", "Hello")).toBeNull();
    expect(typeAt(src, "fountain", "*there")).toBe("markup");
    expect(typeAt(src, "fountain", "there")).toBe("italic");
    expect(typeAt(src, "fountain", "CUT TO")).toBe("transition");
    expect(typeAt(src, "fountain", "# Act")).toBe("markup");
    expect(typeAt(src, "fountain", "Act One")).toBe("section");
    expect(typeAt(src, "fountain", "The setup")).toBe("synopsis");
    expect(typeAt(src, "fountain", "> THE")).toBe("markup");
    expect(typeAt(src, "fountain", "THE END")).toBe("centered");
  });

  it("marks notes, directives, revision tags and boneyards over everything else", () => {
    const src = "{{HEADER: %p}}\n\nShe [[check this]] runs {{REVISION: #ff0000}}home{{/REVISION}}.\n\n/* gone\n\nINT. NOT A SCENE */";
    expect(typeAt(src, "fountain", "{{HEADER")).toBe("directive");
    expect(typeAt(src, "fountain", "check this")).toBe("note");
    expect(typeAt(src, "fountain", "{{REVISION")).toBe("revisionTag");
    expect(typeAt(src, "fountain", "home")).toBeNull();
    expect(typeAt(src, "fountain", "INT. NOT")).toBe("boneyard");
  });

  it("marks manuscript elements", () => {
    const src = "# Chapter {{SERIES}}\n\nSome **bold** and +highlighted+ text.\n\n> A quote\n\n* * *\n\n- item\n\nTerm :: Definition\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[Highland]: https://highland2.app";
    expect(typeAt(src, "markdown", "Chapter")).toBe("heading");
    expect(typeAt(src, "markdown", "{{SERIES")).toBe("directive");
    expect(typeAt(src, "markdown", "bold")).toBe("bold");
    expect(typeAt(src, "markdown", "highlighted")).toBe("highlight");
    expect(typeAt(src, "markdown", "> A")).toBe("markup");
    expect(typeAt(src, "markdown", "A quote")).toBe("quote");
    expect(typeAt(src, "markdown", "* * *")).toBe("pageBreak");
    expect(typeAt(src, "markdown", "- item")).toBe("listMarker");
    expect(typeAt(src, "markdown", "Term")).toBe("term");
    expect(typeAt(src, "markdown", "::")).toBe("markup");
    expect(typeAt(src, "markdown", "A |")).toBe("tableHeader");
    expect(typeAt(src, "markdown", "[Highland]:")).toBe("linkDefinition");
  });

  const samples: [string, string][] = [
    ["ScreenplayEdgeCases", join(generated, "ScreenplayEdgeCases.highland")],
    ["ManuscriptEdgeCases", join(generated, "ManuscriptEdgeCases.highland")],
    ...(priv ? readdirSync(join(priv, "Files with exports")).filter((f) => f.endsWith(".highland")).map((f): [string, string] => [f, join(priv, "Files with exports", f)]) : []),
  ];
  it.each(samples)("gives %s ordered, non-overlapping ranges with known types", (_name, path) => {
    const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(path)));
    const ranges = highlightRanges(parse(bundle.text, { mode: bundle.mode }));
    expect(ranges.length).toBeGreaterThan(10);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      expect(r.end).toBeGreaterThan(r.start);
      expect(TOKEN_TYPES).toContain(r.type);
      if (i > 0) expect(r.start).toBeGreaterThanOrEqual(ranges[i - 1]!.end);
    }
    expect(ranges.at(-1)!.end).toBeLessThanOrEqual(bundle.text.length);
  });
});

describe("outline", () => {
  it("nests scenes under sections and closes a section at the next one of the same level", () => {
    const src = "# Act One\n\n## Sequence A\n\nINT. A - DAY\n\nAction.\n\nEXT. B - NIGHT\n\n# Act Two\n\nINT. C - DAY\n\nMore.";
    const tree = outline(parse(src, { mode: "fountain" }));
    expect(names(tree)).toEqual([["Act One", [["Sequence A", ["INT. A - DAY", "EXT. B - NIGHT"]]]], ["Act Two", ["INT. C - DAY"]]]);
    const a = tree[0]!.children[0]!.children[0]!;
    expect(src.slice(a.range.start, a.range.end)).toBe("INT. A - DAY\n\nAction.");
    expect(src.slice(tree[1]!.range.start, tree[1]!.range.end)).toBe("# Act Two\n\nINT. C - DAY\n\nMore.");
  });

  it("nests Markdown headings by level", () => {
    const tree = outline(parse("# One\n\nText.\n\n### Deep\n\n## Two\n\n# Three", { mode: "markdown" }));
    expect(names(tree)).toEqual([["One", ["Deep", "Two"]], "Three"]);
  });

  it("lists every scene of the generated screenplay", () => {
    const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(join(generated, "ScreenplayEdgeCases.highland"))));
    const doc = parse(bundle.text, { mode: "fountain" });
    const all: OutlineNode[] = [];
    const walk = (ns: OutlineNode[]) => ns.forEach((n) => (all.push(n), walk(n.children)));
    walk(outline(doc));
    expect(all.filter((n) => n.kind === "scene")).toHaveLength(doc.elements.filter((e) => e.kind === "sceneHeading").length);
  });
});
