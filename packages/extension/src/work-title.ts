import { parse, type Mode } from "@highwater/parser";

/** Settings → Backup's "Title new works with" choices (the file name is always the fallback). */
export interface TitleSources {
  /** The title page's Title (in a manuscript, its CC field when it has no Title). */
  titlePage: boolean;
  /** A manuscript's first top-level `#` heading. */
  heading: boolean;
}

/**
 * The title a new work takes at its first save (EJ, 2026-11-18): the title page's Title, then (in
 * manuscripts only: a screenplay's first `#` is usually an act) the first top-level heading, then
 * the file's name without its extension. Markup, notes and boneyards are left out.
 */
export function workTitle(script: string, scriptName: string, fileName: string, sources: TitleSources): string {
  const mode: Mode | null = scriptName.endsWith(".fountain") ? "fountain" : scriptName.endsWith(".md") ? "markdown" : null;
  if (mode && (sources.titlePage || sources.heading)) {
    const doc = parse(script, { mode });
    if (sources.titlePage && doc.titlePage) {
      const field = (name: string) => doc.titlePage!.fields.find((f) => f.name === name);
      const title = field("title");
      if (title) {
        const text = plain(title.values.map((v) => v.text).join(" "));
        if (text) return text;
      }
      // Highland's manuscripts put the title in the centre (CC), often above a byline.
      const cc = mode === "markdown" ? field("cc") : undefined;
      if (cc) {
        const first = cc.values.map((v) => plain(v.text)).find(Boolean);
        if (first) return first;
      }
    }
    if (sources.heading && mode === "markdown") {
      const heading = doc.elements.find((e) => e.kind === "heading" && e.level === 1);
      if (heading && heading.kind === "heading") {
        const text = plain(heading.text);
        if (text) return text;
      }
    }
  }
  return fileTitle(fileName);
}

/** A file's name without its extension. */
export function fileTitle(fileName: string): string {
  return fileName.replace(/\.(highland|fountain|spmd|md|markdown|txt)$/i, "") || "Untitled";
}

/** Text without notes, boneyards, directives or emphasis markers, on one line. */
function plain(text: string): string {
  return text
    .replace(/\[\[[\s\S]*?\]\]/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\\([\\*_~`#])/g, "$1\u0000")
    .replace(/(\*+|_+|~~|`)/g, "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
