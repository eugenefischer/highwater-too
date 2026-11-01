import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import PDFDocument from "pdfkit";
import type { Run, TextStyle } from "./types.ts";

/**
 * Fonts for the prose templates (M10). Highland 2's templates use Courier Prime, Amiri, Lato and
 * Highland Sans, and macOS's Georgia, Times New Roman, Avenir Next, SF Pro Display and New York.
 * Courier Prime, Highland Sans, Amiri, Lato and Merriweather (open licences, the versions Highland ships) are bundled; the rest are used when installed,
 * and replaced by a bundled font of the same kind otherwise (EJ's decision, 2026-10-19).
 */
export type Variant = "regular" | "bold" | "italic" | "boldItalic";
const VARIANTS: Variant[] = ["regular", "bold", "italic", "boldItalic"];

/** A font file, and the PostScript name of the face for collections (.ttc). */
export interface FontFace {
  path: string;
  postscriptName?: string;
}

/** Faces by key `${family}/${variant}`, as runs name them. */
export type FontFaces = Record<string, FontFace>;

export const faceKey = (family: string, variant: Variant): string => `${family}/${variant}`;

export function variantOf(style: TextStyle): Variant {
  return style.bold && style.italic ? "boldItalic" : style.bold ? "bold" : style.italic ? "italic" : "regular";
}

/** The fonts shipped with Highwater Too. */
const BUNDLED: Record<string, Record<Variant, string>> = {
  "Courier Prime": { regular: "CourierPrime-Regular.ttf", bold: "CourierPrime-Bold.ttf", italic: "CourierPrime-Italic.ttf", boldItalic: "CourierPrime-BoldItalic.ttf" },
  "Highland Sans": { regular: "Highland Sans.ttf", bold: "Highland Sans Bold.ttf", italic: "Highland Sans Italic.ttf", boldItalic: "Highland Sans Bold Italic.ttf" },
  Amiri: { regular: "Amiri-Regular.ttf", bold: "Amiri-Bold.ttf", italic: "Amiri-Italic.ttf", boldItalic: "Amiri-BoldItalic.ttf" },
  Lato: { regular: "Lato-Regular.ttf", bold: "Lato-Bold.ttf", italic: "Lato-Italic.ttf", boldItalic: "Lato-BoldItalic.ttf" },
  Merriweather: { regular: "Merriweather-Regular.ttf", bold: "Merriweather-Bold.ttf", italic: "Merriweather-Italic.ttf", boldItalic: "Merriweather-BoldItalic.ttf" },
};

/** What a missing font is replaced with: a bundled font of the same kind. */
const SUBSTITUTE: Record<string, string> = {
  Georgia: "Merriweather",
  "New York Medium": "Merriweather",
  "Times New Roman": "Amiri",
  "Avenir Next": "Lato",
  "SF Pro Display": "Lato",
};

/** Where installed fonts are looked for, besides the bundled folder. */
export function systemFontDirs(): string[] {
  const home = homedir();
  if (process.platform === "darwin")
    return [
      join(home, "Library/Fonts"),
      "/Library/Fonts",
      "/System/Library/Fonts",
      "/System/Library/Fonts/Supplemental",
      // Highland 2 keeps its own template fonts inside the app.
      "/Applications/Highland 2.app/Contents/Resources",
      "/Applications/Highland 2.app/Contents/Resources/Fonts",
    ];
  if (process.platform === "win32") return [join(process.env.WINDIR ?? "C:\\Windows", "Fonts"), join(process.env.LOCALAPPDATA ?? join(home, "AppData/Local"), "Microsoft/Windows/Fonts")];
  return [join(home, ".local/share/fonts"), join(home, ".fonts"), "/usr/local/share/fonts", "/usr/share/fonts"];
}

const FONT_FILE = /\.(ttf|otf|ttc)$/i;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Font files in a folder (one level of subfolders), cached. */
const listings = new Map<string, string[]>();
function fontFiles(dir: string): string[] {
  let files = listings.get(dir);
  if (files) return files;
  files = [];
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (FONT_FILE.test(name)) files.push(path);
      else if (!name.startsWith(".")) {
        try {
          if (statSync(path).isDirectory()) for (const sub of readdirSync(path)) if (FONT_FILE.test(sub)) files.push(join(path, sub));
        } catch {
          // unreadable: skip
        }
      }
    }
  } catch {
    // missing folder
  }
  listings.set(dir, files);
  return files;
}

