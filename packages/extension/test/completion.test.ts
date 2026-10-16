import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { markerText, nextMarker, suggest, vocabulary } from "../src/syntax/completion.ts";

const script = "INT. KITCHEN - DAY\n\nBOB\nHi.\n\nALICE\nHello.\n\nBOB (V.O.)\nAgain.\n\nEXT. GARDEN - NIGHT\n\nINT. KITCHEN - LATER\n";

describe("completion", () => {
  const vocab = vocabulary(parse(script, { mode: "fountain" }));
  it("collects characters by how often they speak, and scene locations", () => {
    expect(vocab.characters).toEqual(["BOB", "ALICE"]);
    expect(vocab.locations).toEqual(["KITCHEN", "GARDEN"]);
  });
  it("offers characters, scene prefixes and transitions on a capitalised line after an empty one", () => {
    const s = suggest("BO", true, vocab);
    expect(s.filter((x) => x.kind === "character").map((x) => x.label)).toEqual(["BOB", "ALICE"]);
    expect(s.some((x) => x.label === "INT.")).toBe(true);
    expect(s.some((x) => x.label === "CUT TO:")).toBe(true);
    expect(suggest("BO", false, vocab)).toEqual([]);
    expect(suggest("Bo", true, vocab)).toEqual([]);
    expect(suggest("B", true, vocabulary(parse(script, { mode: "fountain" })))).toEqual([]); // the capital that starts any action line
  });
  it("offers locations after a scene prefix, then times after the dash", () => {
    expect(suggest("INT. K", true, vocab).map((x) => [x.label, x.insert, x.replaceFrom])).toEqual([
      ["KITCHEN", "KITCHEN - ", 5],
      ["GARDEN", "GARDEN - ", 5],
    ]);
    const times = suggest("EXT. GARDEN - N", true, vocab);
    expect(times[0]).toEqual({ label: "DAY", kind: "time", insert: "DAY", replaceFrom: 14 });
    expect(times.map((t) => t.label)).toContain("NIGHT");
  });
});

describe("markers", () => {
  it("writes Highland's marker and finds the next one, wrapping", () => {
    expect(markerText("fix this")).toBe("{{%m: fix this}}");
    expect(markerText("")).toBe("{{%m}}");
    const text = "a {{%m: one}} b {{%M}} c";
    expect(nextMarker(text, 0)).toBe(2);
    expect(nextMarker(text, 2)).toBe(16);
    expect(nextMarker(text, 16)).toBe(2);
    expect(nextMarker("none", 0)).toBe(null);
  });
});
