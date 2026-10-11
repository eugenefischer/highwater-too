import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { extractPages, type PdfPage } from "@highwater/pdf-compare";
import { layoutManuscript, layoutScreenplay, renderPdf, type Layout, type ManuscriptOptions, type ScreenplayOptions } from "../src/index.ts";

/** Lays out and renders a .highland screenplay, and extracts the result like a Highland PDF. */
export async function renderHighland(path: string, options: ScreenplayOptions = {}): Promise<PdfPage[]> {
  const text = HighlandBundle.fromZip(new Uint8Array(readFileSync(path))).text;
  return renderText(text, options);
}

export async function renderText(text: string, options: ScreenplayOptions = {}): Promise<PdfPage[]> {
  return extractLayout(layoutScreenplay(parse(text, { mode: "fountain" }), { date: new Date(2026, 8, 28), ...options }));
}

/** Lays out and renders a .highland manuscript (images from the bundle), extracted like a Highland PDF. */
export async function renderManuscript(path: string, options: ManuscriptOptions = {}): Promise<PdfPage[]> {
  const bundle = HighlandBundle.fromZip(new Uint8Array(readFileSync(path)));
  const image = (src: string) => bundle.get(src) ?? null;
  return extractLayout(layoutManuscript(parse(bundle.text, { mode: "markdown" }), { date: new Date(2026, 8, 28), image, ...options }));
}

export async function extractLayout(layout: Layout): Promise<PdfPage[]> {
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
