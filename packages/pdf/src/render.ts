import { fileURLToPath } from "node:url";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { faceKey, variantOf } from "./fonts.ts";
import { CHAR, type Layout, type Run, type TextStyle } from "./types.ts";

export interface RenderOptions {
  /** Folder holding the Courier Prime .ttf files; default: this package's fonts folder. */
  fontDir?: string;
  /** Document title and author for the PDF's properties. */
  title?: string;
  author?: string;
  /** Fixed creation date, for reproducible output in tests. */
  creationDate?: Date;
}

const FONT_FILES = {
  regular: "CourierPrime-Regular.ttf",
  bold: "CourierPrime-Bold.ttf",
  italic: "CourierPrime-Italic.ttf",
  boldItalic: "CourierPrime-BoldItalic.ttf",
} as const;

export function defaultFontDir(): string {
  return fileURLToPath(new URL("../fonts/", import.meta.url));
}

/** Draws a layout as a PDF. */
export function renderPdf(layout: Layout, options: RenderOptions = {}): Promise<Uint8Array> {
  const dir = options.fontDir ?? defaultFontDir();
  const doc = new PDFDocument({
    size: [layout.width, layout.height],
    margin: 0,
    autoFirstPage: false,
    info: { Title: options.title ?? "", Author: options.author ?? "", Creator: "Highwater Too", CreationDate: options.creationDate ?? new Date() },
  });
  for (const [name, file] of Object.entries(FONT_FILES)) doc.registerFont(name, join(dir, file));
  for (const [key, face] of Object.entries(layout.fonts ?? {})) doc.registerFont(key, face.path, face.postscriptName);
  doc.fontSize(12);

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });

  for (const page of layout.pages) {
    doc.addPage({ size: [layout.width, layout.height], margin: 0 });
    for (const g of page.graphics ?? []) {
      if (g.kind === "rect") doc.save().rect(g.x, g.y, g.width, g.height).fillColor([g.gray * 255, g.gray * 255, g.gray * 255]).fill().restore();
      else doc.image(Buffer.from(g.data), g.x, g.y, { width: g.width, height: g.height });
    }
    for (const item of page.items) {
      let x = item.x;
      // Justified lines: the spaces stretch to fill the width (Novel).
      let spacing = 0;
      if (item.justify !== undefined) {
        const natural = item.runs.reduce((w, r) => w + widthOf(r), 0);
        const spaces = item.runs.reduce((n, r) => n + (r.text.trimEnd().match(/ /g)?.length ?? 0), 0);
        if (spaces > 0 && item.justify > natural) spacing = (item.justify - natural) / spaces;
      }
      for (const run of item.runs) {
        const named = run.style.font !== undefined;
        const size = run.style.size ?? 12;
        select(run);
        const stretched = spacing ? (run.text.trimEnd().match(/ /g)?.length ?? 0) * spacing : 0;
        const w = widthOf(run) + stretched;
        if (run.style.highlight) {
          const box = item.highlightBox ?? { top: -9.5, height: 12.5, color: "#FFF59D" };
          doc.save().rect(x, item.y + box.top, w, box.height).fill(box.color).restore();
          select(run);
        }
        doc.fillColor(run.style.link ? LINK : (run.style.color ?? "black"));
        doc.text(run.text, x, item.y, { lineBreak: false, baseline: "alphabetic", ...(stretched ? { wordSpacing: spacing } : {}) });
        // Drawn here rather than by PDFKit, which places lines from the top of the text box (we
        // give baselines). Underline as in Highland's PDFs: 1 pt, 2.1 pt below the baseline.
        const ink = named ? doc.widthOfString(run.text.trimEnd()) + (spacing ? (run.text.trimEnd().match(/ /g)?.length ?? 0) * spacing : 0) : run.text.trimEnd().length * CHAR;
        const scale = named ? size / 12 : 1;
        if (run.style.underline || run.style.link) line(x, item.y + UNDERLINE_OFFSET * scale, ink, run.style.link ? LINK : (run.style.color ?? "black"));
        if (run.style.strike) line(x, item.y - STRIKE_RISE * scale, ink);
        if (run.style.rule) line(x, item.y + 3, ink, "black", 2);
        x += w;
      }
    }
  }
  doc.end();
  return done;

  /** Sets the run's font and size. */
  function select(run: Run): void {
    // Helvetica (paragraph numbers): one of PDF's standard fonts, so nothing is embedded.
    if (run.style.font === "Helvetica") doc.font("Helvetica").fontSize(run.style.size ?? 12);
    else if (run.style.font !== undefined) doc.font(faceKey(run.style.font, variantOf(run.style))).fontSize(run.style.size ?? 12);
    else doc.font(fontFor(run.style)).fontSize(12);
  }

  function widthOf(run: Run): number {
    if (run.style.font === undefined) return run.text.length * CHAR;
    select(run);
    return doc.widthOfString(run.text);
  }

  function line(x: number, y: number, width: number, color = "black", weight = 1): void {
    if (width <= 0) return;
    doc.save().lineWidth(weight).strokeColor(color).moveTo(x, y).lineTo(x + width, y).stroke().restore();
  }
}

/** Links in Highland's manuscript PDFs. */
const LINK = "#0000FF";
/** Measured in Highland's Astounding title page: underline 2.1 pt below the baseline, 1 pt thick. */
const UNDERLINE_OFFSET = 2.1;
/** Strikethrough through the middle of lower-case letters (Courier Prime x-height 5.4 pt at 12 pt). */
const STRIKE_RISE = 3;

function fontFor(s: TextStyle): keyof typeof FONT_FILES {
  if (s.bold && s.italic) return "boldItalic";
  if (s.bold) return "bold";
  if (s.italic) return "italic";
  return "regular";
}
