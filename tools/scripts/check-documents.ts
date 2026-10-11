/**
 * Release check (M8): every .highland file under a folder opens, saves back byte for byte when
 * unchanged, and lays out and renders as a PDF with its template; reports pages and timings.
 *
 *   node --experimental-strip-types tools/scripts/check-documents.ts <folder>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { HighlandBundle } from "../../packages/bundle/src/index.ts";
import { parse } from "../../packages/parser/src/index.ts";
import { layoutManuscript, layoutScreenplay, renderPdf } from "../../packages/pdf/src/index.ts";

const root = process.argv[2];
if (!root) throw new Error("usage: check-documents.ts <folder>");

const find = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name.endsWith(".textbundle") ? [] : find(full);
    return name.endsWith(".highland") ? [full] : [];
  });

let failures = 0;
for (const file of find(root)) {
  const name = relative(root, file);
  try {
    const bytes = new Uint8Array(readFileSync(file));
    const bundle = HighlandBundle.fromZip(bytes);
    const again = HighlandBundle.fromZip(bundle.toZip(file));
    const same = again.paths.length === bundle.paths.length && bundle.paths.every((p) => Buffer.compare(Buffer.from(again.get(p) ?? []), Buffer.from(bundle.get(p) ?? [])) === 0);
    const settings = bundle.highlandSettings as { templateName?: string; printOptions?: { printTitlePage?: boolean } };
    const template = settings.templateName === "Manuscript" || (settings.templateName !== "Screenplay" && bundle.mode === "markdown") ? "Manuscript" : bundle.mode === "plain" ? null : "Screenplay";
    let summary = "plain text: no PDF";
    if (template) {
      const t0 = performance.now();
      const doc = parse(bundle.text, { mode: template === "Screenplay" ? "fountain" : "markdown" });
      const options = { titlePage: settings.printOptions?.printTitlePage !== false, image: (src: string) => bundle.get(decodeURIComponent(src)) ?? null };
      const layout = template === "Screenplay" ? layoutScreenplay(doc, options) : layoutManuscript(doc, options);
      const t1 = performance.now();
      await renderPdf(layout);
      const t2 = performance.now();
      summary = `${template}, ${layout.pages.length} pages, layout ${(t1 - t0).toFixed(0)} ms + render ${(t2 - t1).toFixed(0)} ms`;
    }
    if (!same) failures++;
    console.log(`${same ? "ok  " : "FAIL"} ${name}: ${same ? "" : "entries changed on save! "}${summary}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}: ${(error as Error).message}`);
  }
}
console.log(failures ? `${failures} problem(s)` : "all documents ok");
process.exitCode = failures ? 1 : 0;
