import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, navigatorItems, parseFilters, type NavigatorItem } from "../src/syntax/navigator.ts";

const tree = (items: NavigatorItem[]): unknown[] => items.map((i) => (i.children.length ? [`${i.type}:${i.label}`, tree(i.children)] : `${i.type}:${i.label}`));

describe("navigator", () => {
  it("lists a screenplay's sections, scenes, synopses, notes and markers, nested under sections", () => {
    const src = "# Act One\n\n= The setup\n\nINT. HOUSE - DAY #1#\n\nShe enters. [[check this]]\n\n{{%m:fix me}}\n\n## Sequence\n\nEXT. ROAD - NIGHT\n\n{{INCLUDE: other.fountain}}\n\n# Act Two\n\nINT. CAR - DAY";
    expect(tree(navigatorItems(parse(src, { mode: "fountain" })))).toEqual([
      [
        "sectionHeaders:Act One",
        ["synopses:The setup", "sceneHeaders:INT. HOUSE - DAY #1#", "notes:check this", "markers:fix me", ["sectionHeaders:Sequence", ["sceneHeaders:EXT. ROAD - NIGHT", "includedFiles:other.fountain"]]],
      ],
      ["sectionHeaders:Act Two", ["sceneHeaders:INT. CAR - DAY"]],
    ]);
  });

  it("lists a manuscript's headings, images and links", () => {
    const src = "# Chapter\n\nSee [the site](https://example.com) and [Highland][hl].\n\n![A cat](assets/cat.png)\n\n[hl]: https://highland2.app";
    expect(tree(navigatorItems(parse(src, { mode: "markdown" })))).toEqual([
      [
        "sectionHeaders:Chapter",
        ["links:the site — https://example.com", "referenceLinks:Highland", "images:A cat", "referenceLinks:[hl] https://highland2.app"],
      ],
    ]);
  });

  it("hides filtered types, moving their children up", () => {
    const src = "# Act One\n\nINT. HOUSE - DAY\n\n= Synopsis";
    const items = navigatorItems(parse(src, { mode: "fountain" }), { ...DEFAULT_FILTERS, sectionHeaders: false, synopses: false });
    expect(tree(items)).toEqual(["sceneHeaders:INT. HOUSE - DAY"]);
  });

  it("leaves a marker out of the heading it sits in", () => {
    const items = navigatorItems(parse("INT. HALL - DAY {{%m: Fix}}\n\nShe runs.\n", { mode: "fountain" }));
    expect(tree(items)).toEqual(["sceneHeaders:INT. HALL - DAY", "markers:Fix"]);
  });

  it("reads navigatorFilters.json, keeping defaults for missing or bad values", () => {
    expect(parseFilters('{"notes": false, "images": "no"}')).toEqual({ ...DEFAULT_FILTERS, notes: false });
    expect(parseFilters("not json")).toEqual(DEFAULT_FILTERS);
  });
});

