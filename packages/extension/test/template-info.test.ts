import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPLATE_INFO, templateSlug } from "../src/template-info.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { contributes: { configuration: { properties: Record<string, { enum?: string[]; default: unknown; type: string }> } } };

describe("the Document Template window", () => {
  it("lists every template once, in Highland's groups", () => {
    // render-document.ts's TEMPLATES (it needs VS Code to load).
    const source = readFileSync(new URL("../src/render-document.ts", import.meta.url), "utf8");
    const templates = JSON.parse(/export const TEMPLATES = (\[[^\]]*\])/.exec(source)![1]!) as string[];
    expect(TEMPLATE_INFO.map((t) => t.name)).toEqual(templates);
  });

  it("has a setting for every template option, with the same choices and default", () => {
    const props = manifest.contributes.configuration.properties;
    const keys = TEMPLATE_INFO.flatMap((t) => t.options.map((o) => ({ key: `highwater.templates.${templateSlug(t.name)}.${o.key}`, o })));
    for (const { key, o } of keys) {
      expect(props[key], key).toBeDefined();
      expect(props[key]!.default, key).toBe(o.default);
      if (o.kind === "font") expect(props[key]!.enum, key).toEqual(o.choices);
    }
    expect(Object.keys(props).filter((k) => k.startsWith("highwater.templates.")).sort()).toEqual(keys.map((k) => k.key).sort());
  });

  it("names settings as Highland's templates read", () => {
    expect(templateSlug("Multi-Cam")).toBe("multiCam");
    expect(templateSlug("MLA Report")).toBe("mlaReport");
  });
});
