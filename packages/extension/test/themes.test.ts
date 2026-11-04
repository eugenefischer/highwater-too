import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HIGHLAND_THEMES, navigatorColors, onColor, pageColors, themeFor } from "../src/highland-editor/themes.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  contributes: { configuration: { properties: Record<string, { enum?: string[] }> } };
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
});
