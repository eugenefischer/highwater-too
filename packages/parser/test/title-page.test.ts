import { describe, expect, it } from "vitest";
import { fieldText, parse } from "../src/index.ts";
import { expectTiling } from "./helpers.ts";

// Shape of a real screenplay title page: opens with "Draft date", tab-indented continuations,
// and a tab-only line inside a value (the line that broke Better Fountain's parser).
const SAMPLE = [
  "Draft date: 2025-03-04",
  "Title:",
  "\tTHE LIGHTHOUSE",
  "\t",
  "\tPilot: “Low Tide”",
  "Credit: by",
  "Author: Jane Doe and John Roe",
  "Source:",
  "\tBased on the novel",
  "\t",
  "\t_The Lighthouse_",
  "",
  "{{HEADER: %p}}",
  "",
  "EXT. SCHOOLHOUSE - DAY",
].join("\n");

describe("title page", () => {
  it("reads every field, keeping blank continuation lines inside values", () => {
    const doc = parse(SAMPLE, { mode: "fountain" });
    const tp = doc.titlePage!;
    expect(tp.fields.map((f) => f.name)).toEqual(["draft date", "title", "credit", "author", "source"]);
    expect(fieldText(tp.fields[1]!)).toBe("THE LIGHTHOUSE\n\nPilot: “Low Tide”");
    expect(fieldText(tp.fields[4]!)).toBe("Based on the novel\n\n_The Lighthouse_");
    expect(fieldText(tp.fields[0]!)).toBe("2025-03-04");
    expectTiling(doc);
  });

  it("gives exact spans for keys and values", () => {
    const doc = parse(SAMPLE, { mode: "fountain" });
    const author = doc.titlePage!.fields[3]!;
    expect(SAMPLE.slice(author.keySpan.start, author.keySpan.end)).toBe("Author");
    const v = author.values[0]!;
    expect(SAMPLE.slice(v.span.start, v.span.end)).toBe("Jane Doe and John Roe");
  });

  it("ends at the first empty line; the body follows", () => {
    const doc = parse(SAMPLE, { mode: "fountain" });
    const after = doc.nodes.slice(doc.nodes.indexOf(doc.titlePage!) + 1);
    expect(after.map((n) => n.kind)).toEqual(["blank", "text", "blank", "text"]);
  });

  it("allows leading blank lines and Highland's position keys in Markdown", () => {
    const src = "\n\nTL:A. N. Writer\n\t1 Example Street\nTR:12,000 words\nCC:Small Hours\n\t\n\tby\n\nTheir first night…";
    const doc = parse(src, { mode: "markdown" });
    expect(doc.nodes[0]!.kind).toBe("blank");
    expect(doc.titlePage!.fields.map((f) => [f.name, fieldText(f)])).toEqual([
      ["tl", "A. N. Writer\n1 Example Street"],
      ["tr", "12,000 words"],
      ["cc", "Small Hours\n\nby"],
    ]);
    expectTiling(doc);
  });

  it("is absent when the document does not open with a known key", () => {
    expect(parse("INT. HOUSE - DAY\n\nTitle: not a title page", { mode: "fountain" }).titlePage).toBeNull();
    expect(parse("# Chapter One\n\nText", { mode: "markdown" }).titlePage).toBeNull();
    expect(parse("Note to self: buy milk", { mode: "markdown" }).titlePage).toBeNull();
  });

  it("accepts any key after a known first key", () => {
    const doc = parse("Title: X\nPhone: 555\n\nBody", { mode: "fountain" });
    expect(doc.titlePage!.fields.map((f) => f.name)).toEqual(["title", "phone"]);
  });
});
