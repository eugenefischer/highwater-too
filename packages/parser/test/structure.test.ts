import { describe, expect, it } from "vitest";
import { modeFromFileName, parse, splitLines } from "../src/index.ts";
import { allFixtures, expectTiling } from "./helpers.ts";

describe("every fixture", () => {
  for (const f of allFixtures()) {
    it(`tiles the source exactly: ${f.name}`, () => {
      expectTiling(parse(f.text, { mode: f.mode }));
    });
  }
});

describe("splitLines", () => {
  it("accepts LF, CRLF and CR, keeping terminators in the line span", () => {
    const src = "a\nb\r\nc\rd";
    const lines = splitLines(src);
    expect(lines.map((l) => src.slice(l.content.start, l.content.end))).toEqual(["a", "b", "c", "d"]);
    expect(lines.map((l) => src.slice(l.span.start, l.span.end))).toEqual(["a\n", "b\r\n", "c\r", "d"]);
  });
});

describe("line structure", () => {
  it("groups blank runs and text runs", () => {
    const doc = parse("INT. HOUSE - DAY\n\nShe waits.\nStill waiting.\n", { mode: "fountain" });
    expect(doc.nodes.map((n) => n.kind)).toEqual(["text", "blank", "text"]);
    expectTiling(doc);
  });

  it("treats a line of two spaces as text, not blank (Fountain's in-dialogue empty line)", () => {
    const doc = parse("BOB\nOne.\n  \nTwo.", { mode: "fountain" });
    expect(doc.nodes.map((n) => n.kind)).toEqual(["text"]);
  });

  it("handles a source with no trailing newline and an empty source", () => {
    expectTiling(parse("Just one line", { mode: "plain" }));
    const empty = parse("", { mode: "plain" });
    expectTiling(empty);
    expect(empty.nodes).toHaveLength(1);
  });

  it("keeps UTF-16 offsets usable with String.slice (accents, emoji)", () => {
    const src = "Ña 🎬 don’t\n\nnext";
    const doc = parse(src, { mode: "fountain" });
    const text = doc.nodes.find((n) => n.kind === "text")!;
    expect(src.slice(text.span.start, text.span.end)).toBe("Ña 🎬 don’t\n");
  });
});

describe("modeFromFileName", () => {
  it("decides from the extension only", () => {
    expect(modeFromFileName("text.fountain")).toBe("fountain");
    expect(modeFromFileName("text.md")).toBe("markdown");
    expect(modeFromFileName("Draft.MARKDOWN")).toBe("markdown");
    expect(modeFromFileName("text.txt")).toBe("plain");
  });
});
