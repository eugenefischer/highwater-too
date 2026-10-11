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

  it("reads navigatorFilters.json, keeping defaults for missing or bad values", () => {
    expect(parseFilters('{"notes": false, "images": "no"}')).toEqual({ ...DEFAULT_FILTERS, notes: false });
    expect(parseFilters("not json")).toEqual(DEFAULT_FILTERS);
  });
});
