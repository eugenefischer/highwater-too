/**
 * Writes the M1 Highland check files: one edited round-trip of an existing Highland file and two new documents.
 * usage: node scripts/make-highland-check.ts <existing.highland> <out-dir>
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createDocument, readBundle, writeBundle } from "../src/index.ts";

const [source, outDir] = process.argv.slice(2);
if (!source || !outDir) {
  console.error("usage: node scripts/make-highland-check.ts <existing.highland> <out-dir>");
  process.exit(2);
}
await mkdir(outDir, { recursive: true });

const { bundle } = await readBundle(source);
bundle.text = `${bundle.text}\n\nThis line was added by Highwater Too.`;
await writeBundle(join(outDir, "M1-RoundTrip-Edited.highland"), bundle);

const screenplay = createDocument({
  mode: "fountain",
  template: "Screenplay",
  text: [
    "Title: Written by Highwater Too",
    "Author: M1 check",
    "",
    "INT. TEST ROOM - DAY",
    "",
    "A new document, created without Highland.",
    "",
    "EJ",
    "Does it open?",
  ].join("\n"),
});
await writeBundle(join(outDir, "M1-New-Screenplay.highland"), screenplay);

const manuscript = createDocument({
  mode: "markdown",
  template: "Manuscript",
  text: ["TL:Highwater Too", "CC:A New Manuscript", "", "# Chapter One", "", "A new manuscript, created without Highland.", "", "A second paragraph."].join("\n"),
});
await writeBundle(join(outDir, "M1-New-Manuscript.highland"), manuscript);
console.log("wrote 3 files to", outDir);
