import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { layoutManuscript, layoutScreenplay, MANUSCRIPT, manuscriptRtf, screenplayRtf, type RtfOptions } from "../src/index.ts";

const generated = fileURLToPath(new URL("../../../fixtures/generated/", import.meta.url));
const date = new Date(2026, 10, 20);
const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;
const bundle = (name: string) => HighlandBundle.fromZip(new Uint8Array(readFileSync(join(generated, name))));
const screenplay = (options: RtfOptions = {}) => screenplayRtf(parse(bundle("ScreenplayRTFProbe.highland").text, { mode: "fountain" }), { date, ...options });
const manuscript = (options: RtfOptions = {}) => {
  const b = bundle("ManuscriptRTFProbe.highland");
  return manuscriptRtf(parse(b.text, { mode: "markdown" }), { date, image: (src) => b.get(src) ?? null, ...options });
};
const sp = (text: string, options: RtfOptions = {}) => screenplayRtf(parse(text, { mode: "fountain" }), { date, ...options });
const ms = (text: string, options: RtfOptions = {}) => manuscriptRtf(parse(text, { mode: "markdown" }), { date, ...options });

/** Braces balance (escaped ones aside) and the file is one RTF group. */
function wellFormed(rtf: string): boolean {
  if (!rtf.startsWith("{\\rtf1")) return false;
  let depth = 0;
  const s = rtf.replace(/\\[\\{}]/g, "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0 && s.slice(i + 1).trim() !== "") return false;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** The paragraph (from \pard to \par) holding some text. */
const paragraph = (rtf: string, text: string) => rtf.split(/(?=\\pard)/).find((p) => p.includes(text)) ?? "";

describe("Rich Text export: screenplays", () => {
  it("writes well-formed RTF in Courier Prime on Letter paper", () => {
    const rtf = screenplay();
    expect(wellFormed(rtf)).toBe(true);
    expect(rtf).toContain("Courier Prime");
    expect(rtf).toContain("\\paperw12240\\paperh15840");
    expect(rtf).toMatch(/\\sl-240\\slmult0/);
  });

  it("puts each element at the template's indents (from a half-inch margin)", () => {
    const rtf = screenplay();
    expect(rtf).toContain("\\margl720");
    expect(paragraph(rtf, "Action with an inline")).toContain("\\li1440");
    expect(paragraph(rtf, "MARY")).toContain("\\li4260");
    expect(paragraph(rtf, "Dialogue that is long")).toContain("\\li2860");
    expect(paragraph(rtf, "CUT TO:")).toContain("\\qr");
    expect(paragraph(rtf, "CENTRED TEXT")).toContain("\\qc");
    expect(paragraph(rtf, "A lyric line")).toMatch(/\{\\i A lyric line\}/);
  });

  it("keeps every scene heading's own indent, numbered or not, after a page break too", () => {
    const rtf = screenplay();
    expect(paragraph(rtf, "INT. KITCHEN")).toMatch(/1\\tab \{\\b INT\. KITCHEN - DAY\}\\tab 1/);
    expect(paragraph(rtf, "FORCED SCENE HEADING")).toContain("\\li1440");
    expect(paragraph(rtf, "INT. HALL")).toContain("\\li1440");
    expect(paragraph(rtf, "INT. HALL")).toContain("\\pagebb");
    // No space above the first line of the script or of a page.
    expect(paragraph(rtf, "INT. KITCHEN")).not.toContain("\\sb");
    expect(paragraph(rtf, "INT. HALL")).not.toContain("\\sb");
  });

  it("sets dual dialogue side by side, each cue at its column's indent", () => {
    const rtf = screenplay();
    const row = rtf.slice(rtf.indexOf("\\trowd"), rtf.indexOf("\\row", rtf.indexOf("\\trowd")));
    expect(row).toMatch(/\\cellx\d+\\cellx\d+/);
    expect(row).toContain("Dual dialogue on the left.");
    expect(row).toContain("Dual dialogue on the right.");
    expect(row.match(/\\cell /g)?.length).toBe(2);
    // No negative indents: every speech inside its column.
    expect(row).not.toMatch(/\\(li|ri)-/);
  });

  it("adds the title page, the header and the footer", () => {
    const rtf = screenplay();
    expect(rtf.indexOf("RTF Export Probe")).toBeLessThan(rtf.indexOf("\\sect\\sectd"));
    expect(rtf).toContain("probe@example.com\\tab 2026-11-20");
    expect(rtf).toMatch(/\{\\header [^}]*RTF Probe/);
    expect(rtf).toMatch(/\{\\footer [^}]*Left footer/);
    expect(screenplay({ titlePage: false })).not.toContain("RTF Export Probe");
  });

  it("puts the header, footer and title page where the PDF does, not at the half-inch margin", () => {
    const rtf = screenplay();
    // Left at 1 in and right at 7.5 in from the paper's edge: indents from the 0.5 in margins.
    expect(rtf).toMatch(/\{\\header \\pard\\plain\\f0\\fs24\\li720\\ri480\\tqc\\tx5400\\tqr\\tx10080 /);
    expect(rtf).toMatch(/\{\\footer \\pard\\plain\\f0\\fs24\\li720\\ri480\\tqc\\tx5400\\tqr\\tx10080 /);
    expect(paragraph(rtf, "RTF Export Probe")).toContain("\\tqc\\tx5400");
    expect(paragraph(rtf, "probe@example.com")).toMatch(/\\tx720\\tqr\\tx10080 \\tab probe@example\.com\\tab 2026-11-20/);
  });

  it("leaves out notes, synopses and revision colours unless the print options ask for them", () => {
    const off = screenplay();
    expect(off).not.toContain("[[an inline note]]");
    expect(off).not.toContain("A note on its own line");
    expect(off).not.toContain("Synopsis of Act One");
    expect(off).not.toMatch(/\\red238\\green45\\blue54/);
    const on = screenplay({ print: { notes: true, synopses: true, revisionColor: true } });
    expect(on).toContain("[[an inline note]]");
    expect(on).toContain("[[A note on its own line.]]");
    expect(on).toContain("Synopsis of Act One.");
    expect(on).toMatch(/\\red238\\green45\\blue54/);
  });

  it("writes emphasis as RTF character styles", () => {
    const rtf = screenplay();
    expect(rtf).toContain("{\\b bold}");
    expect(rtf).toContain("{\\i italic}");
    expect(rtf).toContain("{\\b\\i bold italic}");
    expect(rtf).toContain("{\\ul underline}");
    expect(rtf).toContain("{\\strike strikethrough}");
    expect(rtf).toMatch(/\{\\chcbpat\d+\\cb\d+ highlight\}/);
  });

  it("follows the Document settings for scene heading spacing and synopses", () => {
    expect(paragraph(screenplay(), "EXT. GARDEN")).toContain("\\sb480");
    expect(paragraph(screenplay({ sceneHeadingDoubleSpaced: false }), "EXT. GARDEN")).toContain("\\sb240");
    expect(screenplay({ print: { synopses: true }, synopsesItalic: true })).toMatch(/\{\\i\\cf\d+ Synopsis of Act One\.\}/);
  });

  it("escapes RTF's special characters and anything past ASCII", () => {
    const rtf = sp("INT. CAFÉ - DAY\n\nA {brace} and a \\ backslash — “quoted” 😀.");
    expect(rtf).toContain("CAF\\u201?");
    expect(rtf).toContain("\\{brace\\}");
    expect(rtf).toContain("\\\\ backslash \\u8212? \\u8220?quoted\\u8221? \\u-10179?\\u-8704?.");
    expect(wellFormed(rtf)).toBe(true);
  });

  it("numbers pages from the second page of the script when there is no {{HEADER}}", () => {
    const rtf = sp("INT. ROOM - DAY\n\nAction.");
    expect(rtf).toContain("\\titlepg");
    expect(rtf).toMatch(/\{\\header [^]*PAGE[^]*\}\./);
  });
});

describe("Rich Text export: manuscripts", () => {
  it("writes well-formed RTF, double-spaced at Highland's pitch", () => {
    const rtf = manuscript();
    expect(wellFormed(rtf)).toBe(true);
    expect(rtf).toContain("\\margl1440\\margr1440");
    expect(paragraph(rtf, "A paragraph with")).toContain("\\sl-566");
  });

  it("indents a paragraph after a paragraph, not the first after a heading", () => {
    const rtf = manuscript();
    expect(paragraph(rtf, "A paragraph with {\\b bold}")).not.toContain("\\fi");
    expect(paragraph(rtf, "A paragraph with a")).toContain("\\fi720");
  });

  it("centres headings with heading styles, so %# can name the chapter", () => {
    const rtf = manuscript();
    expect(paragraph(rtf, "Chapter 1\\par")).toMatch(/\\s1.*\\qc|\\qc.*\\s1/);
    expect(paragraph(rtf, "A second-level heading\\par")).toContain("\\s2");
    expect(rtf).toMatch(/\{\\footer [^]*STYLEREF "heading 1"/);
  });

  it("keeps block quotes inside the right margin", () => {
    const p = paragraph(manuscript(), "A block quote");
    expect(p).toContain("\\li720");
    expect(p).not.toContain("\\ri");
  });

  it("writes lists with hanging markers and no blank lines between items", () => {
    const rtf = manuscript();
    expect(paragraph(rtf, "Bullet item one")).toMatch(/\\li1440\\ri1440\\fi-288.*\\u8226\?\\tab Bullet item one/);
    expect(paragraph(rtf, "A nested bullet item")).toContain("\\li1296");
    expect(paragraph(rtf, "Numbered item one")).toContain("1.\\tab Numbered item one");
    const between = rtf.slice(rtf.indexOf("Bullet item one"), rtf.indexOf("Bullet item two"));
    expect(between.match(/\\par\b/g)?.length).toBe(1);
  });

  it("sets term lists on tabs and tables as tables", () => {
    const rtf = manuscript();
    expect(paragraph(rtf, "Definition of the term")).toMatch(/\\tqr\\tx\d+\\tx\d+.*\\tab Term\\tab Definition of the term/);
    expect(rtf).not.toContain("::");
    expect(rtf).toMatch(/\\trowd[^]*Left\\cell [^]*Centre\\cell [^]*Right\\cell [^]*\\row/);
    expect(rtf).not.toContain("| Left");
  });

  it("keeps links' addresses", () => {
    const rtf = manuscript();
    expect(rtf).toContain('HYPERLINK "https://example.com"');
    expect(rtf).toContain('HYPERLINK "https://example.com/ref"');
  });

  it("writes the table of contents with page numbers, the image and the scene break", () => {
    const rtf = manuscript();
    expect(paragraph(rtf, "Chapter 2\\tab")).toMatch(/\\tqr\\tldot.*Chapter 2\\tab 3/);
    expect(rtf).toContain("\\pngblip");
    expect(paragraph(rtf, "#\\par")).toContain("\\qc");
    expect(paragraph(rtf, "A paragraph after a page break")).not.toContain("\\pagebb");
    expect(paragraph(rtf, "Chapter 2\\par")).toContain("\\pagebb");
  });

  it("adds the title page in its own section, TL and TR at the top and CC centred", () => {
    const rtf = manuscript();
    expect(rtf.indexOf("About 500 words")).toBeLessThan(rtf.indexOf("\\sect\\sectd"));
    expect(rtf).toContain("Claude\\tab About 500 words");
    expect(paragraph(rtf, "RTF Export Probe")).toContain("\\tqc\\tx4680");
    expect(manuscript({ titlePage: false })).not.toContain("About 500 words");
  });

  it("follows the print options for notes, synopses and revision colours", () => {
    expect(manuscript()).not.toContain("[[note]]");
    expect(manuscript()).not.toContain("A synopsis line.");
    const on = manuscript({ print: { notes: true, synopses: true, revisionColor: true } });
    expect(on).toContain("[[note]]");
    expect(on).toContain("A synopsis line.");
    expect(on).toMatch(/\\red238\\green45\\blue54/);
  });

  it("drops the first heading when there is no title page, as printed", () => {
    expect(paragraph(ms("# One\n\nText."), "One")).toContain("\\sb3840");
  });

  const soffice = (() => {
    try {
      execFileSync("soffice", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!soffice)("opens in LibreOffice with the expected pages", () => {
    const dir = mkdtempSync(join(tmpdir(), "rtf-"));
    for (const [name, rtf, pages] of [["screenplay", screenplay(), 3], ["manuscript", manuscript(), 4]] as const) {
      writeFileSync(join(dir, `${name}.rtf`), rtf);
      execFileSync("soffice", [`-env:UserInstallation=file://${dir}/lo`, "--headless", "--convert-to", "pdf", "--outdir", dir, join(dir, `${name}.rtf`)], { stdio: "ignore", timeout: 120_000 });
      const pdf = readFileSync(join(dir, `${name}.pdf`), "latin1");
      expect((pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length, name).toBe(pages);
    }
  }, 240_000);

  it.skipIf(!soffice || !priv)("comes within a few pages of the PDF in LibreOffice (EJ's files)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rtf-"));
    for (const file of ["SweetBetty_HighlandTest.highland", "ThePurityVariations_draft_1 copy.highland", "Astounding_date_EJ draft 2 copy.highland"]) {
      const b = HighlandBundle.fromZip(new Uint8Array(readFileSync(join(priv!, "Files with exports", file))));
      const md = b.mode === "markdown";
      const doc = parse(b.text, { mode: md ? "markdown" : "fountain" });
      const image = (src: string) => b.get(src) ?? null;
      const out = join(dir, file.replace(/\.highland$/, ".rtf"));
      writeFileSync(out, md ? manuscriptRtf(doc, { date, image }) : screenplayRtf(doc, { date }));
      execFileSync("soffice", [`-env:UserInstallation=file://${dir}/lo`, "--headless", "--convert-to", "pdf", "--outdir", dir, out], { stdio: "ignore", timeout: 120_000 });
      const pages = (readFileSync(out.replace(/\.rtf$/, ".pdf"), "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      const ours = (md ? layoutManuscript(doc, { date, image }) : layoutScreenplay(doc, { date })).pages.length;
      expect(Math.abs(pages - ours), `${file}: ${pages} pages in LibreOffice, ${ours} in our PDF`).toBeLessThanOrEqual(Math.ceil(ours * 0.06));
    }
  }, 240_000);

  const pdftotext = (() => {
    try {
      execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(!soffice || !pdftotext)("lands the header, footer, title page and first lines where the PDF puts them, in LibreOffice", () => {
    const dir = mkdtempSync(join(tmpdir(), "rtf-"));
    /** Each word's left edge, right edge and baseline (bottom less Courier Prime's 2.9 pt descent). */
    const words = (name: string, rtf: string, page: number) => {
      writeFileSync(join(dir, `${name}.rtf`), rtf);
      execFileSync("soffice", [`-env:UserInstallation=file://${dir}/lo`, "--headless", "--convert-to", "pdf", "--outdir", dir, join(dir, `${name}.rtf`)], { stdio: "ignore", timeout: 120_000 });
      const out = execFileSync("pdftotext", ["-bbox", "-f", String(page), "-l", String(page), join(dir, `${name}.pdf`), "-"], { encoding: "utf8" });
      return [...out.matchAll(/xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g)].map((m) => ({ left: +m[1]!, right: +m[2]!, y: +m[3]! - 2.9, text: m[4]! }));
    };
    const near = (a: number, b: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(1.5);
    const find = (ws: ReturnType<typeof words>, text: string) => ws.find((w) => w.text === text)!;
    const title = words("title", screenplay(), 1);
    near(find(title, "probe@example.com").left, 72);
    near(find(title, "probe@example.com").y, 716.6);
    near(find(title, "2026-11-20").right, 540);
    near((find(title, "RTF").left + find(title, "Probe").right) / 2, 306);
    near(find(title, "RTF").y, 241.4);
    near(find(title, "written").y, 313.4);
    const body = words("body", sp("{{HEADER: Head | %p}}\n{{FOOTER: Foot | | Right}}\n\nINT. ROOM - DAY\n\nAction."), 1);
    near(find(body, "Head").left, 72);
    near(find(body, "Head").y, 51);
    near(find(body, "1").right, 540);
    near(find(body, "Foot").y, 747);
    near(find(body, "Right").right, 540);
    near(find(body, "INT.").left, 108);
    near(find(body, "INT.").y, 81);
    const m = words("ms", ms("# One\n\nText.", { titlePage: false }), 1);
    near(find(m, "One").y, 90 + MANUSCRIPT.dropHeading);
    near(find(m, "Text.").left, 72);
  }, 240_000);
});
