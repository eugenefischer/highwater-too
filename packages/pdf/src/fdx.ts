import { inlineText, seriesCounter, type Document, type Element, type Inline, type TitleField } from "@highwater/parser";
import { sameParagraph, styledValue } from "./screenplay.ts";
import { marked, onlyNotes, printContext, toRuns, type InlineContext, type PrintContext } from "./text.ts";
import type { TextStyle } from "./types.ts";

/**
 * A screenplay as a Final Draft (.fdx) file, as Highland 2 writes one (its exports of
 * ScreenplayProbe, ScreenplayEdgeCases, ScreenplayPrintProbe and Astounding), with Highland's
 * bugs fixed: directives are not written out as text, own-line notes are kept as notes, the scene
 * heading keeps no trailing space where its number was, dual dialogue is wrapped in a General
 * paragraph as Final Draft writes it, and each revision colour gets a revision set of its own.
 */
export interface FdxOptions {
  /** The elements to write, with {{INCLUDE}} files merged in; default the document's own. */
  elements?: FdxElement[];
  /** For {{TIMESTAMP}}. */
  date?: Date;
  /** The Document settings' scene heading look (Highland writes it as text style); default bold, not underlined. */
  sceneHeadingBold?: boolean;
  sceneHeadingUnderline?: boolean;
  /** False: no title page. */
  titlePage?: boolean;
}

export interface FdxElement {
  element: Element;
  /** The text the element's spans refer to. */
  source: string;
  /** From the script itself (revisions are kept); false for an included file. */
  own: boolean;
}

type Piece = { kind: "text"; text: string; style: TextStyle } | { kind: "note"; text: string };

interface Para {
  type: string;
  attrs?: Record<string, string>;
  pieces: Piece[];
}

