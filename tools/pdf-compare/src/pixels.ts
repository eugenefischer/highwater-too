import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const run = promisify(execFile);

export interface PixelPageResult {
  page: number;
  /** Pixels that differ beyond pixelmatch's threshold; -1 if the page sizes differ. */
  differing: number;
  total: number;
}

/** True if poppler's pdftoppm is installed (needed for the pixel backup check). */
export async function hasPdftoppm(): Promise<boolean> {
  try {
    await run("pdftoppm", ["-v"]);
    return true;
  } catch {
    return false;
  }
}

async function render(pdf: string, dir: string, prefix: string, dpi: number): Promise<string[]> {
  await run("pdftoppm", ["-r", String(dpi), "-png", pdf, join(dir, prefix)]);
  return (await readdir(dir)).filter((f) => f.startsWith(prefix)).sort().map((f) => join(dir, f));
}

/** Renders both PDFs with pdftoppm and counts differing pixels per page. */
export async function comparePixels(expectedPdf: string, actualPdf: string, dpi = 72): Promise<PixelPageResult[]> {
  const dir = await mkdtemp(join(tmpdir(), "pdf-compare-"));
  try {
    const exp = await render(expectedPdf, dir, "e", dpi);
    const act = await render(actualPdf, dir, "a", dpi);
    const results: PixelPageResult[] = [];
    for (let i = 0; i < Math.max(exp.length, act.length); i++) {
      const ePath = exp[i];
      const aPath = act[i];
      if (!ePath || !aPath) {
        results.push({ page: i + 1, differing: -1, total: 0 });
        continue;
      }
      const e = PNG.sync.read(await readFile(ePath));
      const a = PNG.sync.read(await readFile(aPath));
      if (e.width !== a.width || e.height !== a.height) {
        results.push({ page: i + 1, differing: -1, total: e.width * e.height });
        continue;
      }
      const differing = pixelmatch(e.data, a.data, undefined, e.width, e.height, { threshold: 0.1 });
      results.push({ page: i + 1, differing, total: e.width * e.height });
    }
    return results;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
