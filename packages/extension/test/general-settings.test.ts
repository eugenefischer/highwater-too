import { readFileSync } from "node:fs";
import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { GENERAL_DEFAULTS, generalSettings, invisiblesOpacity } from "../src/highland-editor/general-settings.ts";
import { columnMinimum, columnWidth, DIALOGUE_WIDTH, lineStyles, PAREN_WIDTH } from "../src/highland-editor/line-styles.ts";
import { navigatorItems, navigatorRows } from "../src/syntax/navigator.ts";
import { documentStats } from "../src/syntax/stats.ts";

describe("General settings", () => {
  it("take only values the settings can have, else the defaults", () => {
    expect(generalSettings(() => undefined)).toEqual(GENERAL_DEFAULTS);
    const values: Record<string, unknown> = { editorFont: "Highland Sans", columnWidth: "wide", lineSpacing: "loose", invisiblesBrightness: 250, saveCursorPosition: true, sidebarText: "huge", navigatorMarkup: "yes" };
    expect(generalSettings((k) => values[k])).toEqual({ ...GENERAL_DEFAULTS, editorFont: "Highland Sans", columnWidth: "wide", lineSpacing: "loose", invisiblesBrightness: 100, saveCursorPosition: true });
    expect(invisiblesOpacity(100)).toBe(1);
    expect(invisiblesOpacity(0)).toBeGreaterThan(0);
  });

  it("are each a VS Code setting with the same default", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { contributes: { configuration: { properties: Record<string, { default: unknown; enum?: unknown[] }> } } };
    const props = manifest.contributes.configuration.properties;
    for (const [key, value] of Object.entries(GENERAL_DEFAULTS)) expect(props[`highwater.${key}`]?.default, key).toEqual(value);
    expect(props["highwater.editorFont"]?.enum).toEqual(["Courier Prime", "Highland Sans"]);
  });
});

describe("column width", () => {
  const src = "INT. KITCHEN - DAY\n\nBrenda waits.\n\nBRENDA\n(whispering)\nAre you coming?\n";
  const doc = parse(src, { mode: "fountain" });
  const at = (line: string) => src.indexOf(line);

  it("widens the column and moves speeches right, keeping their widths", () => {
    expect([columnWidth(doc), columnWidth(doc, "medium"), columnWidth(doc, "wide")]).toEqual([63, 78, 98]);
    for (const [width, cue, paren, dialogue] of [
      ["narrow", 21, 15, 11],
      ["medium", 30, 22, 17],
      ["wide", 39, 29, 23],
    ] as const) {
      const s = lineStyles(doc, width);
      expect(s.get(at("BRENDA")), width).toMatchObject({ kind: "cue", indent: cue });
      expect(s.get(at("(whispering)")), width).toEqual({ kind: "parenthetical", indent: paren, width: PAREN_WIDTH });
      expect(s.get(at("Are you")), width).toEqual({ kind: "dialogue", indent: dialogue, width: DIALOGUE_WIDTH });
      expect(columnMinimum(doc, width)).toBe(dialogue + DIALOGUE_WIDTH);
    }
    expect(columnWidth(parse("Text.", { mode: "markdown" }), "wide")).toBe(100);
  });
});

describe("Navigator markup", () => {
  it("keeps each section, synopsis and note as written, for Show markup", () => {
    const src = "# Act One\n\n= They meet.\n\nINT. KITCHEN - DAY\n\nBrenda waits. [[check this]]\n";
    const doc = parse(src, { mode: "fountain" });
    const rows = navigatorRows(doc, navigatorItems(doc));
    expect(rows.map((r) => [r.label, r.markup])).toEqual([
      ["Act One", "# Act One"],
      ["They meet.", "= They meet."],
      ["INT. KITCHEN - DAY", null],
      ["check this", "[[check this]]"],
    ]);
  });
});

describe("word count and notes", () => {
  it("counts the words in notes unless they are left out", () => {
    const doc = parse("INT. KITCHEN - DAY\n\nBrenda waits. [[two words]]\n\n[[and three more]]\n", { mode: "fountain" });
    expect(documentStats(doc).words).toBe(5);
    expect(documentStats(doc, { notes: true }).words).toBe(10);
  });
});
