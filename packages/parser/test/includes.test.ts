import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { describe, expect, it } from "vitest";
import { resolveIncludes, type IncludeFile, type IncludeLoader } from "../src/index.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

function readFile(path: string): IncludeFile {
  const source = path.endsWith(".highland") ? HighlandBundle.fromZip(new Uint8Array(readFileSync(path))).text : readFileSync(path, "utf8");
  return { id: path, name: path, source };
}

/** What the extension will do: paths relative to the including file, .highland read through the bundle. */
const diskLoader: IncludeLoader = async (path, from) => {
  const full = resolve(dirname(from.id), path);
  try {
    return readFile(full);
  } catch {
    return null;
  }
};

function memoryLoader(files: Record<string, string>): IncludeLoader {
  return async (path) => (path in files ? { id: path, name: path, source: files[path]! } : null);
}

const texts = (r: Awaited<ReturnType<typeof resolveIncludes>>) =>
  r.elements.map(({ element, file }) => [file.id, element.kind === "directiveLine" || element.kind === "pageBreak" ? element.kind : "text" in element ? element.text : element.kind]);

describe("include resolver", () => {
  it("merges the generated screenplay's included scene after its INCLUDE line", async () => {
    const root = readFile(join(generated, "ScreenplayEdgeCases.highland"));
    const r = await resolveIncludes(root, "fountain", diskLoader);
    expect(r.problems).toEqual([]);
    const at = r.elements.findIndex((e) => e.element.kind === "directiveLine" && e.element.directives.some((d) => d.directive.kind === "include"));
    const next = r.elements.slice(at + 1, at + 3);
    expect(next.map((e) => [e.file.id.endsWith("IncludedScene.fountain"), e.element.kind])).toEqual([
      [true, "sceneHeading"],
      [true, "action"],
    ]);
    // The root's own elements continue afterwards.
    expect(r.elements.at(-1)!.file.id).toBe(root.id);
  });

  it("nests, drops included title pages, and keeps spans per file", async () => {
    const r = await resolveIncludes({ id: "main", name: "main", source: "One.\n\n{{INCLUDE: a}}\n\nFour." }, "markdown", memoryLoader({ a: "Title: Not printed\n\nTwo.\n\n{{INCLUDE: b}}", b: "Three." }));
    expect(texts(r)).toEqual([
      ["main", "One."],
      ["main", "directiveLine"],
      ["a", "Two."],
      ["a", "directiveLine"],
      ["b", "Three."],
      ["main", "Four."],
    ]);
    const three = r.elements[4]!;
    expect(three.file.source.slice(three.element.span.start, three.element.span.end)).toBe("Three.");
  });

  it("reports missing files and cycles without throwing", async () => {
    const r = await resolveIncludes({ id: "main", name: "main", source: "{{INCLUDE: a}}\n\n{{INCLUDE: missing}}" }, "markdown", memoryLoader({ a: "A.\n\n{{INCLUDE: b}}", b: "{{INCLUDE: a}}" }));
    expect(r.problems.map((p) => [p.file.id, p.message])).toEqual([
      ["b", "Include cycle: main → a → b → a"],
      ["main", 'Included file not found: "missing"'],
    ]);
    expect(texts(r).map(([, t]) => t)).toEqual(["directiveLine", "A.", "directiveLine", "directiveLine", "directiveLine"]);
  });

  it("reports loader errors", async () => {
    const r = await resolveIncludes({ id: "m", name: "m", source: "{{INCLUDE: x}}" }, "fountain", async () => {
      throw new Error("permission denied");
    });
    expect(r.problems[0]!.message).toBe('Could not read included file "x": permission denied');
  });

  it.runIf(priv)("includes a .highland file as Highland did in MaximalScreenplay-settings", async () => {
    const r = await resolveIncludes(readFile(join(priv!, "MaximalScreenplay-settings.highland")), "fountain", diskLoader);
    expect(r.problems).toEqual([]);
    const included = r.elements.filter((e) => e.file.id.endsWith("MinimalPlainText.highland"));
    expect(included.map((e) => ("text" in e.element ? e.element.text : e.element.kind))).toEqual(["single line of text"]);
  });
});
