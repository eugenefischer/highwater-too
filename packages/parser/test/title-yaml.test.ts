import { describe, expect, it } from "vitest";
import { fieldText, parse, yamlEntries, yamlScalar, unquote } from "../src/index.ts";

const fields = (src: string) => parse(src, { mode: "markdown" }).titlePage?.fields.map((f) => [f.name, f.values.map((v) => v.text)]);

describe("title pages in YAML front matter", () => {
  const src = [
    "---",
    "title: The Enrichment and Decay of Ionia",
    'author: [Eugene Fischer, "A. N. Other"]',
    "contact: |",
    "  Eugene Fischer",
    "  you@example.com",
    "",
    "  Agent: Someone",
    'draft_date: "2026-11-23"',
    "tags: [sf, novella]",
    "tr: About 12,000 words # the count",
    "notes: >",
    "  Folded",
    "  into one.",
    "Copyright: 2026",
    "---",
    "",
    "Title: Not a title page",
    "",
    "# Chapter",
    "",
    "Text.",
    "",
  ].join("\n");

  it("reads Highland's fields from their lower-case keys, as YAML values", () => {
    expect(fields(src)).toEqual([
      ["title", ["The Enrichment and Decay of Ionia"]],
      ["author", ["Eugene Fischer", "A. N. Other"]],
      ["contact", ["Eugene Fischer", "you@example.com", "", "Agent: Someone"]],
      ["draft date", ["2026-11-23"]],
      ["tr", ["About 12,000 words"]],
      ["notes", ["Folded into one."]],
      ["copyright", ["2026"]],
    ]);
    const doc = parse(src, { mode: "markdown" });
    expect(doc.titlePage?.yaml).toBe(true);
    expect(doc.titlePage?.span).toEqual(doc.frontMatter);
    expect(fieldText(doc.titlePage!.fields[2]!)).toBe("Eugene Fischer\nyou@example.com\n\nAgent: Someone");
  });

  it("points each value at its text in the source", () => {
    const doc = parse(src, { mode: "markdown" });
    for (const f of doc.titlePage!.fields)
      for (const v of f.values) if (!["notes", "draft date", "author"].includes(f.name)) expect(src.slice(v.span.start, v.span.end), f.name).toBe(v.text);
    expect(src.slice(doc.titlePage!.fields[0]!.keySpan.start, doc.titlePage!.fields[0]!.keySpan.end)).toBe("title");
  });

  it("leaves lines like Highland's in the text when YAML holds the title page", () => {
    const doc = parse(src, { mode: "markdown" });
    expect(doc.elements[0]).toMatchObject({ kind: "paragraph" });
    expect(src.slice(doc.elements[0]!.span.start, doc.elements[0]!.span.end)).toBe("Title: Not a title page");
  });

  it("reads Highland's title page when the front matter has no title-page keys", () => {
    const doc = parse("---\ntags: [sf]\n---\n\nTitle: A Story\nAuthor: Someone\n\nText.\n", { mode: "markdown" });
    expect(doc.titlePage?.yaml).toBeUndefined();
    expect(doc.titlePage?.fields.map((f) => f.name)).toEqual(["title", "author"]);
  });

  it("is a manuscript's alone: a screenplay's YAML-looking lines are not front matter", () => {
    expect(parse("---\ntitle: A\n---\n\nINT. HALL - DAY\n", { mode: "fountain" }).titlePage).toBeNull();
  });
});

describe("the little YAML a title page needs", () => {
  it("reads quoted scalars, comments, lists of items, and keeps nested lines", () => {
    const src = "---\na: 'it''s'\nb: \"say \\\"hi\\\"\"\n# a comment\nc:\n  - one\n  - 'two'\nd:\n  nested: x\n---\n";
    const inner = { start: 4, end: src.lastIndexOf("---") };
    expect(yamlEntries(src, inner).map((e) => [e.key, e.values.map((v) => v.text)])).toEqual([
      ["a", ["it's"]],
      ["b", ['say "hi"']],
      ["c", ["one", "two"]],
      ["d", ["nested: x"]],
    ]);
  });

  it("writes a scalar plain when that reads back the same, quoted otherwise", () => {
    for (const s of ["The Title", "About 12,000 words", "*Italic* title", "2026-11-23", "yes", "a: b", "a #b", "- dash", '"quoted"', "it's", ""]) expect(unquote(yamlScalar(s)), s).toBe(s);
    expect(yamlScalar("The Title")).toBe("The Title");
    expect(yamlScalar("2026-11-23")).toBe('"2026-11-23"');
    expect(yamlScalar("*Italic* title")).toBe('"*Italic* title"');
  });
});
