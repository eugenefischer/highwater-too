import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { readBuilderValues, titlePageEdit } from "../src/syntax/title-builder.ts";
import { toHighlandTitlePage, toYamlTitlePage } from "../src/syntax/title-form.ts";

const md = (text: string) => parse(text, { mode: "markdown" });
const apply = (text: string, e: { start: number; end: number; text: string } | null) => (e ? text.slice(0, e.start) + e.text + text.slice(e.end) : text);
const toYaml = (text: string) => apply(text, toYamlTitlePage(md(text)));
const toHighland = (text: string) => apply(text, toHighlandTitlePage(md(text)));

const HIGHLAND = "Title: The Enrichment and Decay of Ionia\nAuthor: Eugene Fischer\nContact:\n\tEugene Fischer\n\tyou@example.com\n\t\n\tAgent: Someone\nDraft date: 2026-11-23\nTR: About 12,000 words\n\n# Chapter\n\nText.\n";
const YAML = '---\ntitle: The Enrichment and Decay of Ionia\nauthor: Eugene Fischer\ncontact: |\n  Eugene Fischer\n  you@example.com\n\n  Agent: Someone\ndraft_date: "2026-11-23"\ntr: About 12,000 words\n---\n\n# Chapter\n\nText.\n';

describe("converting a manuscript's title page", () => {
  it("writes Highland's fields as YAML front matter, field for field", () => {
    expect(toYaml(HIGHLAND)).toBe(YAML);
  });

  it("writes a YAML title page as Highland's lines, field for field", () => {
    expect(toHighland(YAML)).toBe(HIGHLAND);
  });

  it("round-trips both ways, and both forms read as the same title page", () => {
    expect(toHighland(toYaml(HIGHLAND))).toBe(HIGHLAND);
    expect(toYaml(toHighland(YAML))).toBe(YAML);
    const strip = (t: string) => md(t).titlePage!.fields.map((f) => [f.name, f.values.map((v) => v.text).filter((v, i, a) => !(i === 0 && v === "" && a.length > 1))]);
    expect(strip(YAML)).toEqual(strip(HIGHLAND));
    expect(md(toYaml(HIGHLAND)).elements.map((e) => e.kind)).toEqual(md(HIGHLAND).elements.map((e) => e.kind));
  });

  it("keeps the front matter's other keys and comments, in both directions", () => {
    const withTags = "---\ntags: [sf]\n# kept\n---\n\nTitle: A Story\nCC: Centred\n\nText.\n";
    const yaml = toYaml(withTags);
    expect(yaml).toBe("---\ntags: [sf]\n# kept\ntitle: A Story\ncc: Centred\n---\n\nText.\n");
    expect(toHighland(yaml)).toBe(withTags);
  });

  it("does nothing when there is no title page, or it is in that form already", () => {
    expect(toYamlTitlePage(md("Text.\n"))).toBeNull();
    expect(toYamlTitlePage(md(YAML))).toBeNull();
    expect(toHighlandTitlePage(md(HIGHLAND))).toBeNull();
  });

  it("keeps a byte-order mark at the start, in both directions, and reads the title page after it", () => {
    expect(toHighland(`\ufeff${YAML}`)).toBe(`\ufeff${HIGHLAND}`);
    expect(toYaml(`\ufeff${HIGHLAND}`)).toBe(`\ufeff${YAML}`);
  });

  it("keeps every line of a YAML value that goes on over several lines", () => {
    const folded = "---\ntitle: The Enrichment and\n  Decay of Ionia\nauthor: Eugene Fischer\n---\n\nText.\n";
    expect(toHighland(folded)).toBe("Title: The Enrichment and Decay of Ionia\nAuthor: Eugene Fischer\n\nText.\n");
  });
});

describe("the Title Page Builder and YAML", () => {
  const values = { Title: "A Story", Credit: "by", "Author(s)": "Someone", Source: "", "Contact info": "Line one\nLine two", "Draft date": "", Revision: "" };

  it("reads a YAML title page", () => {
    expect(readBuilderValues(md(YAML))).toMatchObject({ Title: "The Enrichment and Decay of Ionia", "Author(s)": "Eugene Fischer", "Contact info": "Eugene Fischer\nyou@example.com\n\nAgent: Someone", "Draft date": "2026-11-23" });
  });

  it("writes a YAML title page back as YAML, keeping the fields it doesn't show", () => {
    expect(apply(YAML, titlePageEdit(md(YAML), values))).toBe("---\ntitle: A Story\ncredit: by\nauthor: Someone\ncontact: |\n  Line one\n  Line two\ntr: About 12,000 words\n---\n\n# Chapter\n\nText.\n");
  });

  it("gives a plain .md manuscript without a title page YAML, and others Highland's form", () => {
    expect(apply("Text.\n", titlePageEdit(md("Text.\n"), values, true))).toBe("---\ntitle: A Story\ncredit: by\nauthor: Someone\ncontact: |\n  Line one\n  Line two\n---\n\nText.\n");
    expect(apply("Text.\n", titlePageEdit(md("Text.\n"), values))).toBe("Title: A Story\nCredit: by\nAuthor: Someone\nContact:\n\tLine one\n\tLine two\n\nText.\n");
  });
});
