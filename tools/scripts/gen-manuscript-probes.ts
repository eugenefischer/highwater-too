/**
 * Writes the manuscript layout probes in fixtures/generated (M5): what Highland 2's Manuscript
 * template does at page bottoms, after lists, tables and directives, at the start of the text and
 * on the title page. Open each in Highland 2, export a PDF with default settings next to it, then
 * compare with `npm test`.
 *
 *   node --experimental-strip-types tools/scripts/gen-manuscript-probes.ts fixtures/generated
 */
import { createDocument, writeBundle } from "../../packages/bundle/src/index.ts";

const dir = process.argv[2] ?? "fixtures/generated";
const write = (name: string, text: string) => writeBundle(`${dir}/${name}.highland`, createDocument({ mode: "markdown", template: "Manuscript", text }));

const fillers = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} filler ${String(i + 1).padStart(2, "0")}.`).join("\n\n");
const long = (tag: string, words = 30) => `${tag} ` + Array.from({ length: words }, (_, i) => ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"][i % 6]).join(" ") + ".";

// Page-bottom cases: one per page. A page holds 22 lines, and a 23rd when it opens a paragraph.
const bottom = [
  `${fillers(21, "A")}\n\n* * *\n\nA: paragraph after a scene break on line 22.`,
  `${fillers(22, "B")}\n\n* * *\n\nB: paragraph after a scene break that would be on line 23.`,
  `${fillers(22, "C")}\n\n> ${long("C: quote that would start on line 23,", 12)}`,
  `${fillers(22, "D")}\n\n* D: list item that would be on line 23.\n* D: second item.`,
  `${fillers(22, "E")}\n\n\n\nE: paragraph after two extra empty lines from line 23.`,
  `${fillers(21, "F")}\n\n* * *\n\n${long("F: unindented paragraph whose first line would be on line 23,", 14)}`,
  `${fillers(19, "G")}\n\n> ${long("G: quote of five lines from line 20,", 40)}\n\nG: after the quote.`,
  `${fillers(22, "H")}\n\n| H | table |\n| --- | --- |\n| row | on 24 |`,
  `${fillers(22, "I")}\n\nI term :: definition that would be on line 23\nI second :: definition`,
  `${fillers(21, "P")}\n\n# P: heading on line 22\n\nP: paragraph that would open line 23.`,
];
// Layout cases: indentation after each kind of block, directive paragraphs in mid-text, headings.
const layout = [
  "J: a paragraph.\n\nJ: paragraph before a list.\n\n* item\n\nJ: paragraph after a list.\n\n1. item\n\nJ: after a numbered list.\n\nterm :: definition\n\nJ: after a term list.\n\n| a | b |\n| --- | --- |\n| c | d |\n\nJ: after a table.\n\nText>\n\nJ: after right-aligned text.\n\n[[only a note]]\n\nJ: after a note.\n\n= a synopsis\n\nJ: after a synopsis.\n\n[J]: https://example.com\n\nJ: after a link definition.",
  "K: a paragraph.\n\n{{FOOTER: K}}\n\nK: after a one-line directive paragraph.\n\n{{FOOTER: K}}\n{{HEADER: K %p}}\n\nK: after a two-line directive paragraph.\n\n{{FOOTER: K}}\n{{HEADER: K %p}}\n{{FOOTER: K2}}\n\nK: after a three-line directive paragraph.\nK: and a line joined to the paragraph.\n{{FOOTER: K3}}\nK: after a directive inside a paragraph.",
  `# ${long("L: a heading long enough to wrap onto a second line,", 8)}\n\nL: after a long heading.\n\n## L: second level\n### L: third level, straight after\n\nL: after two headings.\n\n#### L: fourth level\n\nL: **bold**, *italic*, ***bold italic***, _underlined_, ~~struck~~, +highlighted+.`,
  `M: lists.\n\n* one\n  * nested\n    * deeper\n* ${long("long item that wraps,", 20)}\n\n${Array.from({ length: 12 }, (_, i) => `${i + 1}. item ${i + 1}`).join("\n")}\n\n- ${long("dash item that wraps,", 20)}`,
  `N: tables and term lists.\n\n| Left | Centre | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n| ${long("a long cell", 8)} | b | c |\n\nshort :: ${long("a long definition that wraps,", 10)}\na much longer term than usual :: d\n\nN: after.`,
  "O: {{TOC: ##}} below lists second-level headings only.\n\n{{TOC: ##}}\n\nO: after the table of contents.",
];
const header = "{{HEADER: Probe / %# / %p of %pp}}\n\n";
await write("ManuscriptProbes", header + [...bottom, ...layout].join("\n\n===\n\n"));

// The start of the text: directive paragraphs, leading empty line, a heading without a title page.
await write("ManuscriptStart1", "{{HEADER: %p}}\n{{FOOTER: S1}}\n\nS1: two directive lines, no leading empty line, no title page.");
await write("ManuscriptStart2", "\n{{HEADER: %p}}\n{{FOOTER: S2}}\n\nS2: the same after a leading empty line.");
await write("ManuscriptStart3", `# Opening Heading\n\n${fillers(60, "S3")}\n\nS3: no title page and no header: where do page numbers go?`);

// Title pages: corners and centre with different line counts, and screenplay-style keys.
await write("ManuscriptTitle1", "TL: Top left\n\tsecond line\n\t\n\tfourth line\nTR: Top right\n\tsecond\nCC: Centre one\n\tCentre two\n\t\n\tCentre four\n\t\n\tCentre six\n\tCentre seven\nBL: Bottom left\n\tsecond\nBR: Bottom right\n\tsecond\n\nT1: body.");
await write("ManuscriptTitle2", "CC: Only a centre\n\nT2: body.");
await write("ManuscriptTitle3", "Title: Screenplay Keys\nCredit: by\nAuthor: Claude\nDraft date: 2026-10-11\nContact: someone@example.com\n\nT3: body.");
