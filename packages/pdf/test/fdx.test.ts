import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HighlandBundle } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { fdColor, fdxToFountain, screenplayFdx } from "../src/index.ts";
import { childElements, firstChild, parseXml, textContent, type XmlElement } from "../src/xml.ts";

/** Each paragraph of an .fdx file's script as "Type|attrs|text", runs as [style/revision]text. */
function paragraphs(xml: string): string[] {
  const out: string[] = [];
  const para = (p: XmlElement, pre = "") => {
    // Highland writes <DualDialogue> straight into <Content>; Final Draft wraps it in a paragraph.
    const dual = p.name === "DualDialogue" ? p : firstChild(p, "DualDialogue");
    if (dual) {
      out.push(`${pre}DualDialogue`);
      for (const q of childElements(dual, "Paragraph")) para(q, `${pre}  `);
      return;
    }
    const attrs = Object.entries(p.attrs)
      .filter(([k]) => k !== "Type")
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const runs = childElements(p)
      .map((c) => (c.name === "ScriptNote" ? `[[${textContent(c).trim()}]]` : c.name === "Text" ? (c.attrs.Style || c.attrs.RevisionID ? `[${[c.attrs.Style, c.attrs.RevisionID && `R${c.attrs.RevisionID}`].filter(Boolean).join("/")}]` : "") + textContent(c) : ""))
      .join("");
    out.push(`${pre}${p.attrs.Type}|${attrs}|${runs}`);
  };
  for (const p of childElements(firstChild(parseXml(xml), "Content")!)) para(p);
  return out;
}

const fdx = (text: string) => screenplayFdx(parse(text, { mode: "fountain" }), { date: new Date(2026, 8, 28) });

