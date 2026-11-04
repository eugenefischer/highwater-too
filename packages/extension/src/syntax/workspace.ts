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

/** A Bin item's second line in the list: how long it is, and how it goes on after its first line. */
export function binDetail(text: string): string {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const more = lines.length > 1 ? ` · ${lines[1]!.trim()}` : "";
  return `${words} ${words === 1 ? "word" : "words"}${more}`;
}

/** "240 KB", "1.2 MB": a file size as the Explorer shows it. */
export function byteSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Width and height of a PNG, JPEG, GIF or WebP image from its first bytes, or null. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u16le = (i: number) => b[i]! | (b[i + 1]! << 8);
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32be(16), height: u32be(20) };
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: u16le(6), height: u16le(8) };
  if (b.length >= 30 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.slice(12, 16));
    if (kind === "VP8X") return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    if (kind === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === "VP8L") return { width: 1 + (u16le(21) & 0x3fff), height: 1 + (((b[22]! >> 6) | (b[23]! << 2) | ((b[24]! & 0x0f) << 10)) & 0x3fff) };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the segments to a start-of-frame marker.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}
