import { describe, expect, it } from "vitest";
import { fieldText, parse } from "../src/index.ts";
import { expectTiling } from "./helpers.ts";

// Shape of the Astounding title page: opens with "Draft date", tab-indented continuations,
// and a tab-only line inside a value (the line that broke Better Fountain's parser).
const ASTOUNDING = [
  "Draft date: 2024-02-19",
  "Title:",
  "\tASTOUNDING",
  "\t",
  "\tPilot: “Who Goes There?”",
  "Credit: by",
  "Author: Eugene Fischer and Alec Nevala-Lee",
  "Source:",
  "\tBased on the book",
  "\t",
  "\t_Astounding_",
  "",
  "{{HEADER: %p}}",
  "",
  "EXT. SCHOOLHOUSE - DAY",
].join("\n");

describe("title page", () => {
  it("reads every field, keeping blank continuation lines inside values", () => {
    const doc = parse(ASTOUNDING, { mode: "fountain" });
    const tp = doc.titlePage!;
    expect(tp.fields.map((f) => f.name)).toEqual(["draft date", "title", "credit", "author", "source"]);
    expect(fieldText(tp.fields[1]!)).toBe("ASTOUNDING\n\nPilot: “Who Goes There?”");
    expect(fieldText(tp.fields[4]!)).toBe("Based on the book\n\n_Astounding_");
    expect(fieldText(tp.fields[0]!)).toBe("2024-02-19");
    expectTiling(doc);
  });

  it("gives exact spans for keys and values", () => {
    const doc = parse(ASTOUNDING, { mode: "fountain" });
    const author = doc.titlePage!.fields[3]!;
    expect(ASTOUNDING.slice(author.keySpan.start, author.keySpan.end)).toBe("Author");
    const v = author.values[0]!;
    expect(ASTOUNDING.slice(v.span.start, v.span.end)).toBe("Eugene Fischer and Alec Nevala-Lee");
  });

  it("ends at the first empty line; the body follows", () => {
    const doc = parse(ASTOUNDING, { mode: "fountain" });
    const after = doc.nodes.slice(doc.nodes.indexOf(doc.titlePage!) + 1);
    expect(after.map((n) => n.kind)).toEqual(["blank", "text", "blank", "text"]);
  });

  it("allows leading blank lines and Highland's position keys in Markdown", () => {
    const src = "\n\nTL:E. J. Fischer\n\t1 Example Street\nTR:14,800 words\nCC:Sweet Betty\n\t\n\tby\n\nHer final film…";
    const doc = parse(src, { mode: "markdown" });
    expect(doc.nodes[0]!.kind).toBe("blank");
    expect(doc.titlePage!.fields.map((f) => [f.name, fieldText(f)])).toEqual([
      ["tl", "E. J. Fischer\n1 Example Street"],
      ["tr", "14,800 words"],
      ["cc", "Sweet Betty\n\nby"],
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