describe("Final Draft export", () => {
  it("writes each element as Highland does", () => {
    const text = [
      "INT. COFFEE SHOP - DAY",
      "",
      "Action with **bold**, *italics* and _underlines_.",
      "",
      "MARY (V.O.)",
      "(quietly)",
      "First line.",
      "Second line.",
      "",
      "CUT TO:",
      "",
      "EXT. STREET - NIGHT #12#",
      "",
      "~A lyric",
      "~And another",
      "",
      ">THE END<",
      "",
      "!INT. FORCED ACTION.",
      "",
      "@McCLANE",
      "Yippee.",
      "",
      "> Forced transition.",
    ].join("\n");
    expect(paragraphs(fdx(text))).toEqual([
      "Scene Heading||[Bold]INT. COFFEE SHOP - DAY",
      "Action||Action with [Bold]bold, [Italic]italics and [Underline]underlines.",
      "Character||MARY (V.O.)",
      "Parenthetical||(quietly)",
      "Dialogue||First line.",
      "Dialogue||Second line.",
      "Transition||CUT TO:",
      // No space left where the scene number was (Highland leaves one).
      "Scene Heading|Number=12|[Bold]EXT. STREET - NIGHT",
      "Action||[Italic]A lyric\n[Italic]And another",
      "Action|Alignment=Center|THE END",
      "Action||INT. FORCED ACTION.",
      "Character||McCLANE",
      "Dialogue||Yippee.",
      "Transition||FORCED TRANSITION.",
    ]);
  });

  it("follows the scene heading settings", () => {
    const xml = screenplayFdx(parse("INT. HOUSE - DAY\n", { mode: "fountain" }), { sceneHeadingBold: false, sceneHeadingUnderline: true });
    expect(paragraphs(xml)).toEqual(["Scene Heading||[Underline]INT. HOUSE - DAY"]);
  });

  it("keeps notes and synopses as notes, and leaves out sections and directives", () => {
    const text = [
      "{{HEADER: %p}}",
      "",
      "# Act One",
      "",
      "= A synopsis.",
      "",
      "INT. LIGHTHOUSE - NIGHT",
      "",
      "[[An own-line note.]]",
      "",
      "Mara opens the logbook. [[Inline note.]] The pages are wet.",
      "",
      "===",
      "",
      "INT. STAIRS - NIGHT",
    ].join("\n");
    expect(paragraphs(fdx(text))).toEqual([
      "General||[[A synopsis.]]",
      "Scene Heading||[Bold]INT. LIGHTHOUSE - NIGHT",
      "General||[[An own-line note.]]",
      "Action||Mara opens the logbook. [[Inline note.]] The pages are wet.",
      "Scene Heading|StartsNewPage=Yes|[Bold]INT. STAIRS - NIGHT",
    ]);
  });

  it("wraps dual dialogue in a General paragraph, as Final Draft does", () => {
    const xml = fdx("BRENDA\nAre you coming?\n\nCARL ^\nI'm here.\n");
    expect(paragraphs(xml)).toEqual(["DualDialogue", "  Character||BRENDA", "  Dialogue||Are you coming?", "  Character||CARL", "  Dialogue||I'm here."]);
    expect(xml).toContain(`<Paragraph Type="General">\n            <DualDialogue>`);
  });

  it("gives each revision colour a revision set of its own", () => {
    const text = [
      "{{REVISION: #ee2d36}}A red revision.{{/REVISION}}",
      "",
      "Mara turns a page. {{REVISION: #07a04a}}Green words.{{/REVISION}} The rest is not.",
      "",
      "{{REVISION}}A bare revision.{{/REVISION}}",
      "",
      "{{REVISION: #ee2d36}}MARA",
      "Red again.{{/REVISION}}",
    ].join("\n");
    const xml = fdx(text);
    expect(paragraphs(xml)).toEqual(["Action||[R1]A red revision.", "Action||Mara turns a page. [R2]Green words. The rest is not.", "Action||[R3]A bare revision.", "Character||[R1]MARA", "Dialogue||[R1]Red again."]);
    const sets = childElements(firstChild(parseXml(xml), "Revisions")!, "Revision").map((r) => [r.attrs.ID, r.attrs.Color]);
    expect(sets).toEqual([
      ["1", "#EEEE2D2D3636"],
      ["2", "#0707A0A04A4A"],
      ["3", "#000000000000"],
    ]);
  });

  it("lays out the title page on Highland's lines", () => {
    const text = "Title: Template Probe\nCredit: written by\nAuthor: Claude\nSource: Based on nothing\nDraft date: 2026-10-19\nContact: probe@example.com\n\nINT. HOUSE - DAY\n";
    const tp = childElements(firstChild(firstChild(parseXml(fdx(text)), "TitlePage")!, "Content")!, "Paragraph");
    expect(tp).toHaveLength(50);
    const filled = tp.map((p, k) => [k, p.attrs.Alignment, textContent(p).trim()]).filter(([, , t]) => t);
    expect(filled).toEqual([
      [15, "Center", "Template Probe"],
      [19, "Center", "written by"],
      [21, "Center", "Claude"],
      [26, "Center", "Based on nothing"],
      [42, "Left", "probe@example.com"],
      [45, "Right", "2026-10-19"],
    ]);
  });

  it("writes Final Draft's colours", () => {
    expect(fdColor("#ee2d36")).toBe("#EEEE2D2D3636");
    expect(fdColor("#abc")).toBe("#AAAABBBBCCCC");
  });
});

/** A Final Draft file around some paragraphs. */
const fd = (content: string, rest = "") => `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="4">\n<Content>\n${content}\n</Content>\n${rest}</FinalDraft>\n`;
const p = (type: string, text: string, attrs = "") => `<Paragraph Type="${type}"${attrs}><Text>${text}</Text></Paragraph>`;

