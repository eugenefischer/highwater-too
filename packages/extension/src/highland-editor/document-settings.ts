/**
 * The Document settings, as Highland 2's Settings window has them (for every script, kept as VS
 * Code settings `highwater.<key>`). EJ (2026-11-14): Auto-uppercase makes the whole heading
 * capitals; Bold and Underlined apply to the editor and the PDF, Double-Spaced to the PDF only;
 * MORE/CONT'D off only leaves them out (a speech still breaks in the same place); Italicized
 * synopses apply to the editor and to printed synopses.
 */
export interface DocumentSettings {
  sceneHeadingBold: boolean;
  sceneHeadingUnderline: boolean;
  sceneHeadingDoubleSpaced: boolean;
  /** Typing a scene heading (INT., EXT. …) puts the whole heading in capitals. */
  autoUppercaseSceneHeadings: boolean;
  autoCompleteLocations: boolean;
  autoCompleteCharacterNames: boolean;
  /** "(MORE)" and "(CONT’D)" where a speech breaks across pages. */
  moreContd: boolean;
  synopsesItalic: boolean;
}

export const DOCUMENT_DEFAULTS: DocumentSettings = {
  sceneHeadingBold: true,
  sceneHeadingUnderline: false,
  sceneHeadingDoubleSpaced: true,
  autoUppercaseSceneHeadings: true,
  autoCompleteLocations: true,
  autoCompleteCharacterNames: true,
  moreContd: true,
  synopsesItalic: false,
};

/** The settings that change the printed pages (a change lays open documents out again). */
export const PRINTED_DOCUMENT_SETTINGS: (keyof DocumentSettings)[] = ["sceneHeadingBold", "sceneHeadingUnderline", "sceneHeadingDoubleSpaced", "moreContd", "synopsesItalic"];

/** Stored values made sound: anything but true or false falls back to the default. */
export function documentSettings(read: (key: keyof DocumentSettings) => unknown): DocumentSettings {
  const out = { ...DOCUMENT_DEFAULTS };
  for (const key of Object.keys(DOCUMENT_DEFAULTS) as (keyof DocumentSettings)[]) {
    const v = read(key);
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

/**
 * A scene heading's line in capitals (Auto-uppercase INT. and EXT.): a line that starts with a
 * heading's prefix, its letters uppercased except inside notes. Null when it isn't one or has
 * nothing to change. Characters whose capital is longer (ß) stay, so offsets don't move.
 */
export function uppercasedHeading(line: string): string | null {
  if (!/^(?:INT\.?\/EXT|INT|EXT|EST|I\/E)[.\s]/i.test(line)) return null;
  let out = "";
  let inNote = false;
  for (let i = 0; i < line.length; i++) {
    if (line.startsWith("[[", i)) inNote = true;
    else if (line.startsWith("]]", i - 1) && i > 0) inNote = false;
    const c = line[i]!;
    const up = c.toUpperCase();
    out += !inNote && up.length === 1 ? up : c;
  }
  return out === line ? null : out;
}
