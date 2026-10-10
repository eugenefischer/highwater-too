import { describe, expect, it } from "vitest";
import { formatTimestamp, parse, parseDirective, seriesCounter, type Directive } from "../src/index.ts";

const P = { kind: "page" } as const;
const PP = { kind: "pageCount" } as const;
const S = { kind: "section" } as const;
const T = (text: string) => ({ kind: "text", text }) as const;

describe("header and footer", () => {
  it("uses the default slot for one segment: headers right, footers centred", () => {
    expect(parseDirective("{{HEADER: %p}}")).toEqual({ kind: "header", off: false, slots: { left: null, center: null, right: [P] } });
    expect(parseDirective("{{FOOTER: hi there}}")).toEqual({ kind: "footer", off: false, slots: { left: null, center: [T("hi there")], right: null } });
  });

  it("splits pipe segments into left, centre and right", () => {
    expect(parseDirective("{{HEADER: %# | %p}}")).toMatchObject({ slots: { left: [S], center: null, right: [P] } });
    expect(parseDirective("{{FOOTER: Left | Centre | Right}}")).toMatchObject({ slots: { left: [T("Left")], center: [T("Centre")], right: [T("Right")] } });
    expect(parseDirective("{{HEADER: Title | }}")).toMatchObject({ slots: { left: [T("Title")], center: null, right: null } });
    expect(parseDirective("{{HEADER: | Title |}}")).toMatchObject({ slots: { left: null, center: [T("Title")], right: null } });
  });

  it("reads page tokens inside text, %pp before %p", () => {
    expect(parseDirective("{{HEADER:|Claude / Manuscript Edge Cases / %p of %pp}}")).toMatchObject({
      slots: { left: null, right: [T("Claude / Manuscript Edge Cases / "), P, T(" of "), PP] },
    });
  });

  it("turns off with %none", () => {
    expect(parseDirective("{{FOOTER: %none}}")).toEqual({ kind: "footer", off: true, slots: { left: null, center: null, right: null } });
  });
});

describe("other directives", () => {
  it("reads page numbers, includes, timestamps, tables of contents and markers", () => {
    expect(parseDirective("{{PAGENUMBER: 10}}")).toEqual({ kind: "pageNumber", value: 10 });
    expect(parseDirective("{{PAGENUMBER: ten}}")).toEqual({ kind: "pageNumber", value: null });
    expect(parseDirective("{{INCLUDE: Scenes/Act 1.fountain}}")).toEqual({ kind: "include", path: "Scenes/Act 1.fountain" });
    expect(parseDirective("{{TIMESTAMP}}")).toEqual({ kind: "timestamp", format: null });
    expect(parseDirective("{{TOC}}")).toEqual({ kind: "toc", levels: null });
    expect(parseDirective("{{TOC: # ###}}")).toEqual({ kind: "toc", levels: [1, 3] });
    expect(parseDirective("{{%m:check this}}")).toEqual({ kind: "marker", label: "check this" });
  });

  it("is case-insensitive and keeps unknown directives", () => {
    expect(parseDirective("{{header: %p}}").kind).toBe("header");
    expect(parseDirective("{{WIDGET: x}}")).toEqual({ kind: "other", name: "WIDGET", value: "x" });
    expect(parseDirective("{{WIDGET}}")).toEqual({ kind: "other", name: "WIDGET", value: null });
  });

  it("formats timestamps as Highland prints them", () => {
    expect(formatTimestamp(new Date(2026, 8, 28))).toBe("Sep 28, 2026");
  });
});

describe("series", () => {
  const series = (text: string) => parseDirective(text) as Extract<Directive, { kind: "series" }>;

  it("keeps one counter: a number sets it, a name is ignored (as Highland 2 printed)", () => {
    const next = seriesCounter();
    expect(["{{SERIES}}", "{{SERIES: test}}", "{{SERIES}}", "{{SERIES: 5}}", "{{SERIES}}"].map((t) => next(series(t)))).toEqual([1, 2, 3, 5, 6]);
  });

  it("keeps a non-numeric value as a label", () => {
    expect(series("{{SERIES: test}}")).toEqual({ kind: "series", start: null, label: "test" });
    expect(series("{{SERIES: 5}}")).toEqual({ kind: "series", start: 5, label: null });
  });
});

describe("directives in documents", () => {
  it("lists directive lines and inline directives in source order with spans", () => {
    const src = "{{HEADER: %p}} {{FOOTER: x}}\n\n# Chapter {{SERIES}}\n\nIt was {{TIMESTAMP}}.\n";
    const doc = parse(src, { mode: "markdown" });
    expect(doc.directives.map((d) => [d.directive.kind, d.inline, src.slice(d.span.start, d.span.end)])).toEqual([
      ["header", false, "{{HEADER: %p}}"],
      ["footer", false, "{{FOOTER: x}}"],
      ["series", true, "{{SERIES}}"],
      ["timestamp", true, "{{TIMESTAMP}}"],
    ]);
  });

  it("works in Fountain, including dialogue", () => {
    const doc = parse("{{HEADER: %# | %p}}\n\nBOB\nIt's {{TIMESTAMP}}.\n", { mode: "fountain" });
    expect(doc.directives.map((d) => d.directive.kind)).toEqual(["header", "timestamp"]);
  });

  it("warns about a bad page number and an inline include", () => {
    const doc = parse("{{PAGENUMBER: x}}\n\nSee {{INCLUDE: a.md}}\n", { mode: "markdown" });
    expect(doc.diagnostics.map((d) => d.message)).toEqual(["PAGENUMBER needs a whole number, e.g. {{PAGENUMBER: 10}}", "INCLUDE only works on a line of its own"]);
  });

  it("finds the generated manuscript's directives", async () => {
    const { readFileSync } = await import("node:fs");
    const { HighlandBundle } = await import("@highwater/bundle");
    const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(new URL("../../../fixtures/generated/ManuscriptEdgeCases.highland", import.meta.url)))).text;
    const doc = parse(text, { mode: "markdown" });
    expect(doc.directives.map((d) => d.directive.kind)).toEqual(["header", "footer", "toc", "series", "series", "pageNumber", "series"]);
    const next = seriesCounter();
    expect(doc.directives.flatMap((d) => (d.directive.kind === "series" ? [next(d.directive)] : []))).toEqual([1, 2, 3]);
  });
});
