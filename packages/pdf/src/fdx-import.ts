import { parse } from "@highwater/parser";
import { childElements, firstChild, parseXml, textContent, type XmlElement } from "./xml.ts";

/**
 * A Final Draft (.fdx) file as Fountain text, as Highland 2 converts one (its conversion of a
 * Final Draft 2020 script), with Highland's bugs fixed: dual dialogue keeps its "^", a styled
 * run is never split at a curly quote or dash, spaces are never wrapped in emphasis markers, and
 * a transition Fountain wouldn't recognise is forced with ">". Revisions become {{REVISION}} tags,
 * notes not attached to text are added at the end, emphasis in scene headings is kept and
 * trailing spaces are trimmed.
 */
export function fdxToFountain(xml: string): string {
  const root = parseXml(xml);
  if (root.name !== "FinalDraft") throw new Error("This is not a Final Draft (.fdx) file.");
  const fd = new Reader(root);
  const blocks: Block[] = [];
  const content = firstChild(root, "Content");
  if (content) for (const p of childElements(content, "Paragraph")) fd.paragraph(p, blocks);
  const unanchored = firstChild(root, "UnanchoredScriptNotes");
  if (unanchored) for (const n of childElements(unanchored, "ScriptNote")) blocks.push({ kind: "note", lines: [`[[${noteText(n)}]]`] });
  const titlePage = firstChild(root, "TitlePage");
  const head = titlePage ? fd.titlePage(titlePage) : "";
  return assemble(head, blocks.filter((b) => b.lines.some((l) => l.trim() !== "")));
}

type Kind = "sceneHeading" | "action" | "dialogue" | "transition" | "centered" | "rightAligned" | "note" | "pageBreak";

interface Block {
  kind: Kind;
  lines: string[];
  /** The forcing character added because Fountain would read the block as something else. */
  forced?: boolean;
}

const FORCE: Partial<Record<Kind, string>> = { sceneHeading: ".", action: "!", dialogue: "@", transition: ">" };

/** The text with the title page, and each block forced where the parser reads it otherwise. */
function assemble(head: string, blocks: Block[]): string {
  const build = () => {
    let text = head;
    const starts: number[] = [];
    blocks.forEach((b, k) => {
      if (k > 0 || head) text += "\n";
      starts.push(text.length);
      const lines = b.forced ? [FORCE[b.kind]! + b.lines[0], ...b.lines.slice(1)] : b.lines;
      text += lines.join("\n") + "\n";
    });
    return { text, starts };
  };
  for (let pass = 0; pass < 2; pass++) {
    const { text, starts } = build();
    const kinds = new Map(parse(text, { mode: "fountain" }).elements.map((e) => [e.span.start, e.kind]));
    let changed = false;
    blocks.forEach((b, k) => {
      if (b.forced || !FORCE[b.kind] || kinds.get(starts[k]!) === b.kind) return;
      b.forced = true;
      changed = true;
    });
    if (!changed) return text;
  }
  return build().text;
}

class Reader {
  /** Paragraph types Final Draft shows in capitals (its element settings). */
  caps: Set<string>;
  /** Revision set ID → colour. */
  colors = new Map<string, string>();
  /** The speech being read, so dialogue and parentheticals join their cue. */
  speech: Block | null = null;

  constructor(root: XmlElement) {
    const settings = childElements(root, "ElementSettings");
    this.caps = settings.length
      ? new Set(settings.filter((s) => /AllCaps/.test(firstChild(s, "FontSpec")?.attrs.Style ?? "")).map((s) => s.attrs.Type ?? ""))
      : new Set(["Scene Heading", "Character", "Transition", "Shot", "New Act", "End of Act"]);
    const revisions = firstChild(root, "Revisions");
    if (revisions) for (const r of childElements(revisions, "Revision")) this.colors.set(r.attrs.ID ?? "", revisionColor(r.attrs.Color, r.attrs.PageColor));
  }

