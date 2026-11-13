import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colorTheme, colorThemeFile, colorThemeLabel, contrast, deltaE, diffTints, HIGHLAND_THEMES, navigatorColors, onColor, pageColors, themeFor } from "../src/highland-editor/themes.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  contributes: { configuration: { properties: Record<string, { enum?: string[] }> }; themes: { label: string; uiTheme: string; path: string }[] };
};

describe("Highland themes", () => {
  it("has Highland 2's eleven themes, all offered in the setting", () => {
    expect(Object.values(HIGHLAND_THEMES).map((t) => t.name)).toEqual(["Classic", "Clean", "Winter", "Kermit", "Solarized Light", "Dark Mode", "Dracula", "Material", "Monokai", "Solarized Dark", "Transit"]);
    expect(manifest.contributes.configuration.properties["highwater.theme"]!.enum).toEqual(["vscode", ...Object.keys(HIGHLAND_THEMES)]);
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
    expect(navigatorColors(d)).toMatchObject({ "--nav-bg": "#202026", "--nav-fg": "#ccccca", "--nav-section": "#ffb86c" });
  });

  it("puts readable text on a button", () => {
    expect(onColor("#b8c663")).toBe("#000000");
    expect(onColor("#326878")).toBe("#ffffff");
  });

  it("offers each as a VS Code colour theme, with its file up to date (run scripts/gen-themes.ts after changing the table)", () => {
    expect(manifest.contributes.themes).toEqual(
      Object.entries(HIGHLAND_THEMES).map(([id, t]) => ({ label: colorThemeLabel(t), uiTheme: t.mode === "dark" ? "vs-dark" : "vs", path: `./${colorThemeFile(id)}` })),
    );
    for (const [id, t] of Object.entries(HIGHLAND_THEMES)) {
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