describe("navigator drag to reorder", async () => {
  const { blockAt, moveBlock } = await import("../src/syntax/navigator.ts");
  const { parse } = await import("@highwater/parser");
  const apply = (src: string, m: NonNullable<ReturnType<typeof moveBlock>>) => {
    // Apply the later edit first so the earlier offsets stay valid.
    const edits = [{ start: m.delete.start, end: m.delete.end, text: "" }, { start: m.insert.at, end: m.insert.at, text: m.insert.text }].sort((a, b) => b.start - a.start);
    return edits.reduce((s, e) => s.slice(0, e.start) + e.text + s.slice(e.end), src);
  };
  const script = "# Act One\n\nINT. A - DAY\n\nOne.\n\nINT. B - DAY\n\nTwo.\n\n# Act Two\n\nINT. C - DAY\n\nThree.\n";
  const doc = parse(script, { mode: "fountain" });
  const at = (text: string) => script.indexOf(text);

  it("finds a scene's text, up to the next scene", () => {
    expect(script.slice(at("INT. B"), blockAt(doc, at("INT. B"))!.end)).toBe("INT. B - DAY\n\nTwo.\n\n");
  });
  it("finds a section's text, scenes included, up to the next section at its level", () => {
    expect(script.slice(at("# Act One"), blockAt(doc, at("# Act One"))!.end)).toBe("# Act One\n\nINT. A - DAY\n\nOne.\n\nINT. B - DAY\n\nTwo.\n\n");
  });
  it("moves a scene before another", () => {
    const m = moveBlock(script, blockAt(doc, at("INT. B"))!, at("INT. A"))!;
    expect(apply(script, m)).toBe("# Act One\n\nINT. B - DAY\n\nTwo.\n\nINT. A - DAY\n\nOne.\n\n# Act Two\n\nINT. C - DAY\n\nThree.\n");
  });
  it("moves the last scene, adding the empty line it lacked", () => {
    const m = moveBlock(script, blockAt(doc, at("INT. C"))!, at("INT. A"))!;
    expect(apply(script, m)).toBe("# Act One\n\nINT. C - DAY\n\nThree.\n\nINT. A - DAY\n\nOne.\n\nINT. B - DAY\n\nTwo.\n\n# Act Two\n\n");
  });
  it("moves a section to the end, and does nothing when dropped inside itself", () => {
    const act1 = blockAt(doc, at("# Act One"))!;
    expect(apply(script, moveBlock(script, act1, null)!)).toBe("# Act Two\n\nINT. C - DAY\n\nThree.\n\n# Act One\n\nINT. A - DAY\n\nOne.\n\nINT. B - DAY\n\nTwo.\n\n");
    expect(moveBlock(script, act1, at("INT. B"))).toBe(null);
  });
});

describe("markers, against a file Highland saved", async () => {
  const { readFileSync } = await import("node:fs");
  const { HighlandBundle } = await import("@highwater/bundle");
  const { parse } = await import("@highwater/parser");
  const { navigatorItems } = await import("../src/syntax/navigator.ts");
  const { markerText, markerOffsets } = await import("../src/syntax/completion.ts");
  const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(new URL("../../../fixtures/generated/MarkerTest.highland", import.meta.url)))).text;
  it("writes markers as Highland does", () => {
    expect(text).toContain(markerText("From Highland"));
  });
  it("finds every marker Highland's Navigator lists, in order", () => {
    const labels = navigatorItems(parse(text, { mode: "fountain" }))
      .flatMap(function all(i): typeof i[] { return [i, ...i.children.flatMap(all)]; })
      .filter((i) => i.type === "markers")
      .map((i) => i.label);
    expect(labels).toEqual(["Marker A with space", "Marker B no space", "(untitled)", "Marker C inline", "Marker D end of line", "From Highland"]);
    expect(markerOffsets(text)).toHaveLength(6);
  });
});

describe("navigator rows for the Highland-style pane", async () => {
  const { navigatorItems, navigatorRows, currentRow } = await import("../src/syntax/navigator.ts");
  const src = "# Act One\n\nINT. HOUSE - DAY\n\nShe enters. [[check]]\n\nEXT. ROAD - NIGHT\n\nRain.\n";
  const doc = parse(src, { mode: "fountain" });
  const rows = navigatorRows(doc, navigatorItems(doc));
  it("lists items flat in document order, with depth and each block's end", () => {
    expect(rows.map((r) => [r.type, r.label, r.depth])).toEqual([
      ["sectionHeaders", "Act One", 0],
      ["sceneHeaders", "INT. HOUSE - DAY", 1],
      ["notes", "check", 1],
      ["sceneHeaders", "EXT. ROAD - NIGHT", 1],
    ]);
    expect(rows[1]!.blockEnd).toBe(src.indexOf("EXT. ROAD"));
    expect(rows[3]!.blockEnd).toBe(src.length);
    expect(rows[0]!.blockEnd).toBe(src.length);
    expect(rows[2]!.blockEnd).toBe(null);
  });
  it("finds the row the cursor is in", () => {
    expect(currentRow(rows, 0)).toBe(0);
    expect(currentRow(rows, src.indexOf("She"))).toBe(1);
    expect(currentRow(rows, src.indexOf("Rain"))).toBe(3);
    expect(currentRow([], 5)).toBe(-1);
  });
});
