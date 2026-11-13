import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorTheme, colorThemeFile, colorThemeLabel, contrast, CUSTOM_WINDOW_THEMES, customId, deltaE, diffTints, HIGHLAND_THEMES, navigatorColors, onColor, pageColors, parseThemeLink, swatches, themeFor, themeLink } from "../src/highland-editor/themes.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  contributes: { configuration: { properties: Record<string, { enum?: string[]; examples?: string[] }> }; themes: { label: string; uiTheme: string; path: string }[] };
};

describe("Highland themes", () => {
  it("has Highland 2's eleven themes, all offered in the setting", () => {
    expect(Object.values(HIGHLAND_THEMES).map((t) => t.name)).toEqual(["Classic", "Clean", "Winter", "Kermit", "Solarized Light", "Dark Mode", "Dracula", "Material", "Monokai", "Solarized Dark", "Transit"]);
    // Offered as examples, not an enum: custom themes are "custom:<id>".
    expect(manifest.contributes.configuration.properties["highwater.theme"]!.examples).toEqual(["vscode", ...Object.keys(HIGHLAND_THEMES)]);
    for (const t of Object.values(HIGHLAND_THEMES)) for (const c of [t.background, t.text, t.primary, t.sceneHeading, t.notes, t.cursor]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps VS Code's colours unless a Highland theme is chosen", () => {
    expect(themeFor(undefined)).toBe(null);
    expect(themeFor("vscode")).toBe(null);
    expect(themeFor("not-a-theme")).toBe(null);
    expect(themeFor("dracula")?.name).toBe("Dracula");
  });

  it("gives the page and the Navigator their colours", () => {
    const d = HIGHLAND_THEMES["dracula"]!;
    expect(pageColors(d)).toMatchObject({ "--hl-bg": "#282a36", "--hl-fg": "#f8f8f2", "--hl-scene": "#bd93f9", "--hl-note": "#ff79c6", "--hl-caret": "#f1fa8c" });
    expect(navigatorColors(d)).toMatchObject({ "--nav-bg": "#202026", "--nav-fg": "#ccccca", "--nav-section": "#ccccca" });
  });

  it("puts readable text on a button", () => {
    expect(onColor("#b8c663")).toBe("#000000");
    expect(onColor("#326878")).toBe("#ffffff");
  });

  it("offers each as a VS Code colour theme, with its file up to date (run scripts/gen-themes.ts after changing the table)", () => {
    expect(manifest.contributes.themes).toEqual(
      Object.entries({ ...HIGHLAND_THEMES, ...CUSTOM_WINDOW_THEMES }).map(([id, t]) => ({ label: colorThemeLabel(t), uiTheme: t.mode === "dark" ? "vs-dark" : "vs", path: `./${colorThemeFile(id)}` })),
    );
    for (const [id, t] of Object.entries({ ...HIGHLAND_THEMES, ...CUSTOM_WINDOW_THEMES })) {
      const file = JSON.parse(readFileSync(new URL(`../${colorThemeFile(id)}`, import.meta.url), "utf8")) as { colors: Record<string, string> };
      expect(file).toEqual(colorTheme(t));
      for (const c of Object.values(file.colors)) expect(c).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    }
  });
});

describe("Compare's tints", () => {
  const rgb = (h: string): [number, number, number] => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255) as [number, number, number];
  it("stand out from every theme's page, and keep the text readable on them", () => {
    for (const [id, t] of Object.entries(HIGHLAND_THEMES)) {
      const tints = diffTints(t);
      const bg = rgb(t.background);
      const fg = rgb(t.text);
      for (const line of ["--hl-add-line", "--hl-del-line"]) expect(deltaE(rgb(tints[line]!), bg), `${id} ${line}`).toBeGreaterThanOrEqual(7);
      for (const words of ["--hl-add-text", "--hl-del-text"]) {
        expect(deltaE(rgb(tints[words]!), bg), `${id} ${words}`).toBeGreaterThanOrEqual(15);
        expect(contrast(fg, rgb(tints[words]!)), `${id} ${words}`).toBeGreaterThanOrEqual(Math.min(5.5, contrast(fg, bg) * 0.75) - 0.01);
        // Words stand out from their line.
        expect(deltaE(rgb(tints[words]!), rgb(tints[words.replace("-text", "-line")]!)), `${id} ${words} vs line`).toBeGreaterThanOrEqual(6.5);
      }
      // Added and removed are told apart.
      expect(deltaE(rgb(tints["--hl-add-text"]!), rgb(tints["--hl-del-text"]!)), id).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("custom themes", () => {
  // Highland's theme builder's own link for its Classic colours (2026-11-13).
  const BUILDER = "https://quoteunquoteapps.com/theme-builder/?Custom_Theme,L,FFFFFF,2D333B,B36795,2FAAD1,3F4752,3F4752,C4CACE,499C91,9BACBA,F85E66";

  it("reads Highland's theme links and writes them back the same", () => {
    const t = parseThemeLink(BUILDER)!;
    const classic = HIGHLAND_THEMES.classic!;
    expect(t).toMatchObject({ name: "Custom Theme", mode: "light", background: "#ffffff", primary: classic.primary, secondary: classic.secondary, sceneHeading: classic.sceneHeading, cursor: classic.cursor });
    expect(themeLink(t)).toBe(BUILDER);
    expect(parseThemeLink(BUILDER.replace("https://quoteunquoteapps.com/theme-builder/", "highland://theme/"))).toEqual(t);
    expect(parseThemeLink("My_Dark,D,000000,AAAAAA,B8C663,AA5B7F,74A2A5,111111,888888,B8C663,848484,C86E75")).toMatchObject({ name: "My Dark", mode: "dark" });
    expect(parseThemeLink("not a theme")).toBeNull();
    expect(parseThemeLink(BUILDER.replace("FFFFFF", "FFFFF"))).toBeNull();
  });

  it("shows Highland's five swatches and finds a custom theme by its id", () => {
    expect(swatches(HIGHLAND_THEMES.material!)).toEqual(["#263238", "#39adb5", "#91b859", "#bb80b3", "#f07178"]);
    const c = { id: "x1", ...parseThemeLink(BUILDER)! };
    expect(themeFor(customId(c), [c])).toMatchObject({ name: "Custom Theme", added: "#2da44e" });
    expect(themeFor("custom:gone", [c])).toBeNull();
    expect(themeFor("material")).toBe(HIGHLAND_THEMES.material);
  });
});
