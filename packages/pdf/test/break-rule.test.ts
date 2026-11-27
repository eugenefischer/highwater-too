import { describe, expect, it } from "vitest";
import { parse } from "@highwater/parser";
import { defaultFontDir, layoutProse, PROSE_TEMPLATES } from "../src/index.ts";
import { breaksBefore, setMeasure, wrapRuns, CHAR_WIDTH_FOR_TESTS } from "./break-rule-support.ts";

/**
 * Every wrapper in the PDF engine (fixed-pitch scripts, measured fonts, the prose templates) breaks
 * a line by one rule (text.ts breaksBefore): at spaces, after a dash or hyphen run into the next
 * word, after "!" or "?" run into a letter. Each wrapper is checked on the same texts, where the
 * only places to break are after the separator.
 */
const words = Array.from({ length: 80 }, (_, i) => `Wor${String.fromCharCode(97 + (i % 26)).repeat(3)}`);
const SEPARATORS = ["!", "?", "-", "–", "—"];

describe("the shared line-break rule", () => {
  it("allows a break after a dash or ! ? run into a word, and nowhere else but spaces", () => {
    for (const sep of SEPARATORS) expect(breaksBefore(`ab${sep}cd`, 3, 0), sep).toBe(true);
    expect(breaksBefore("ab- cd", 3, 0)).toBe(false); // a space follows: the break is at the space
    expect(breaksBefore("ab--cd", 3, 0)).toBe(false); // inside a run of dashes
    expect(breaksBefore("-cd", 1, 0)).toBe(false); // the dash opens the line
    expect(breaksBefore("ab!.", 3, 0)).toBe(false); // "!" before punctuation
    expect(breaksBefore("ab.cd", 3, 0)).toBe(false);
    expect(breaksBefore("ab/cd", 3, 0)).toBe(false);
  });

  for (const sep of SEPARATORS) {
    const text = words.join(sep);
    const check = (lines: string[]) => {
      expect(lines.length, "it wraps").toBeGreaterThan(2);
      // Every line but the last ends just after a separator, and no word is split.
      for (const line of lines.slice(0, -1)) expect(line.endsWith(sep), JSON.stringify(line)).toBe(true);
      expect(lines.join("")).toBe(text);
    };

    it(`fixed-pitch scripts break after "${sep}"`, () => {
      check(wrapRuns([{ text, style: {} }], 40).map((l) => l.map((r) => r.text).join("")));
    });

    it(`measured fonts break after "${sep}"`, () => {
      const was = setMeasure((runs) => runs.reduce((w, r) => w + r.text.length * CHAR_WIDTH_FOR_TESTS, 0));
      try {
        check(wrapRuns([{ text, style: {} }], 40).map((l) => l.map((r) => r.text).join("")));
      } finally {
        setMeasure(was);
      }
    });

    for (const name of Object.keys(PROSE_TEMPLATES))
      it(`${name} breaks after "${sep}"`, () => {
        const layout = layoutProse(parse(`${text}\n`, { mode: "markdown" }), PROSE_TEMPLATES[name]!, { fontDir: defaultFontDir(), fontDirs: [] });
        const lines = layout.pages.flatMap((p) => p.items).map((t) => t.runs.map((r) => r.text).join(""));
        check(lines.filter((l) => l.includes("Wor")));
      });
  }
});