  paragraph(p: XmlElement, out: Block[]): void {
    const type = p.attrs.Type ?? "Action";
    if (p.attrs.StartsNewPage === "Yes") {
      out.push({ kind: "pageBreak", lines: ["==="] });
      this.speech = null;
    }
    const dual = firstChild(p, "DualDialogue");
    if (dual) {
      let cues = 0;
      for (const q of childElements(dual, "Paragraph")) {
        if (q.attrs.Type === "Character") cues++;
        this.paragraph(q, out);
        if (q.attrs.Type === "Character" && cues === 2 && this.speech) this.speech.lines[0] += " ^";
      }
      this.speech = null;
      return;
    }
    const caps = this.caps.has(type);
    // A style over the whole heading is the heading's look (Highland writes headings bold), not emphasis.
    const text = this.runs(p, caps, type === "Scene Heading" || type === "Shot");
    switch (type) {
      case "Character":
        this.speech = { kind: "dialogue", lines: [oneLine(text)] };
        if (this.speech.lines[0]) out.push(this.speech);
        return;
      case "Dialogue":
      case "Parenthetical":
        if (this.speech) {
          // An empty line inside a speech is Fountain's two-space line.
          if (text.trim() !== "") this.speech.lines.push(...lines(text).map((l) => (l === "" ? "  " : l)));
          return;
        }
        break;
    }
    this.speech = null;
    switch (type) {
      case "Scene Heading":
      case "Shot": {
        const n = p.attrs.Number;
        const heading = oneLine(text);
        if (heading) out.push({ kind: "sceneHeading", lines: [heading + (n ? ` #${n}#` : "")], ...(type === "Shot" ? { forced: true } : {}) });
        return;
      }
      case "Transition":
        if (oneLine(text)) out.push({ kind: "transition", lines: [oneLine(text)] });
        return;
      case "New Act":
      case "End of Act":
        for (const l of lines(text).filter(Boolean)) out.push({ kind: "centered", lines: [`>${l}<`] });
        return;
    }
    const notesOnly = text.trim() !== "" && text.replace(/\[\[[^\]]*\]\]/g, "").trim() === "";
    // Action, General and anything else; a blank line in the text separates paragraphs.
    for (const para of text.split(/\n[ \t]*\n/)) {
      const ls = lines(para);
      if (!ls.some((l) => l !== "")) continue;
      const align = p.attrs.Alignment;
      if (align === "Center") out.push({ kind: "centered", lines: ls.map((l) => `>${l}<`) });
      else if (align === "Right") out.push({ kind: "rightAligned", lines: ls.map((l) => `${l}>`) });
      else out.push({ kind: notesOnly ? "note" : "action", lines: ls });
    }
  }

  /** A paragraph's text with Fountain emphasis, revision tags and inline notes. */
  runs(p: XmlElement, caps: boolean, look = false): string {
    type Run = { text: string; styles: string[]; rev: string } | { note: string };
    const runs: Run[] = [];
    for (const c of childElements(p)) {
      if (c.name === "ScriptNote") runs.push({ note: noteText(c) });
      else if (c.name === "Text") {
        const style = (c.attrs.Style ?? "").split("+").filter(Boolean);
        let text = textContent(c);
        if (caps || style.includes("AllCaps")) text = text.toUpperCase();
        const rev = c.attrs.RevisionID && c.attrs.RevisionID !== "0" ? (this.colors.get(c.attrs.RevisionID) ?? "") : null;
        const styles = style.filter((s) => s === "Bold" || s === "Italic" || s === "Underline" || s === "Strikeout").sort();
        const last = runs.at(-1);
        const revKey = rev === null ? "" : `#${rev}`;
        // Final Draft splits text of one style into several runs: join them, so emphasis is marked once.
        if (last && "text" in last && last.rev === revKey && last.styles.join() === styles.join()) last.text += text;
        else runs.push({ text, styles, rev: revKey });
      }
    }
    if (look) {
      const texts = runs.filter((r): r is Extract<Run, { text: string }> => "text" in r && r.text.trim() !== "");
      const shared = texts.length ? texts[0]!.styles.filter((st) => texts.every((r) => r.styles.includes(st))) : [];
      for (const r of runs) if ("text" in r) r.styles = r.styles.filter((st) => !shared.includes(st));
    }
    let out = "";
    let open: string | null = null;
    const close = () => {
      if (open !== null) out += "{{/REVISION}}";
      open = null;
    };
    for (const r of runs) {
      if ("note" in r) {
        close();
        out += `[[${r.note}]]`;
        continue;
      }
      if (r.rev !== (open ?? "")) {
        close();
        if (r.rev) {
          const color = r.rev.slice(1);
          out += color ? `{{REVISION: ${color}}}` : "{{REVISION}}";
          open = r.rev;
        }
      }
      out += emphasise(escape(r.text), r.styles);
    }
    close();
    return out;
  }

  titlePage(tp: XmlElement): string {
    const content = firstChild(tp, "Content") ?? tp;
    const groups: { align: string; lines: string[] }[] = [];
    let last: { align: string; lines: string[] } | null = null;
    for (const p of childElements(content, "Paragraph")) {
      const text = this.runs(p, false);
      const align = p.attrs.Alignment === "Center" ? "Center" : p.attrs.Alignment === "Right" ? "Right" : "Left";
      for (const l of lines(text)) {
        if (l.trim() === "") {
          last = null;
          continue;
        }
        if (last && last.align === align) last.lines.push(l.trim());
        else groups.push((last = { align, lines: [l.trim()] }));
      }
    }
    const centred = groups.filter((g) => g.align === "Center");
    const fields: [string, string[]][] = [];
    const title = centred.shift();
    if (title) fields.push(["Title", title.lines]);
    if (centred[0] && centred.length > 1 && /\bby\b/i.test(centred[0].lines.join(" "))) fields.push(["Credit", centred.shift()!.lines]);
    const author = centred.shift();
    if (author) fields.push(["Author", author.lines]);
    if (centred.length) fields.push(["Source", centred.flatMap((g) => g.lines)]);
    const right = groups.filter((g) => g.align === "Right").flatMap((g) => g.lines);
    if (right.length) fields.push(["Draft date", right]);
    const left = groups.filter((g) => g.align === "Left").flatMap((g) => g.lines);
    if (left.length) fields.push(["Contact", left]);
    return fields.map(([key, ls]) => (ls.length === 1 ? `${key}: ${ls[0]}` : `${key}:\n${ls.map((l) => `\t${l}`).join("\n")}`)).join("\n") + (fields.length ? "\n" : "");
  }
}

