import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { liveMargins } from "../src/syntax/margins.ts";
import { readBuilderValues, titlePageEdit, type BuilderValues } from "../src/syntax/title-builder.ts";

const apply = (src: string, e: { start: number; end: number; text: string }) => src.slice(0, e.start) + e.text + src.slice(e.end);
const empty: BuilderValues = { Title: "", Credit: "", "Author(s)": "", Source: "", "Contact info": "", "Draft date": "", Revision: "" };

describe("live margins", () => {
  it("indents cues, parentheticals and dialogue, and right-aligns transitions", () => {
    const src = "INT. HOUSE - DAY\n\nBOB\n(quietly)\nHello.\n\nCUT TO:";
    const m = liveMargins(parse(src, { mode: "fountain" }));
    const at = (s: string) => m.find((x) => x.at === src.indexOf(s))?.indent;
    expect([at("BOB"), at("(quietly)"), at("Hello."), at("CUT TO:")]).toEqual([21, 15, 11, 56]);
    expect(at("INT.")).toBeUndefined();
  });

  it("leaves manuscript paragraphs alone (as Highland's editor), indents quotes and centres scene breaks", () => {
    const src = "One.\n\nTwo.\n\n> A quote.\n\n* * *\n\nThree.";
    const m = liveMargins(parse(src, { mode: "markdown" }));
    expect(m).toEqual([
      { at: src.indexOf("> A quote"), indent: 3 },
      { at: src.indexOf("* * *"), indent: 30 },
    ]);
  });
});

describe("title page builder", () => {
  it("reads and writes a title page, keeping fields the builder does not show", () => {
    const src = "Title: Old\nNotes: keep me\nAuthor: Claude\n\nINT. HOUSE - DAY";
    const doc = parse(src, { mode: "fountain" });
    expect(readBuilderValues(doc)).toEqual({ ...empty, Title: "Old", "Author(s)": "Claude" });
    const out = apply(src, titlePageEdit(doc, { ...empty, Title: "New", Credit: "Written by", "Author(s)": "Claude", "Contact info": "Line one\nLine two" }));
    expect(out).toBe("Title: New\nCredit: Written by\nAuthor: Claude\nContact:\n\tLine one\n\tLine two\nNotes: keep me\n\nINT. HOUSE - DAY");
  });

  it("adds a title page to a script without one, and removes it when cleared", () => {
    const src = "INT. HOUSE - DAY";
    const added = apply(src, titlePageEdit(parse(src, { mode: "fountain" }), { ...empty, Title: "T" }));
    expect(added).toBe("Title: T\n\nINT. HOUSE - DAY");
    expect(apply(added, titlePageEdit(parse(added, { mode: "fountain" }), empty))).toBe("INT. HOUSE - DAY");
  });
});

describe("Live Margins lyrics", () => {
  it("indents a lyric to the dialogue column, as Highland shows it", () => {
    const src = "INT. A - DAY\n\n~A lyric line.\n";
    expect(liveMargins(parse(src, { mode: "fountain" }))).toEqual([{ at: src.indexOf("~"), indent: 11 }]);
  });
});