describe("Final Draft import", () => {
  it("converts each element, in capitals where Final Draft shows them", () => {
    const xml = fd(
      [
        `<Paragraph Number="1" Type="Scene Heading"><SceneProperties Length="1/8" Page="1" Title=""/><Text>Int. Coffee shop - day   </Text></Paragraph>`,
        p("Action", "She waits.  "),
        p("Character", "Mary"),
        p("Parenthetical", "(quietly)"),
        p("Dialogue", "Line one.\nLine two."),
        p("Transition", "Cut to:"),
        p("Transition", "Smash cut"),
        p("Action", "THE END", ` Alignment="Center"`),
      ].join("\n"),
    );
    expect(fdxToFountain(xml)).toBe(["INT. COFFEE SHOP - DAY #1#", "", "She waits.", "", "MARY", "(quietly)", "Line one.", "Line two.", "", "CUT TO:", "", ">SMASH CUT", "", ">THE END<", ""].join("\n"));
  });

  it("marks emphasis once per run of one style, never around spaces alone", () => {
    const xml = fd(
      `<Paragraph Type="Action"><Text Style="Italic">I’m here.</Text><Text Style="Italic"> Really. </Text><Text>Then </Text><Text Style="Bold"> </Text><Text>bold </Text><Text Style="Bold+Underline">and under</Text><Text>.</Text></Paragraph>\n` +
        `<Paragraph Type="Scene Heading"><Text>Int. </Text><Text Style="Italic">The Nautilus</Text><Text> - bridge - night</Text></Paragraph>`,
    );
    expect(fdxToFountain(xml)).toBe("*I’m here. Really.* Then  bold _**and under**_.\n\nINT. *THE NAUTILUS* - BRIDGE - NIGHT\n");
  });

  it("keeps dual dialogue", () => {
    const dual = `<Paragraph Type="General"><DualDialogue>${p("Character", "Bob")}${p("Dialogue", "Hi.")}${p("Character", "Alice")}${p("Dialogue", "Hello.")}</DualDialogue><Text></Text></Paragraph>`;
    expect(fdxToFountain(fd(dual))).toBe("BOB\nHi.\n\nALICE ^\nHello.\n");
  });

  it("turns revisions into revision tags, notes into notes", () => {
    const xml = fd(
      `<Paragraph Type="Action"><Text RevisionID="0">Plain, </Text><Text RevisionID="1">blue, </Text><Text RevisionID="2">red.</Text></Paragraph>\n` +
        `<Paragraph Type="Dialogue"><Text>stray</Text></Paragraph>\n` +
        `<Paragraph Type="Action"><Text>A note </Text><ScriptNote><Paragraph><Text>check this</Text></Paragraph></ScriptNote><Text> here.</Text></Paragraph>`,
      `<Revisions ActiveSet="2"><Revision Color="#000000000000" ID="1" Name="Blue Rev." PageColor="#C6C6EDEDFEFE"/><Revision Color="#EEEE2D2D3636" ID="2" Name="Red" PageColor="#FFFFFFFFFFFF"/></Revisions>\n` +
        `<UnanchoredScriptNotes><ScriptNote><Paragraph><Text>Loose note.</Text></Paragraph></ScriptNote></UnanchoredScriptNotes>\n`,
    );
    expect(fdxToFountain(xml)).toBe("Plain, {{REVISION: #008ecc}}blue, {{/REVISION}}{{REVISION: #ee2d36}}red.{{/REVISION}}\n\nstray\n\nA note [[check this]] here.\n\n[[Loose note.]]\n");
  });

  it("forces what Fountain would read as something else", () => {
    const xml = fd([p("Action", "BANG!\nThe door flies open."), p("Scene Heading", "Somewhere strange"), p("Shot", "Close on the door"), p("Action", "INT. is not a heading here"), `<Paragraph Type="New Act"><Text>Act two</Text></Paragraph>`].join("\n"));
    expect(fdxToFountain(xml)).toBe("!BANG!\nThe door flies open.\n\n.SOMEWHERE STRANGE\n\n.CLOSE ON THE DOOR\n\n!INT. is not a heading here\n\n>ACT TWO<\n");
  });

  it("escapes characters Fountain reads as emphasis", () => {
    expect(fdxToFountain(fd(p("Action", "2*3 = 6, snake_case")))).toBe("2\\*3 = 6, snake\\_case\n");
  });

  it("reads the title page: title, credit, author, source, draft date and contact", () => {
    const line = (align: string, text: string) => `<Paragraph Alignment="${align}"><Text>${text}</Text></Paragraph>`;
    const tp = `<TitlePage><Content>${[
      line("Center", ""),
      `<Paragraph Alignment="Center"><Text Style="Underline+AllCaps">The Big Show</Text></Paragraph>`,
      line("Center", ""),
      line("Center", "Written by"),
      line("Center", ""),
      line("Center", "Jo Writer"),
      line("Center", ""),
      line("Center", "Story by"),
      line("Center", "Someone Else"),
      line("Right", "Draft 2"),
      line("Full", "jo@example.com"),
      line("Full", "555 0100"),
    ].join("")}</Content></TitlePage>\n`;
    expect(fdxToFountain(fd(p("Action", "Hi."), tp))).toBe(
      "Title: _THE BIG SHOW_\nCredit: Written by\nAuthor: Jo Writer\nSource:\n\tStory by\n\tSomeone Else\nDraft date: Draft 2\nContact:\n\tjo@example.com\n\t555 0100\n\nHi.\n",
    );
  });

  it("refuses a file that isn't Final Draft's", () => {
    expect(() => fdxToFountain("<html><body/></html>")).toThrow(/not a Final Draft/);
  });
});

