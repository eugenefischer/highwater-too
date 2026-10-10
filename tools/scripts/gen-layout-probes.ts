/**
 * Writes the screenplay layout probes in fixtures/generated (M4): FirstLineTests.highland
 * (first-line rules, mid-page directives, parenthetical and dual-dialogue widths) and the three
 * StartTest files (what makes Astounding start on line 4). Open each in Highland 2, export a PDF
 * with default settings next to it, then compare with `npm test`.
 *
 *   node --experimental-strip-types tools/scripts/gen-layout-probes.ts fixtures/generated
 */
import { createDocument, writeBundle } from "../../packages/bundle/src/index.ts";

const dir = process.argv[2] ?? "fixtures/generated";
const write = (name: string, text: string) => writeBundle(`${dir}/${name}.highland`, createDocument({ mode: "fountain", template: "Screenplay", text }));

/** A line whose first wrapped line is exactly n characters if the width allows it. */
const probe = (n: number) => `${"a".repeat(4)} ${"b".repeat(n - 5)} ${"c".repeat(24)}`;
const paren = (n: number) => `(${"a".repeat(4)} ${"b".repeat(n - 6)} ${"c".repeat(24)})`;
const widths = [26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
const dualParens = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
const cases = [
  "{{HEADER: %p}}\n\nINT. CASE A - DAY\n\nA: one directive, then a scene heading.",
  "{{FOOTER: B}}\n{{HEADER: %p}}\n\nINT. CASE B - DAY\n\nB: two directive lines in one paragraph.",
  "{{HEADER: %p}}\n\n{{FOOTER: C}}\n\nINT. CASE C - DAY\n\nC: two directive paragraphs.",
  "{{HEADER: %p}}\n\n# Section D\n\nINT. CASE D - DAY\n\nD: directive, section, scene heading.",
  "{{HEADER: %p}}\n\n= Synopsis E\n\nINT. CASE E - DAY\n\nE: directive, synopsis, scene heading.",
  "# Section F\n\nINT. CASE F - DAY\n\nF: section, scene heading.",
  "{{HEADER: %p}}\n\nG: directive, then action.",
  "{{HEADER: %p}}\n\nBOB\nH: directive, then dialogue.",
  "[[A note]]\n\nINT. CASE I - DAY\n\nI: note, scene heading.",
  "{{HEADER: %p}}\n{{FOOTER: J}}\n\n# Section J\n\n= Synopsis J\n\nINT. CASE J - DAY\n\nJ: like the edge-case sample.",
  "{{HEADER: %p}}\n\nINT. CASE A2 - DAY\n\nA2: case A again, after a page break.",
  "Action K1.\n\n{{FOOTER: K}}\n\nK2: action after a directive in mid-page.\n\n{{FOOTER: K}}\n\nINT. CASE K - DAY\n\nK3: scene heading after a directive in mid-page.",
  "L: parenthetical widths 26 to 35.\n\nBOB\n" + widths.map((n) => `${paren(n)}\nLine ${n}.`).join("\n"),
  "M: dual dialogue widths 26 to 35, left column.\n\nBOB\n" + widths.map(probe).join("\n") + "\n\nALICE^\nShort.",
  "N: dual dialogue widths 26 to 35, right column.\n\nBOB\nShort.\n\nALICE^\n" + widths.map(probe).join("\n"),
  "O: dual dialogue parentheticals 20 to 29.\n\nBOB\n" + dualParens.map((n) => `${paren(n)}\nL${n}.`).join("\n") + "\n\nALICE^\n" + dualParens.map((n) => `${paren(n)}\nR${n}.`).join("\n"),
];
await write("FirstLineTests", "Title: First Line Tests\nAuthor: Claude\n\n" + cases.join("\n\n===\n\n"));

const plainTitle = "Title: Start Test\nCredit: by\nAuthor: Claude\nDraft date: 2026-10-11";
const tabTitle = "Title:\n\tSTART TEST\n\t\n\tSubtitle\nCredit: by\nAuthor: Claude\nSource:\n\tBased on nothing\n\t\n\tby nobody\nDraft date: 2026-10-11";
const body = "{{HEADER: %p}}\n\nINT. FIRST SCENE - DAY\n\nThe first action.";
await write("StartTest1-LeadingBlankLine", "\n" + plainTitle + "\n\n" + body);
await write("StartTest2-TabBlankLines", tabTitle + "\n\n" + body);
await write("StartTest3-Both", "\n" + tabTitle + "\n\n" + body);

// SpeechFitTests (M4): which speeches may end on the page's last line (55). Each page fills lines
// 1..(cue - 2) with one action paragraph, leaves a blank, then a speech of k lines whose last line
// lands on line 55 (or 54 for the controls). Single sentence vs one sentence per line.
const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa"];
/** One sentence: k lines of words, a full stop only at the end (each line under 34 characters). */
const oneSentence = (k: number) => Array.from({ length: k }, (_, i) => `${words[(i * 5) % 16]} ${words[(i * 5 + 1) % 16]} ${words[(i * 5 + 2) % 16]} ${words[(i * 5 + 3) % 16]}`).join(" and ") + ".";
/** k sentences of exactly 30 characters, so each wraps onto its own line. */
const sentences = (k: number) => Array.from({ length: k }, (_, i) => `Sentence number ${["one", "two", "six", "ten"][i % 4]} ends here.`).join(" ");
const fill = (lines: number) => Array.from({ length: lines }, (_, i) => `Filler line ${i + 1}.`).join("\n");
const fitCases: string[] = [];
for (const [k, end] of [[1, 55], [2, 55], [3, 55], [4, 55], [5, 55], [6, 55], [2, 54], [3, 54]] as const) {
  const cue = end - k;
  for (const [kind, text] of [["one sentence", oneSentence(k)], ["one sentence per line", sentences(k)]] as const) {
    if (k === 1 && kind === "one sentence per line") continue;
    fitCases.push(`${fill(cue - 2)}\n\nBOB\n${text}\n\n[[Case: ${k} lines, ${kind}, cue on line ${cue}, last line on ${end}]]`);
  }
}
fitCases.push(`${fill(52)}\n\nAction of two lines.\nSecond line on fifty-five.`);
fitCases.push(`${fill(51)}\n\nAction of three lines.\nSecond line.\nThird line on fifty-five.`);
await write("SpeechFitTests", "Title: Speech Fit Tests\nAuthor: Claude\n\n" + fitCases.join("\n\n===\n\n"));
