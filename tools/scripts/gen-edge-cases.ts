/**
 * Writes the edge-case samples in fixtures/generated: ScreenplayEdgeCases.highland (with
 * IncludedScene.fountain) and ManuscriptEdgeCases.highland (with a test image). Filler lines are
 * counted so page-break cases land on chosen lines (screenplay: 54 content lines per page;
 * manuscript: about 23). Open each in Highland 2 and export a PDF next to it to compare.
 *
 *   node --experimental-strip-types tools/scripts/gen-edge-cases.ts fixtures/generated
 */
import { writeFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { createDocument, writeBundle } from "../../packages/bundle/src/index.ts";

const dir = process.argv[2] ?? "fixtures/generated";
const two = (k: number) => String(k).padStart(2, "0");

/** Action lines totalling exactly n lines, blank-separated as in a screenplay. */
function filler(zone: string, n: number): string {
  const paras: string[] = [];
  let k = 1;
  let lines = 0;
  while (lines < n) {
    const remaining = n - lines - (paras.length ? 1 : 0);
    if (remaining === 2) {
      paras.push(`Zone ${zone} filler ${two(k)}a.\nZone ${zone} filler ${two(k)}b.`);
      lines += 2 + (paras.length > 1 ? 1 : 0);
    } else {
      paras.push(`Zone ${zone} filler ${two(k)}.`);
      lines += 1 + (paras.length > 1 ? 1 : 0);
    }
    k++;
  }
  if (lines !== n) throw new Error(`zone ${zone}: ${lines} lines, not ${n}`);
  return paras.join("\n\n");
}

// ---------- Screenplay ----------
const screenplay = `Title: Screenplay Edge Cases
Credit: generated for testing by
Author: Claude
Draft date: 2026-10-09

{{HEADER: %# | %p}}
{{FOOTER: Left | Centre | Right}}

# Act One

= Synopsis: Act One sets up every special element.

INT. TEST KITCHEN - DAY #5#

[[Note: does this note print?]]

Brenda and Carl stand at the counter.

BRENDA
Are you coming?

CARL^
I'm already here.

BRENDA
(whispering)
Quiet.

CARL^
I will be quiet only once you explain to me why we are whispering in our own kitchen at noon.

@McCLANE
A forced character with lowercase letters.

!INT. THIS IS FORCED ACTION, NOT A SCENE HEADING

~This is a lyric line
~And this is another

{{INCLUDE: IncludedScene.fountain}}

===

${filler("A1", 51)}

INT. ZONE A1 HEADING ON SECOND-TO-LAST LINE - DAY

Action after the A1 heading.

===

${filler("A2", 52)}

INT. ZONE A2 HEADING ON LAST LINE - DAY

Action after the A2 heading.

===

${filler("B", 47)}

BRENDA
Dialogue line one.
Dialogue line two.
Dialogue line three.
Dialogue line four.
(beat)
Dialogue line five.
Dialogue line six.
Dialogue line seven.

===

${filler("C", 53)}

CUT TO:

INT. AFTER THE ZONE C TRANSITION - DAY

Action after the transition.

===

INT. ZONE D SCENE THAT RUNS ACROSS A PAGE BREAK - NIGHT

${filler("D", 81)}

# Act Two

= Synopsis: Act Two checks the section title in the header.

EXT. ACT TWO STREET - NIGHT

Carl walks alone.

CARL
That's the end of the test.`;

await writeBundle(`${dir}/ScreenplayEdgeCases.highland`, createDocument({ mode: "fountain", template: "Screenplay", text: screenplay }));
await writeFile(`${dir}/IncludedScene.fountain`, "INT. INCLUDED SCENE - DAY\n\nThis scene comes from an included file.");

// ---------- Manuscript ----------
const paragraphs = (zone: string, n: number) => Array.from({ length: n }, (_, i) => `Zone ${zone} filler paragraph ${two(i + 1)}.`).join("\n\n");

const manuscript = `TL:Claude
\tAI Generated Test Files
TR:About 900 words
CC:Manuscript Edge Cases
\t
\tby
\t
\tClaude

{{HEADER:|Claude / Manuscript Edge Cases / %p of %pp}}
{{FOOTER: %# | %p}}

{{TOC}}

# Chapter {{SERIES}}

This opening paragraph starts the first chapter of the manuscript test, long enough to wrap across more than one line so we can see the normal paragraph flow.

This second paragraph has _underline_, ~~strikethrough~~, +highlight+, a [[note that may not print]], an [inline link](https://highland2.app), and a [reference link][Highland].

[Highland]: https://highland2.app

> This block quote is deliberately long so that it wraps across at least four lines in the printed manuscript, which lets us measure its left indent, whether it has a right indent as well, how its lines are spaced, and whether the first line of the quote is indented like a normal paragraph or not at all.

This paragraph follows the long quote.

> This is the first paragraph of a two-paragraph block quote.
>
> This is the second paragraph of the same block quote.

This paragraph follows the two-paragraph quote.

* Star list item one
* Star list item two

- Dash list item one
- Dash list item two

1. Numbered item one
2. Numbered item two

Term :: Definition of the term
Another term :: Another definition

| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |

= A synopsis line that may not print.

![Test image](assets/test-image.png)

* * *

This paragraph follows a scene break.

===

${paragraphs("H1", 20)}

# Chapter {{SERIES}}

This chapter heading should land on the last line of its page.

{{PAGENUMBER: 10}}

===

${paragraphs("H2", 19)}

# Chapter {{SERIES}}

This chapter heading should land on the second-to-last line of its page. The page before it was numbered from 10 onwards.

This is the final paragraph of the manuscript test.`;

/** A w × h checkerboard PNG (20-pixel squares, blue and light grey). */
function png(w: number, h: number): Uint8Array {
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) rows.push(...((Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? [40, 120, 200] : [230, 230, 230]));
  }
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", new Uint8Array())]);
}

const ms = createDocument({ mode: "markdown", template: "Manuscript", text: manuscript });
ms.set("assets/test-image.png", png(200, 100));
await writeBundle(`${dir}/ManuscriptEdgeCases.highland`, ms);
console.log("ok");