/** The variant a file name stands for, if it names `family` and nothing else. */
function fileVariant(file: string, family: string): Variant | "all" | null {
  const base = file.split(/[\\/]/).pop()!;
  const name = norm(base.slice(0, -extname(base).length));
  const f = norm(family);
  if (!name.startsWith(f)) return null;
  let rest = name.slice(f.length);
  if (extname(base).toLowerCase() === ".ttc" && rest === "") return "all";
  rest = rest.replace(/^(mt|ps|psmt)/, "").replace(/^regular(?=italic|oblique)/, "");
  if (rest === "" || rest === "regular" || rest === "roman" || rest === "book") return "regular";
  if (rest === "bold") return "bold";
  if (rest === "italic" || rest === "oblique") return "italic";
  if (rest === "bolditalic" || rest === "boldoblique") return "boldItalic";
  return null;
}

/** Finds a family's four faces in the folders; null when its regular face is not there. */
export function findFamily(family: string, dirs: string[]): Record<Variant, FontFace> | null {
  const found: Partial<Record<Variant, FontFace>> = {};
  for (const dir of dirs) {
    for (const file of fontFiles(dir)) {
      const v = fileVariant(file, family);
      if (v === "all") {
        const ps = family.replace(/\s+/g, "");
        for (const variant of VARIANTS) found[variant] ??= { path: file, postscriptName: `${ps}-${variant === "boldItalic" ? "BoldItalic" : variant[0]!.toUpperCase() + variant.slice(1)}` };
      } else if (v) found[v] ??= { path: file };
    }
    if (found.regular && found.bold && found.italic && found.boldItalic) break;
  }
  if (!found.regular) return null;
  const regular = found.regular;
  const bold = found.bold ?? regular;
  const italic = found.italic ?? regular;
  return { regular, bold, italic, boldItalic: found.boldItalic ?? found.bold ?? found.italic ?? regular };
}

export interface ResolvedFonts {
  faces: FontFaces;
  /** Families not installed, with the font printed instead. */
  substituted: Record<string, string>;
}

/**
 * The faces for `families`: bundled ones from `bundledDir`; others from `dirs` (default: the
 * system's font folders), else the bundled substitute. Faces are keyed by the family asked for,
 * so layouts name the template's own fonts whatever is printed.
 */
export function resolveFonts(families: string[], bundledDir: string, dirs: string[] = systemFontDirs()): ResolvedFonts {
  const faces: FontFaces = {};
  const substituted: Record<string, string> = {};
  const bundled = (family: string) => Object.fromEntries(VARIANTS.map((v) => [v, { path: join(bundledDir, BUNDLED[family]![v]) }])) as Record<Variant, FontFace>;
  for (const family of new Set(families)) {
    let set = BUNDLED[family] ? bundled(family) : findFamily(family, dirs);
    if (!set) {
      const sub = SUBSTITUTE[family] ?? "Lato";
      substituted[family] = sub;
      set = bundled(sub);
    }
    for (const v of VARIANTS) faces[faceKey(family, v)] = set[v];
  }
  return { faces, substituted };
}

/** Measures text with the same font engine that draws it (PDFKit's, with kerning and ligatures). */
export class Measurer {
  readonly #doc: PDFKit.PDFDocument;
  readonly #registered = new Set<string>();
  readonly #faces: FontFaces;
  readonly #cache = new Map<string, number>();

  constructor(faces: FontFaces) {
    this.#faces = faces;
    this.#doc = new PDFDocument({ autoFirstPage: false });
  }

  /** Width in points of one run of text in a family, variant and size. */
  width(text: string, family: string, variant: Variant, size: number): number {
    if (text === "") return 0;
    const key = faceKey(family, variant);
    const id = `${key}|${size}|${text}`;
    const hit = this.#cache.get(id);
    if (hit !== undefined) return hit;
    const face = this.#faces[key];
    if (!face) throw new Error(`No font for ${key}`);
    if (!this.#registered.has(key)) {
      if (!existsSync(face.path)) throw new Error(`Font file missing: ${face.path}`);
      this.#doc.registerFont(key, face.path, face.postscriptName);
      this.#registered.add(key);
    }
    const w = this.#doc.font(key).fontSize(size).widthOfString(text);
    if (this.#cache.size > 20000) this.#cache.clear();
    this.#cache.set(id, w);
    return w;
  }

  /** Width of styled runs (each run's font and size from its style, else `base`). */
  runs(runs: Run[], base: { font: string; size: number }): number {
    let w = 0;
    for (const r of runs) w += this.width(r.text, r.style.font ?? base.font, variantOf(r.style), r.style.size ?? base.size);
    return w;
  }
}
