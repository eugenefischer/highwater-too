import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { comparePages, extractPages, formatReport } from "@highwater/pdf-compare";
import { defaultFontDir } from "@highwater/pdf";
import { describe, expect, it } from "vitest";
import { exportScreenplay } from "../src/pdf-export.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));

async function pages(pdf: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), "highwater-export-"));
  await writeFile(join(dir, "out.pdf"), pdf);
  return extractPages(join(dir, "out.pdf"));
}

describe("exportScreenplay", () => {
  it("exports a .highland screenplay that matches Highland's PDF", async () => {
    const path = join(generated, "SpeechFitTests.highland");
    const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(path))).text;
    const result = await exportScreenplay({ text, path, fontDir: defaultFontDir() });
    const r = comparePages(await extractPages(join(generated, "SpeechFitTests.pdf")), await pages(result.pdf));
    expect(r.diffs, formatReport(r)).toEqual([]);
    expect(result.pages).toBe(31);
  });

  it("merges {{INCLUDE}} files by path (Highland only prints them with a macOS bookmark)", async () => {
    const path = join(generated, "ScreenplayEdgeCases.highland");
    const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(path))).text;
    const result = await exportScreenplay({ text, path, fontDir: defaultFontDir() });
    expect(result.problems).toEqual([]);
    const all = (await pages(result.pdf)).flatMap((p) => p.lines.map((l) => l.text));
    expect(all).toContain("INT. INCLUDED SCENE - DAY");
  });

  it("reports a missing include and leaves out the title page when asked", async () => {
    const result = await exportScreenplay({ text: "Title: T\n\n{{INCLUDE: nowhere.fountain}}\n\nINT. A - DAY", path: join(generated, "x.fountain"), fontDir: defaultFontDir(), titlePage: false });
    expect(result.problems).toEqual(['Included file not found: "nowhere.fountain"']);
    const ps = await pages(result.pdf);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.lines.map((l) => l.text)).toEqual(["INT. A - DAY"]);
  });
});
