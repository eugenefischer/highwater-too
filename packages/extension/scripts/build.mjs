// Bundles the extension (and, with --e2e, the end-to-end suite) and copies the PDF engine's assets.
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const e2e = process.argv.includes("--e2e");

// PDFKit's ES build reads import.meta.url; in VS Code's CommonJS bundle it is defined from the file's path.
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  define: { "import.meta.url": "__import_meta_url" },
  banner: { js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;" },
  logLevel: "warning",
};

await build({ ...common, entryPoints: [join(root, "src/extension.ts")], outfile: join(root, "dist/extension.cjs"), sourcemap: true });
// The Highwater Editor's page, for the webview.
await build({ bundle: true, platform: "browser", format: "iife", target: "chrome120", logLevel: "warning", entryPoints: [join(root, "src/highland-editor/webview.ts")], outfile: join(root, "dist/highland-editor.js") });
// Its spelling worker, and the dictionary it loads: Hunspell's en_US from SCOWL (MIT and BSD; licence copied).
await build({ bundle: true, platform: "browser", format: "iife", target: "chrome120", logLevel: "warning", entryPoints: [join(root, "src/highland-editor/spell-worker.ts")], outfile: join(root, "dist/spell-worker.js") });
const dictionary = dirname(require.resolve("dictionary-en")); // its exports hide the files themselves
for (const f of ["index.aff", "index.dic", "license"]) cpSync(join(dictionary, f), join(root, "dist/dictionary-en", f));
// The Navigator pane's page.
await build({ bundle: true, platform: "browser", format: "iife", target: "chrome120", logLevel: "warning", entryPoints: [join(root, "src/navigator-pane/page.ts")], outfile: join(root, "dist/navigator.js") });
if (e2e) await build({ ...common, entryPoints: [join(root, "e2e/suite.ts")], outfile: join(root, "dist/e2e/suite.cjs") });

// Courier Prime, and PDFKit's standard-font metrics, which it loads at run time as
// "#standard-fonts/…" (mapped to dist/standard-fonts by "imports" in package.json).
cpSync(join(root, "../pdf/fonts"), join(root, "dist/fonts"), { recursive: true });
const metrics = join(dirname(require.resolve("pdfkit")), "standard-fonts"); // pdfkit/js/pdfkit.js -> pdfkit/js/standard-fonts
cpSync(metrics, join(root, "dist/standard-fonts"), { recursive: true, filter: (src) => !src.endsWith(".mjs") });

// pdf.js for the preview webview.
// The legacy build: the modern one needs newer JavaScript than the Chromium inside VS Code may have.
const pdfjs = join(dirname(require.resolve("pdfjs-dist/package.json")), "legacy", "build");
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) cpSync(join(pdfjs, f), join(root, "dist/pdfjs", f));
