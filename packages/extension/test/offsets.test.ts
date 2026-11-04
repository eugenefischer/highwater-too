import { describe, expect, it } from "vitest";
import { lineAndCharacter, offsetOf, pageForm } from "../src/highland-editor/offsets.ts";

describe("Highland-Style Editor offsets in files with \\r\\n line breaks", () => {
  const doc = "INT. HALL - DAY\r\n\r\nCAMPBELL\r\nHello.\r\n";
  const page = pageForm(doc);

  it("holds the text with \\n line breaks", () => {
    expect(page).toBe("INT. HALL - DAY\n\nCAMPBELL\nHello.\n");
    expect(pageForm("a\nb")).toBe("a\nb");
  });

  it("converts through line and character", () => {
    const hello = page.indexOf("Hello");
    expect(lineAndCharacter(page, hello)).toEqual({ line: 3, character: 0 });
    expect(offsetOf(page, 3, 0)).toBe(hello);
    // The same place in the document is three characters later (three \r before it).
    expect(doc.indexOf("Hello")).toBe(hello + 3);
    expect(lineAndCharacter(page, 0)).toEqual({ line: 0, character: 0 });
    expect(lineAndCharacter(page, page.length)).toEqual({ line: 4, character: 0 });
  });

  it("clamps to the line and the text", () => {
    expect(offsetOf(page, 0, 99)).toBe(15);
    expect(offsetOf(page, 99, 0)).toBe(page.length);
  });
});
