import { fileURLToPath } from "node:url";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { CHAR, type Layout, type TextStyle } from "./types.ts";

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
  doc.fontSize(12);

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });

  for (const page of layout.pages) {
    doc.addPage({ size: [layout.width, layout.height], margin: 0 });
    for (const item of page.items) {
      let x = item.x;
      for (const run of item.runs) {
        const w = run.text.length * CHAR;
        if (run.style.highlight) {
          doc.save().rect(x, item.y - 9.5, w, 12.5).fill("#FFF59D").restore();
        }
        doc.font(fontFor(run.style)).fillColor("black");
        doc.text(run.text, x, item.y, {
          lineBreak: false,
          baseline: "alphabetic",
          underline: !!run.style.underline,
          strike: !!run.style.strike,
        });
        x += w;
      }
    }
  }
  doc.end();
  return done;
}

function fontFor(s: TextStyle): keyof typeof FONT_FILES {
  if (s.bold && s.italic) return "boldItalic";
  if (s.bold) return "bold";
  if (s.italic) return "italic";
  return "regular";
}
