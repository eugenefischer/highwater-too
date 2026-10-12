/** Pure helpers for the Bin and Assets panels (no VS Code here, so they can be tested). */

/** A Bin item's label: its first non-empty line, shortened. */
export function binLabel(text: string, max = 60): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "(empty)";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Moves item `from` to position `to` (both indexes into the list as it is). */
export function move<T>(items: T[], from: number, to: number): T[] {
  const out = items.slice();
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item!);
  return out;
}

/**
 * The Markdown that shows an asset: `![name](assets/name)`, spaces and parentheses escaped. A plain
 * file's images are in a folder of their own beside it, e.g. "Script assets".
 */
export function assetMarkdown(name: string, folder = "assets"): string {
  const alt = name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "");
  const path = `${folder}/${name}`.replace(/[ ()]/g, (c) => ({ " ": "%20", "(": "%28", ")": "%29" })[c]!);
  return `![${alt}](${path})`;
}

/** A name not already in `taken`: "photo.png", then "photo 2.png", "photo 3.png"… */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
}
