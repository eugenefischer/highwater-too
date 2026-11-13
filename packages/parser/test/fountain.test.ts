import { describe, expect, it } from "vitest";
import type { Dialogue, Element } from "../src/index.ts";
import { parse } from "../src/index.ts";

const els = (src: string) => parse(src, { mode: "fountain" }).elements;
const kinds = (src: string) => els(src).map((e) => e.kind);
const only = <K extends Element["kind"]>(src: string, kind: K) => els(src).find((e) => e.kind === kind) as Extract<Element, { kind: K }>;

describe("scene headings", () => {
  it("recognises INT., EXT., EST., INT./EXT. and I/E", () => {
    for (const h of ["INT. HOUSE - DAY", "EXT. MOON - NIGHT", "EST. CITY", "INT./EXT. CAR - DAY", "I/E CAR - DAY", "int. lowercase - day"]) {
      expect(kinds(h)).toEqual(["sceneHeading"]);
    }
  });

  it("forces with a leading period, but not with an ellipsis", () => {
    expect(only(".CLOSE ON BOB", "sceneHeading")).toMatchObject({ text: "CLOSE ON BOB", forced: true });
    expect(kinds("...and then")).toEqual(["action"]);
  });

  it("splits off the scene number with its exact span", () => {
    const src = "INT. ROOM - DAY #1A#";
    const h = only(src, "sceneHeading");
    expect(h.text).toBe("INT. ROOM - DAY");
    expect(h.sceneNumber!.text).toBe("1A");
    expect(src.slice(h.sceneNumber!.span.start, h.sceneNumber!.span.end)).toBe("#1A#");
  });

  it("needs to start a block (or follow a one-line element)", () => {
    expect(kinds("She walks in.\nINT. is short for interior.")).toEqual(["action"]);
    expect(kinds(">CUT TO:\nINT. MEETING HALL - NIGHT")).toEqual(["transition", "sceneHeading"]);
  });
});

describe("dialogue", () => {
  it("reads cue, parenthetical and lines", () => {
    const d = only("ALICE\n(shocked)\nNo you don’t.", "dialogue");
    expect(d).toMatchObject({ character: "ALICE", extensions: [], dual: null, forced: false });
    expect(d.parts.map((p) => p.kind)).toEqual(["parenthetical", "line"]);
  });

  it("keeps extensions, including mixed-case ones", () => {
    expect(only("MARLOWE (CONT’D)\nGo on.", "dialogue")).toMatchObject({ character: "MARLOWE", extensions: ["(CONT’D)"] });
    expect(only("EAGER FAN (O.S.) (cont'd)\nWhere?", "dialogue").extensions).toEqual(["(O.S.)", "(cont'd)"]);
  });

  it("accepts a forced cue with lowercase letters", () => {
    expect(only("@McCLANE\nYippee.", "dialogue")).toMatchObject({ character: "McCLANE", forced: true });
  });

  it("treats a lone uppercase line, or one followed only by a parenthetical, as action", () => {
    expect(kinds("BOOM!")).toEqual(["action"]);
    expect(kinds("BOB\n(beat)")).toEqual(["action"]);
  });

  it("does not take mixed-case lines as cues", () => {
    expect(kinds("YOUNG PETER J. MARLOWE rushes home.\nHe drops his bag.")).toEqual(["action"]);
  });

  it("keeps two-space lines and lyrics inside dialogue", () => {
    const d = only("ROCK\nLine one.\n  \n~Ba ba black sheep", "dialogue");
    expect(d.parts.map((p) => p.kind)).toEqual(["line", "empty", "lyric"]);
  });

  it("pairs dual dialogue: the ^ cue and the block before it", () => {
    const pair = els("BOB\nYes I do\n\nALICE^\nNo you don’t").filter((e): e is Dialogue => e.kind === "dialogue");
    expect(pair.map((d) => [d.character, d.dual])).toEqual([["BOB", "left"], ["ALICE", "right"]]);
  });

  it("drops a ^ with no dialogue before it", () => {
    expect(only("She waits.\n\nALICE^\nHello?", "dialogue").dual).toBeNull();
  });
});

describe("one-line elements", () => {
  it("classifies transitions, forced transitions, centred and right-aligned text", () => {
    expect(only("CUT TO:", "transition")).toMatchObject({ text: "CUT TO:", forced: false });
    // Highland prints a leading ">" line as an upper-case transition.
    expect(only("> here is a block quote", "transition")).toMatchObject({ text: "HERE IS A BLOCK QUOTE", forced: true });
    expect(only(">This text is centered<", "centered").text).toBe("This text is centered");
    expect(only("This text is right-aligned>", "rightAligned").text).toBe("This text is right-aligned");
  });

  it("classifies sections, synopses, page breaks and directive lines", () => {
    expect(only("## subheading", "section")).toMatchObject({ level: 2, text: "subheading" });
    expect(only("= synopsis of what happens here", "synopsis").text).toBe("synopsis of what happens here");
    expect(kinds("===")).toEqual(["pageBreak"]);
    expect(kinds("{{HEADER: %p}}")).toEqual(["directiveLine"]);
  });

  it("restarts classification after a one-line element without a blank line", () => {
    expect(kinds("= synopsis\n[[note about it]]")).toEqual(["synopsis", "action"]);
    expect(kinds("===\nNext page")).toEqual(["pageBreak", "action"]);
  });
});

describe("action", () => {
  it("keeps multi-line action together, preserving indentation after the first line", () => {
    expect(only("Line one.\n    Indented.", "action").text).toBe("Line one.\n    Indented.");
  });

  it("forces with !, but not for an image line", () => {
    expect(only("!INT. NOT A HEADING", "action")).toMatchObject({ text: "INT. NOT A HEADING", forced: true });
    expect(only("![Alt](assets/x.png)", "action").forced).toBe(false);
  });

  it("reads through revision tags and inline boneyards", () => {
    expect(only("She {{REVISION: #ff0000}}runs{{/REVISION}} /* walks */home.", "action").text).toBe("She runs home.");
  });

  it("classifies a heading wrapped in revision tags as a heading", () => {
    expect(kinds("{{REVISION: #ff0000}}INT. NEW ROOM - DAY{{/REVISION}}")).toEqual(["sceneHeading"]);
  });
});

describe("modes", () => {
  it("does not apply screenplay rules in Markdown", () => {
    expect(parse("INT. HOUSE - DAY", { mode: "markdown" }).elements.map((e) => e.kind)).toEqual(["paragraph"]);
  });
});
