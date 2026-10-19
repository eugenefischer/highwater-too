import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { extractPages, type PdfPage } from "@highwater/pdf-compare";
import { describe, expect, it } from "vitest";
import { defaultFontDir, findFamily, layoutProse, NOVEL, PROSE_TEMPLATES, resolveFonts, wrapMeasured, type Run } from "../src/index.ts";
import { extractLayout } from "./helpers.ts";

const templates = fileURLToPath(new URL("../../../fixtures/generated/templates/", import.meta.url));
const probe = (name: string) => HighlandBundle.fromZip(new Uint8Array(readFileSync(join(templates, `${name.replace(/ /g, "")}Probe.highland`)))).text;
const lay = (name: string, fontDirs: string[] = []) => layoutProse(parse(probe(name), { mode: "markdown" }), PROSE_TEMPLATES[name]!, { fontDir: defaultFontDir(), fontDirs, date: new Date(2026, 9, 19) });
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;
/** EJ's copies of the macOS and Highland fonts, for local tests only (never in the repo). */
const privateFonts = priv ? join(priv, "fonts (private)") : null;

/** Short lines whose text is unique in Highland's PDF, found in ours on the same page within `tolerance` points. */
function landmarks(expected: PdfPage[], actual: PdfPage[], tolerance: number) {
  const count = new Map<string, number>();
  for (const p of expected) for (const l of p.lines) count.set(l.text.trim(), (count.get(l.text.trim()) ?? 0) + 1);
  let total = 0;
  const missed: string[] = [];
  expected.forEach((p, i) => {
    for (const l of p.lines) {
      const t = l.text.trim();
      if (t.length < 3 || t.length > 40 || count.get(t) !== 1) continue;
      total++;
      const ok = actual[i]?.lines.some((a) => a.text.trim() === t && Math.abs(a.y - l.y) <= tolerance && Math.abs(a.x - l.x) <= tolerance);
      if (!ok) missed.push(`p${i + 1} ${t}`);
    }
  });
  return { total, matched: total - missed.length, missed };
}

describe("prose templates (close match)", () => {
  it("Novel: Highland's short lines land on the same page within 3 pt, with the bundled Amiri", async () => {
    const r = landmarks(await extractPages(join(templates, "NovelProbe.pdf")), await extractLayout(lay("Novel")), 3);
    expect(r.matched / r.total, r.missed.join("\n")).toBeGreaterThan(0.8);
  });

  it.each(Object.keys(PROSE_TEMPLATES))("%s lays out the probe in about as many pages as Highland", async (name) => {
    const expected = (await extractPages(join(templates, `${name.replace(/ /g, "")}Probe.pdf`))).length;
    const layout = lay(name);
    // Missing fonts are replaced by narrower ones, so allow a quarter either way.
    expect(Math.abs(layout.pages.length - expected) / expected).toBeLessThan(0.25);
  });

  it("sets Novel's first line after a heading in small capitals and justifies the rest", () => {
    const layout = lay("Novel");
    const first = layout.pages[1]!.items.find((it) => it.runs.map((r) => r.text).join("").startsWith("A:"))!;
    expect(first.runs.some((r) => r.style.size === NOVEL.body.size * 0.8 && r.text === r.text.toUpperCase())).toBe(true);
    expect(layout.pages[1]!.items.some((it) => it.justify !== undefined)).toBe(true);
  });
});

// With the real fonts (EJ's private copies), every template should land close to Highland's.
describe.runIf(privateFonts && existsSync(privateFonts))("prose templates with the real fonts", () => {
  it.each(Object.keys(PROSE_TEMPLATES).filter((n) => n !== "Novel"))("%s: most short lines land where Highland puts them", async (name) => {
    const layout = lay(name, [privateFonts!]);
    expect(layout.substituted).toEqual({});
    const r = landmarks(await extractPages(join(templates, `${name.replace(/ /g, "")}Probe.pdf`)), await extractLayout(layout), 3);
    expect(r.matched / r.total, r.missed.join("\n")).toBeGreaterThan(0.6);
  });
});

describe("prose title pages", () => {
  it.each(["Novel", "Treatment"])("%s prints Highland's corner keys (TL, TR, CC, BL, BR), as manuscripts use them", (name) => {
    const text = "TL: Top left\nTR: Top right\nCC: A Title\n\t\n\tby Someone\nBL: Bottom left\nBR: Bottom right\n\nThe text.";
    const layout = layoutProse(parse(text, { mode: "markdown" }), PROSE_TEMPLATES[name]!, { fontDir: defaultFontDir(), fontDirs: [] });
    const title = layout.pages[0]!;
    expect(title.number).toBeNull();
    const at = (t: string) => title.items.find((it) => it.runs.map((r) => r.text).join("") === t);
    expect(at("Top left")?.x).toBe(72);
    expect(at("A Title")).toBeDefined();
    expect(at("by Someone")!.y).toBeGreaterThan(at("A Title")!.y);
    expect(at("Bottom left")!.y).toBe(at("Bottom right")!.y);
    expect(layout.pages[1]!.items.some((it) => it.runs.some((r) => r.text.includes("The text.")))).toBe(true);
  });
});

describe("fonts", () => {
  it("finds a family's four faces by file name, and the faces of a collection by PostScript name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "highwater-fonts-"));
    for (const f of ["Georgia.ttf", "Georgia Bold.ttf", "Georgia Italic.ttf", "Georgia Bold Italic.ttf", "GeorgiaPro-Bold.ttf", "Avenir Next.ttc"]) await writeFile(join(dir, f), "");
    const g = findFamily("Georgia", [dir])!;
    expect([g.regular.path, g.bold.path, g.italic.path, g.boldItalic.path].map((p) => p.split("/").pop())).toEqual(["Georgia.ttf", "Georgia Bold.ttf", "Georgia Italic.ttf", "Georgia Bold Italic.ttf"]);
    expect(findFamily("Avenir Next", [dir])!.boldItalic).toMatchObject({ postscriptName: "AvenirNext-BoldItalic" });
    expect(findFamily("Times New Roman", [dir])).toBeNull();
  });

  it("uses bundled fonts, and a bundled substitute for one that is not installed", () => {
    const r = resolveFonts(["Amiri", "Georgia", "Highland Sans"], defaultFontDir(), []);
    expect(r.substituted).toEqual({ Georgia: "Amiri", "Highland Sans": "Courier Prime" });
    expect(r.faces["Georgia/bold"]!.path).toMatch(/Amiri-Bold\.ttf$/);
  });

  it("wraps by measured width, hanging the space and breaking an overlong word", () => {
    const runs: Run[] = [{ text: "aaa bbb cccccccccc dd", style: {} }];
    const w = (r: Run[]) => r.map((x) => x.text).join("").length;
    expect(wrapMeasured(runs, 7, 7, w).map((l) => l.map((x) => x.text).join(""))).toEqual(["aaa bbb", "ccccccc", "ccc dd"]);
  });
});