describe("Final Draft round trip", () => {
  it("brings a script back as it was", () => {
    const text = [
      "Title: Round Trip",
      "Author: Claude",
      "",
      "INT. HOUSE - DAY #3#",
      "",
      "Action with *italics* and a [[note]].",
      "",
      "BOB",
      "(beat)",
      "{{REVISION: #ee2d36}}Words.{{/REVISION}}",
      "",
      "ALICE ^",
      "More words.",
      "",
      "CUT TO:",
      "",
      ">CENTRED<",
      "",
    ].join("\n");
    expect(fdxToFountain(fdx(text))).toBe(text);
  });
});

const priv = process.env.HIGHWATER_PRIVATE_FIXTURES;

describe.skipIf(!priv)("Final Draft files (private fixtures)", () => {
  const script = (path: string) => HighlandBundle.fromZip(new Uint8Array(readFileSync(join(priv!, path)))).text;

  it("exports each probe as Highland does, except Highland's bugs", () => {
    for (const name of ["Template Probes/ScreenplayProbe", "Print Option Probes/ScreenplayPrintProbe", "Files with exports/Astounding_date_EJ draft 2 copy"]) {
      // Highland's, without its bugs: directives written as text, trailing spaces (and the one a
      // scene number leaves), every revision in set 1; a page break moves to the next paragraph.
      const tidy = (l: string) => l.replace(/ +(?=\n|$)/g, "").replace(/\[R\d+\]/g, "[R]").replace(/StartsNewPage=Yes/, "");
      const highland = paragraphs(readFileSync(join(priv!, `${name}.fdx`), "utf8"))
        .filter((l) => !/^General\|[^|]*\|\{\{/.test(l))
        .map(tidy);
      // Ours, without the own-line notes Highland drops.
      const ours = paragraphs(fdx(script(`${name}.highland`)))
        .map(tidy)
        .filter((l) => !/^General\|\|\[\[/.test(l) || highland.includes(l));
      expect(ours).toEqual(highland);
    }
  });

  it("imports a Final Draft 2020 script with every scene, speech and transition", () => {
    const xml = readFileSync(join(priv!, "11.25.2020-Final-Pass-EJ.fdx"), "utf8");
    const doc = parse(fdxToFountain(xml), { mode: "fountain" });
    const count = (kind: string) => doc.elements.filter((e) => e.kind === kind).length;
    const types = paragraphs(xml).map((l) => l.trim().split("|")[0]);
    expect(count("sceneHeading")).toBe(types.filter((t) => t === "Scene Heading").length);
    expect(count("dialogue")).toBe(types.filter((t) => t === "Character").length);
    expect(count("transition")).toBe(types.filter((t) => t === "Transition").length);
    expect(doc.elements.filter((e) => e.kind === "dialogue" && e.dual === "right")).toHaveLength(2);
  });
});
