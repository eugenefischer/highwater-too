import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { paragraphNumbers } from "../src/highland-editor/line-styles.ts";

const numbered = (src: string) => {
  const nums = paragraphNumbers(parse(src, { mode: "fountain" }));
  return [...nums].map(([at, n]) => `${n} ${src.slice(at, src.indexOf("\n", at) < 0 ? undefined : src.indexOf("\n", at))}`);
};

describe("Highland 2's paragraph numbers", () => {
  it("numbers each line with text, as in EJ's screenshots of Highland", () => {
    const src = [
      "Title: Astounding",
      "Author: Someone",
      "",
      "{{HEADER: %p}}",
      "",
      "INT. AUTO DEALERSHIP - DAY",
      "",
      "= campbell gets sick",
      "",
      "[[notes]]",
      "",
      "/* comments */",
      "",
      "# Section",
      "",
      "===",
      "",
      "{{Header: }}",
      "",
      "Campbell sits at a desk.",
      "",
      "BOSS",
      "(quietly)",
      "John, a quick word?",
      "",
      "{{%m: fix}}",
      "",
      "He nods.[[inline note]]",
      "",
    ].join("\n");
    expect(numbered(src)).toEqual([
      "1 INT. AUTO DEALERSHIP - DAY",
      "2 = campbell gets sick",
      "3 # Section",
      "4 ===",
      "5 Campbell sits at a desk.",
      "6 BOSS",
      "7 (quietly)",
      "8 John, a quick word?",
      "9 He nods.[[inline note]]",
    ]);
  });

  it("skips every line of omitted text that spans lines", () => {
    expect(numbered("One.\n\n/* gone\nstill gone */\n\nTwo.\n")).toEqual(["1 One.", "2 Two."]);
  });
});
