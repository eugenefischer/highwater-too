import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { readBuilderValues, titlePageEdit, type BuilderValues } from "../src/syntax/title-builder.ts";

const apply = (src: string, e: { start: number; end: number; text: string }) => src.slice(0, e.start) + e.text + src.slice(e.end);
const empty: BuilderValues = { Title: "", Credit: "", "Author(s)": "", Source: "", "Contact info": "", "Draft date": "", Revision: "" };

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
