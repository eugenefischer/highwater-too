import { comparePages, comparePixels, extractPages, formatReport, hasPdftoppm } from "./index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const files = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--tolerance"));

if (files.length !== 2) {
  console.error("usage: npm run pdf-compare -- <expected.pdf> <actual.pdf> [--tolerance 1] [--pixels]");
  process.exit(2);
}
const [expectedPdf, actualPdf] = files as [string, string];
const tolerance = Number(option("--tolerance") ?? 1);

const result = comparePages(await extractPages(expectedPdf), await extractPages(actualPdf), { tolerance });
console.log(formatReport(result));
let ok = result.ok;

if (flag("--pixels")) {
  if (!(await hasPdftoppm())) {
    console.log("pixels: skipped (pdftoppm not installed)");
  } else {
    for (const p of await comparePixels(expectedPdf, actualPdf)) {
      const share = p.total ? ((100 * p.differing) / p.total).toFixed(3) : "n/a";
      console.log(`pixels p${p.page}: ${p.differing < 0 ? "page missing or size differs" : `${p.differing} differ (${share}%)`}`);
      if (p.differing !== 0) ok = false;
    }
  }
}
process.exit(ok ? 0 : 1);