export function screenplayFdx(doc: Document, options: FdxOptions = {}): string {
  const elements = options.elements ?? doc.elements.map((element) => ({ element, source: doc.source, own: true }));
  const base = printContext(doc, { revisionColor: true, revisionStars: true })!;
  const ctx: InlineContext = { series: seriesCounter(), date: options.date ?? new Date() };
  const revisions = new Revisions();
  const look: TextStyle = { ...(options.sceneHeadingBold !== false ? { bold: true } : {}), ...(options.sceneHeadingUnderline ? { underline: true } : {}) };

  const out: string[] = [];
  let newPage = false;
  const emit = (xml: (attrs: string) => string) => {
    out.push(xml(newPage ? ` StartsNewPage="Yes"` : ""));
    newPage = false;
  };
  const para = (p: Para, indent = "        ") => emit((extra) => paragraphXml(p, extra, indent, revisions));

  for (let i = 0; i < elements.length; i++) {
    const { element: e, source, own } = elements[i]!;
    const print: PrintContext = { ...base, own };
    const c: InlineContext = { ...ctx, print };
    const sameAs = (k: number, kind: Element["kind"]) => {
      const n = elements[k];
      return !!n && n.element.kind === kind && n.source === source && sameParagraph(source, elements[k - 1]!.element, n.element);
    };
    switch (e.kind) {
      case "sceneHeading":
        para({ type: "Scene Heading", ...(e.sceneNumber ? { attrs: { Number: e.sceneNumber.text } } : {}), pieces: trim(pieces(e.inline, c, look)) });
        break;
      case "action": {
        if (onlyNotes(e.inline)) {
          // An own-line note: a note of its own, as a synopsis is.
          const notes = e.inline.filter((n) => n.kind === "note").map((n): Piece => ({ kind: "note", text: n.text }));
          para({ type: "General", pieces: notes });
          break;
        }
        const ps = pieces(e.inline, c);
        if (ps.some((p) => p.kind === "note" || p.text.trim() !== "")) para({ type: "Action", pieces: ps });
        break;
      }
      case "lyric":
      case "centered":
      case "rightAligned": {
        // Consecutive lines of one paragraph are one paragraph, lines joined by a line break.
        const style: TextStyle = e.kind === "lyric" ? { italic: true } : {};
        const ps = pieces(e.inline, c, style);
        while (sameAs(i + 1, e.kind)) {
          i++;
          ps.push({ kind: "text", text: "\n", style: {} }, ...pieces((elements[i]!.element as { inline: Inline[] }).inline, c, style));
        }
        const attrs = e.kind === "centered" ? { Alignment: "Center" } : e.kind === "rightAligned" ? { Alignment: "Right" } : undefined;
        para({ type: "Action", ...(attrs ? { attrs } : {}), pieces: ps });
        break;
      }
      case "transition":
        para({ type: "Transition", pieces: trim(pieces(e.inline, c)).map((p) => (p.kind === "text" ? { ...p, text: p.text.toUpperCase() } : p)) });
        break;
      case "dialogue": {
        const next = elements[i + 1]?.element;
        if (e.dual === "left" && next?.kind === "dialogue" && next.dual === "right") {
          const inner = [...speech(e, c, print), ...speech(next, c, print)].map((p) => paragraphXml(p, "", "                ", revisions));
          emit((extra) => `        <Paragraph Type="General"${extra}>\n            <DualDialogue>\n${inner.join("")}            </DualDialogue>\n            <Text></Text>\n        </Paragraph>\n`);
          i++;
        } else for (const p of speech(e, c, print)) para(p);
        break;
      }
      case "pageBreak":
        newPage = true;
        break;
      case "synopsis": {
        const text = inlineText(e.inline).trim();
        if (text) para({ type: "General", pieces: [{ kind: "note", text }] });
        break;
      }
      default:
        // Sections, directive lines ({{HEADER}}, {{INCLUDE}}: its file's elements follow) and the rest: not written.
        break;
    }
  }

  const titlePage = doc.titlePage && options.titlePage !== false ? titlePageXml(doc.titlePage.fields, ctx) : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n` +
    `<FinalDraft DocumentType="Script" Template="No" Version="2">\n` +
    `    <Content>\n${out.join("")}    </Content>\n` +
    titlePage +
    HEADER_AND_FOOTER +
    revisions.xml() +
    `</FinalDraft>\n`
  );
}

/** A speech: the cue, then a paragraph per line (Highland's split), parentheticals on their own. */
function speech(e: Extract<Element, { kind: "dialogue" }>, c: InlineContext, print: PrintContext): Para[] {
  const cue = [e.character, ...e.extensions].join(" ");
  const out: Para[] = [{ type: "Character", pieces: [{ kind: "text", text: cue, style: marked(print, e.lines[0]?.content.start ?? e.span.start) }] }];
  for (const p of e.parts) {
    if (p.kind === "empty") out.push({ type: "Dialogue", pieces: [] });
    else out.push({ type: p.kind === "parenthetical" ? "Parenthetical" : "Dialogue", pieces: pieces(p.inline, c, p.kind === "lyric" ? { italic: true } : {}) });
  }
  return out;
}

/** Inline content as styled text and notes (a note inside emphasis is dropped, as in print). */
function pieces(nodes: Inline[], c: InlineContext, style: TextStyle = {}): Piece[] {
  const out: Piece[] = [];
  let run: Inline[] = [];
  const flush = () => {
    for (const r of toRuns(run, c, style)) out.push({ kind: "text", text: r.text, style: r.style });
    run = [];
  };
  for (const n of nodes) {
    if (n.kind === "note") {
      flush();
      out.push({ kind: "note", text: n.text });
    } else run.push(n);
  }
  flush();
  return out;
}

/** Without spaces at either end. */
function trim(ps: Piece[]): Piece[] {
  const out = ps.map((p) => ({ ...p }));
  const first = out.find((p) => p.kind === "text") as Extract<Piece, { kind: "text" }> | undefined;
  if (first) first.text = first.text.replace(/^\s+/, "");
  const last = [...out].reverse().find((p) => p.kind === "text") as Extract<Piece, { kind: "text" }> | undefined;
  if (last) last.text = last.text.replace(/\s+$/, "");
  return out.filter((p) => p.kind === "note" || p.text !== "");
}

function paragraphXml(p: Para, extra: string, indent: string, revisions: Revisions): string {
  const attrs = Object.entries(p.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escAttr(v)}"`)
    .join("");
  const inner = p.pieces.length ? p.pieces.map((x) => pieceXml(x, `${indent}    `, revisions)).join("") : `${indent}    <Text></Text>\n`;
  return `${indent}<Paragraph Type="${p.type}"${attrs}${extra}>\n${inner}${indent}</Paragraph>\n`;
}

function pieceXml(p: Piece, indent: string, revisions: Revisions): string {
  // A line break is a run of its own, unstyled (Highland's lyrics and two-line action).
  if (p.kind === "text" && p.text.includes("\n") && p.text !== "\n")
    return p.text
      .split("\n")
      .flatMap((t, k) => (k ? [{ ...p, text: "\n", style: {} }, { ...p, text: t }] : [{ ...p, text: t }]))
      .filter((x) => x.text !== "")
      .map((x) => pieceXml(x, indent, revisions))
      .join("");
  if (p.kind === "note") return `${indent}<ScriptNote>\n${indent}    <Paragraph>\n${indent}        <Text>${esc(p.text)}</Text>\n${indent}    </Paragraph>\n${indent}</ScriptNote>\n`;
  const s = p.style;
  const styles = [s.bold && "Bold", s.italic && "Italic", s.underline && "Underline", s.strike && "Strikeout"].filter(Boolean).join("+");
  const rev = s.revised ? revisions.id(s.color ?? "") : 0;
  return `${indent}<Text${styles ? ` Style="${styles}"` : ""}${rev ? ` RevisionID="${rev}"` : ""}>${esc(p.text)}</Text>\n`;
}

