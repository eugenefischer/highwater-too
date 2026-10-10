import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HighlandBundle } from "@highwater/bundle";
import { parse, resolveIncludes, type IncludeFile, type IncludeLoader } from "@highwater/parser";
import { layoutScreenplay, renderPdf } from "@highwater/pdf";

export interface ExportOptions {
  /** The script text (the editor's, so unsaved edits are included). */
  text: string;
  /** The .highland or .fountain file the text belongs to; includes resolve relative to it. */
  path: string;
  fontDir: string;
  titlePage?: boolean;
  date?: Date;
}

/** Reads an included file by path relative to the including one; .highland files give their script text. */
export const includeLoader: IncludeLoader = async (path, from) => {
  const full = resolve(dirname(from.id), path);
  try {
    const source = full.toLowerCase().endsWith(".highland") ? HighlandBundle.fromZip(new Uint8Array(await readFile(full))).text : await readFile(full, "utf8");
    return { id: full, name: path, source };
  } catch {
    return null;
  }
};

/** Lays out and renders a screenplay, with {{INCLUDE}} files merged in. */
export async function exportScreenplay(options: ExportOptions): Promise<{ pdf: Uint8Array; pages: number; problems: string[] }> {
  const root: IncludeFile = { id: options.path, name: options.path, source: options.text };
  const merged = await resolveIncludes(root, "fountain", includeLoader);
  const doc = parse(options.text, { mode: "fountain" });
  const layout = layoutScreenplay(doc, {
    elements: merged.elements.map((m) => m.element),
    ...(options.date ? { date: options.date } : {}),
    ...(options.titlePage === false ? { titlePage: false } : {}),
  });
  const title = doc.titlePage?.fields.find((f) => f.name === "title")?.values.map((v) => v.text).filter(Boolean).join(" ") ?? "";
  const pdf = await renderPdf(layout, { fontDir: options.fontDir, title });
  return { pdf, pages: layout.pages.length, problems: merged.problems.map((p) => p.message) };
}
