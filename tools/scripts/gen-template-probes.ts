/**
 * Writes the template probes (M10): one document per Highland 2 template other than Screenplay and
 * Manuscript, which have their own probes. The script templates (Multi-Cam, Stage Play, Graphic
 * Novel) share one Fountain text and the prose templates share one Markdown text, so differences
 * between their PDFs come from the template alone. Open each in Highland 2, check its template,
 * export a PDF with default settings next to it.
 *
 *   node --experimental-strip-types tools/scripts/gen-template-probes.ts <out-dir>
 */
import { mkdir } from "node:fs/promises";
import { createDocument, writeBundle, type DocumentMode } from "../../packages/bundle/src/index.ts";

const dir = process.argv[2] ?? "fixtures/generated/templates";
await mkdir(dir, { recursive: true });
const write = (name: string, mode: DocumentMode, template: string, text: string) => writeBundle(`${dir}/${name}.highland`, createDocument({ mode, template, text }));

const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa"];
/** n words of filler, ending with a full stop. */
const run = (n: number, from = 0) => Array.from({ length: n }, (_, i) => words[(from + i) % words.length]).join(" ") + ".";
/** A line whose first wrapped line is exactly n characters if the width allows it. */
const probe = (n: number) => `${"a".repeat(4)} ${"b".repeat(n - 5)} ${"c".repeat(24)}`;
const paren = (n: number) => `(${"a".repeat(4)} ${"b".repeat(n - 6)} ${"c".repeat(24)})`;
const range = (from: number, to: number, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

// ---- Scripts: Multi-Cam, Stage Play, Graphic Novel ---------------------------------------------

const scriptTitle = "Title: Template Probe\nCredit: written by\nAuthor: Claude\nSource: Based on nothing\nDraft date: 2026-10-19\nContact: probe@example.com";
const script = [
  // A: every element once. Action is lower case on purpose (Multi-Cam's Uppercase action option).
  `INT. COFFEE SHOP - DAY

A: the first action, in lower case, long enough to wrap onto a second line in every template.

MARY
Tell me why this is better.

TOM (V.O.)
(sitting across from her)
Well, it's plain text. It's non-proprietary and future-proof, and it wraps onto more lines.

MARY
So it has **bold**, *italics* and _underlines_.

CUT TO:

EXT. STREET - NIGHT #12#

A second scene, straight after a transition, with a scene number.

~These are lyrics, one line
~And a second line of lyrics

>THE END OF ACT ONE<

.PANEL ONE

A forced scene heading above.

!INT. THIS IS FORCED ACTION, NOT A SCENE HEADING.

@McCLANE
A forced character name with lower-case letters.

[[A note, not printed.]]

= A synopsis, not printed.

# Section one

## Section two

### Section three

After three sections (Graphic Novel prints headings as page labels).

> Forced transition.

INT. LAST SCENE OF A - DAY

The last action on this page.`,
  // B: several short scenes in a row (do scenes start new pages, or get letters?).
  ["INT. SCENE B1 - DAY", "INT. SCENE B2 - DAY", "EXT. SCENE B3 - NIGHT", "INT./EXT. SCENE B4 - DAWN"].map((h, i) => `${h}\n\nB${i + 1}: one line of action.\n\nBOB\nB${i + 1}: one line of dialogue.`).join("\n\n"),
  // C: wrap widths. Each probe's first line is n characters if the element is that wide.
  "INT. WIDTHS - DAY\n\nC: action widths 26 to 66.\n\n" + range(26, 66, 2).map(probe).join("\n\n"),
  "INT. WIDTHS - DAY\n\nC: dialogue widths 20 to 44.\n\nBOB\n" + range(20, 44).map(probe).join("\n"),
  "INT. WIDTHS - DAY\n\nC: parenthetical widths 16 to 40.\n\nBOB\n" + range(16, 40).map((n) => `${paren(n)}\nLine ${n}.`).join("\n"),
  // D: page capacity and splitting.
  "INT. CAPACITY - DAY\n\n" + range(1, 70).map((n) => `D action ${String(n).padStart(2, "0")}.`).join("\n\n"),
  "INT. CAPACITY - DAY\n\n" + range(1, 40).map((n) => `${n % 2 ? "BOB" : "ALICE"}\nD line ${String(n).padStart(2, "0")}.`).join("\n\n"),
  "INT. LONG SPEECH - DAY\n\nE: one speech of many sentences, to see how it splits across pages.\n\nBOB\n" + range(0, 40).map((i) => `Sentence ${i + 1} is ${run(6, i)}`).join(" "),
  "INT. LONG ACTION - DAY\n\n" + range(0, 50).map((i) => `Sentence ${i + 1} is ${run(7, i)}`).join(" "),
  // F: dual dialogue.
  `INT. DUAL - DAY

F: dual dialogue.

BOB
(quietly)
${run(14)}

ALICE ^
(loudly)
${run(10, 3)}`,
  // G: header and footer, and their effect on page capacity.
  "{{HEADER: Probe header | %p of %pp}}\n{{FOOTER: Probe footer %p}}\n\nINT. HEADER AND FOOTER - DAY\n\n" + range(1, 70).map((n) => `G action ${String(n).padStart(2, "0")}.`).join("\n\n"),
].join("\n\n===\n\n");

for (const [name, template] of [["MultiCamProbe", "Multi-Cam"], ["StagePlayProbe", "Stage Play"], ["GraphicNovelProbe", "Graphic Novel"]] as const) {
  await write(name, "fountain", template, `${scriptTitle}\n\n${script}`);
}

// ---- Prose: Novel, Treatment, Modern Standard, Article, Bulletin, Speech, MLA Report, Wiki -----

// Several candidate title keys: which ones each template prints, and where (MLA's header, Article's byline).
const proseTitle = "Title: Template Probe\nCredit: by\nAuthor: Claude Probe\nSource: Based on nothing\nDraft date: 2026-10-19\nDate: 19 October 2026\nContact: probe@example.com\nInstructor: Instructor Value\nProfessor: Professor Value\nCourse: Course Value\nClass: Class Value";
const prose = [
  // A: every block once.
  `# Heading One

A: the first paragraph after a heading. ${run(50)}

The second paragraph, after a paragraph. ${run(50, 5)}

The third paragraph has **bold**, *italic*, ***bold italic***, _underline_, ~~strike~~, +highlight+, an [inline link](https://example.com) and a [reference link][ref].

[ref]: https://example.com/reference

## Heading Two

### Heading Three

#### Heading Four

##### Heading Five

###### Heading Six

After six headings in a row.

> A block quote, long enough to wrap onto several lines. ${run(30)}
> - An attribution line

> A second quote paragraph.

* A bullet item.
* A bullet item long enough to wrap onto a second line. ${run(20)}
  * A nested item.
    * A deeper item.
- A dash item.
+ A plus item.

1. A numbered item.
2. A numbered item long enough to wrap onto a second line. ${run(20)}
3. The third item.

term :: definition
a much longer term :: a definition long enough to wrap onto a second line. ${run(15)}

| Left | Centre | Right |
| :--- | :---: | ---: |
| a | b | c |
| a cell long enough to wrap ${run(8)} | b | c |

* * *

A paragraph after a scene break.

Right-aligned text>

>Centred text<

[[A note, not printed.]]

= A synopsis, not printed.

The last paragraph of section A.`,
  // B: series, table of contents, page numbering.
  "{{TOC}}\n\n## Chapter {{SERIES}}\n\nB: first numbered chapter.\n\n## Chapter {{SERIES}}\n\nB: second numbered chapter.\n\n## Chapter {{SERIES}}\n\nB: third numbered chapter.",
  // C: page capacity: one-line paragraphs, then the same as hard line breaks in one paragraph.
  "## Capacity\n\n" + range(1, 60).map((n) => `C paragraph ${String(n).padStart(2, "0")}.`).join("\n\n"),
  "## Capacity, single lines\n\n" + range(1, 60).map((n) => `C line ${String(n).padStart(2, "0")}.`).join("\n"),
  // D: one long paragraph across pages (splitting, widows).
  "## Long paragraph\n\n" + range(0, 80).map((i) => `Sentence ${i + 1} is ${run(8, i)}`).join(" "),
  // E: wrap widths in characters (for monospaced bodies; proportional ones still show the measure).
  "## Widths\n\n" + range(40, 100, 4).map(probe).join("\n\n"),
  // F: header and footer.
  "{{HEADER: Probe header | %p of %pp}}\n{{FOOTER: Probe footer %#}}\n\n## Header and footer\n\n" + range(1, 60).map((n) => `F paragraph ${String(n).padStart(2, "0")}.`).join("\n\n"),
].join("\n\n===\n\n");

for (const [name, template] of [
  ["NovelProbe", "Novel"],
  ["TreatmentProbe", "Treatment"],
  ["ModernStandardProbe", "Modern Standard"],
  ["ArticleProbe", "Article"],
  ["BulletinProbe", "Bulletin"],
  ["SpeechProbe", "Speech"],
  ["MLAReportProbe", "MLA Report"],
  ["WikiProbe", "Wiki"],
] as const) {
  await write(name, "markdown", template, `${proseTitle}\n\n${prose}`);
}

// ---- Plain Text: markup prints as typed --------------------------------------------------------

const plain = [
  `${scriptTitle}

{{HEADER: Is this printed? %p}}

# A heading, **bold** and *italic*

INT. A SCENE HEADING - DAY

BOB
Dialogue as typed.

> a quote
* a list item
[[a note]]
= a synopsis

A: ${run(60)}`,
  "B: line widths 50 to 100.\n\n" + range(50, 100, 2).map(probe).join("\n\n"),
  range(1, 80).map((n) => `C line ${String(n).padStart(2, "0")}.`).join("\n"),
  range(1, 50).map((n) => `D paragraph ${String(n).padStart(2, "0")}.`).join("\n\n"),
].join("\n\n===\n\n");
await write("PlainTextProbe", "plain", "Plain Text", plain);