/** Lines without trailing spaces. */
function lines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).map((l) => l.replace(/[ \t ]+$/, ""));
}

function oneLine(text: string): string {
  return lines(text)
    .join(" ")
    .replace(/^[ \t ]+|[ \t ]+$/g, "");
}

function noteText(note: XmlElement): string {
  return childElements(note, "Paragraph")
    .map((p) => textContent(p).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\]\]/g, "] ]");
}

/** Characters Fountain would read as markup. */
function escape(text: string): string {
  return text.replace(/[\\*_]/g, "\\$&");
}

/**
 * Emphasis around each line's text, the spaces at either end left outside (a run of only spaces
 * gets none).
 */
function emphasise(text: string, styles: string[]): string {
  if (!styles.length) return text;
  const bold = styles.includes("Bold");
  const italic = styles.includes("Italic");
  const open = (styles.includes("Underline") ? "_" : "") + (styles.includes("Strikeout") ? "~~" : "") + (bold && italic ? "***" : bold ? "**" : italic ? "*" : "");
  const shut = [...open.replace("~~", "\u0000")].reverse().join("").replace("\u0000", "~~");
  return text
    .split("\n")
    .map((line) => {
      const m = /^(\s*)(.*?)(\s*)$/s.exec(line)!;
      return m[2] ? `${m[1]}${open}${m[2]}${shut}${m[3]}` : line;
    })
    .join("\n");
}

/**
 * A revision set's colour for {{REVISION}}: its text colour when that isn't black, else its page
 * colour darkened enough to read as text (Final Draft's pages are pale: blue, pink, yellow…).
 */
function revisionColor(text: string | undefined, page: string | undefined): string {
  const t = rgb(text);
  if (t && (t[0] > 40 || t[1] > 40 || t[2] > 40) && !(t[0] > 240 && t[1] > 240 && t[2] > 240)) return hex(t);
  const pg = rgb(page);
  // No colour of either kind (a set Highwater Too wrote for a bare {{REVISION}}): a bare tag.
  if (!pg || (pg[0] > 240 && pg[1] > 240 && pg[2] > 240)) return "";
  return hex(readable(pg));
}

/** "#C6C6EDEDFEFE" (Final Draft) or "#c6edfe" as 0–255 channels. */
function rgb(color: string | undefined): [number, number, number] | null {
  const m = /^#?([0-9a-f]+)$/i.exec(color?.trim() ?? "");
  if (!m) return null;
  const h = m[1]!;
  if (h.length === 12) return [0, 4, 8].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number];
  if (h.length === 6) return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16)) as [number, number, number];
  return null;
}

function hex(c: [number, number, number]): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** The same hue at 40 % lightness (at most), fully saturated if it has any colour. */
function readable([r, g, b]: [number, number, number]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  const d = max - min;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = Math.min((max + min) / 2, 0.4);
  const s = d > 0 ? 1 : 0;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}