/** Final Draft's revision sets: one per revision colour, numbered in order of first use. */
class Revisions {
  #ids = new Map<string, number>();

  id(color: string): number {
    const key = color.toLowerCase();
    let n = this.#ids.get(key);
    if (n === undefined) this.#ids.set(key, (n = this.#ids.size + 1));
    return n;
  }

  xml(): string {
    if (this.#ids.size === 0) return "";
    const sets = [...this.#ids].map(
      ([color, id]) =>
        `        <Revision Color="${fdColor(color || "#000000")}" FullRevision="No" ID="${id}" Mark="*" Name="Revision ${id}${color ? ` (${color})` : ""}" PageColor="#FFFFFFFFFFFF" Style=""/>\n`,
    );
    return `    <Revisions ActiveSet="${this.#ids.size}" Location="7.75" RevisionMode="No" RevisionsShown="Active" ShowAllMarks="No" ShowAllSets="Yes" ShowPageColor="No">\n${sets.join("")}    </Revisions>\n`;
  }
}

/** "#ee2d36" as Final Draft writes colours: "#EEEE2D2D3636". */
export function fdColor(hex: string): string {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return "#000000000000";
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, "$&$&") : m[1]!;
  return `#${h.replace(/../g, "$&$&").toUpperCase()}`;
}

// Title page: Highland's 50 lines, the fields at its places (title on line 16, credit 20, author
// 22, source 27, contact 43 on the left, draft date 46 on the right). A field of several lines
// takes the lines after its place, moving the later fields down.

const CENTRED: [string[], number][] = [
  [["title"], 3],
  [["credit"], 1],
  [["author", "authors"], 4],
  [["source"], 0],
];
const LEFT = ["contact", "contact info", "notes", "copyright"];
const RIGHT = ["draft date", "date", "revision"];

function titlePageXml(fields: TitleField[], ctx: InlineContext): string {
  const slots: { align: string; pieces: Piece[] }[] = Array.from({ length: 50 }, () => ({ align: "Center", pieces: [] }));
  const lines = (names: string[]) =>
    fields
      .filter((f) => names.includes(f.name))
      .flatMap((f) => {
        const vs = f.values.map((v) => v.text);
        if (vs[0]?.trim() === "") vs.shift();
        return vs;
      })
      .map((text): Piece[] => styledValue(text.trim(), ctx).map((r) => ({ kind: "text", text: r.text, style: r.style })));
  const put = (at: number, align: string, ls: Piece[][]) => {
    ls.forEach((pieces, k) => {
      while (slots.length <= at + k) slots.push({ align: "Center", pieces: [] });
      slots[at + k] = { align, pieces };
    });
    return at + ls.length;
  };
  let at = 15;
  for (const [names, gap] of CENTRED) {
    const ls = lines(names);
    if (ls.length) at = put(at, "Center", ls) + gap;
  }
  const left = lines(LEFT);
  const leftEnd = put(Math.max(42, at), "Left", left);
  put(Math.max(45, left.length ? leftEnd : 0, at), "Right", lines(RIGHT));
  const none = new Revisions();
  const ps = slots.map((s) => paragraphXml({ type: "", pieces: s.pieces }, "", "            ", none).replace(` Type=""`, ` Alignment="${s.align}"`));
  return `    <TitlePage>\n        <Content>\n${ps.join("")}        </Content>\n    </TitlePage>\n`;
}

const HEADER_AND_FOOTER = `    <HeaderAndFooter FooterFirstPage="Yes" FooterVisible="No" HeaderFirstPage="No" HeaderVisible="Yes" StartingPage="1">
        <Header>
            <Paragraph>
                <Text> </Text>
                <Text> </Text>
                <DynamicLabel Type="Page #"></DynamicLabel>
                <Text>.</Text>
                <TabStops>
                    <TabStop Type="Center" Position="4.50"></TabStop>
                    <TabStop Type="Right" Position="7.25"></TabStop>
                </TabStops>
            </Paragraph>
        </Header>
        <DynamicLabel Type="Last Revised"></DynamicLabel>
        <Footer>
            <Paragraph>
                <Text> </Text>
            </Paragraph>
        </Footer>
    </HeaderAndFooter>
`;

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}
