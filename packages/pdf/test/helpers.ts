import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { extractPages, type PdfPage } from "@highwater/pdf-compare";
import { layoutScreenplay, renderPdf, type ScreenplayOptions } from "../src/index.ts";

/** Lays out and renders a .highland screenplay, and extracts the result like a Highland PDF. */
export async function renderHighland(path: string, options: ScreenplayOptions = {}): Promise<PdfPage[]> {
  const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(path))).text;
  return renderText(text, options);
}

export async function renderText(text: string, options: ScreenplayOptions = {}): Promise<PdfPage[]> {
  const layout = layoutScreenplay(parse(text, { mode: "fountain" }), { date: new Date(2026, 8, 28), ...options });
  const bytes = await renderPdf(layout, { creationDate: new Date(0) });
  const dir = await mkdtemp(join(tmpdir(), "highwater-pdf-"));
  const out = join(dir, "out.pdf");
  await writeFile(out, bytes);
  return extractPages(out);
}

/** Drops header and footer lines (for samples where we deliberately print them differently). */
export function bodyOnly(pages: PdfPage[]): PdfPage[] {
  return pages.map((p) => ({ ...p, lines: p.lines.filter((l) => l.y > 60 && l.y < 740) }));
}
