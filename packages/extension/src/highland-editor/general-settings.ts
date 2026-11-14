/**
 * The General settings, as Highland 2's Settings window has them (settings for every document,
 * kept as VS Code settings `highwater.<key>`). Values measured from EJ's screenshots of Highland
 * (2026-11-14; claude/highland-settings.md in the project).
 */
export interface GeneralSettings {
  /** The editor's font: both are monospaced with the same width, so lines still match print. */
  editorFont: EditorFont;
  /** Narrow is the printed width; Medium and Wide widen the column (lines no longer match print). */
  columnWidth: ColumnWidth;
  lineSpacing: LineSpacing;
  /** Show Invisibles' marks, 0 (faintest) to 100. */
  invisiblesBrightness: number;
  /** Reopening a document puts the cursor back where it was. */
  saveCursorPosition: boolean;
  /** The sidebar's text size. */
  sidebarText: SidebarText;
  /** The Navigator shows names with their markup (# for sections, = for synopses, [[ ]] for notes). */
  navigatorMarkup: boolean;
  /** The word count leaves out the words in notes. */
  excludeNotesFromWordCount: boolean;
}

export const EDITOR_FONTS = ["Courier Prime", "Highland Sans"] as const;
export type EditorFont = (typeof EDITOR_FONTS)[number];
export const COLUMN_WIDTHS = ["narrow", "medium", "wide"] as const;
export type ColumnWidth = (typeof COLUMN_WIDTHS)[number];
export const LINE_SPACINGS = ["tight", "normal", "loose"] as const;
export type LineSpacing = (typeof LINE_SPACINGS)[number];
export const SIDEBAR_TEXTS = ["normal", "large", "largest"] as const;
export type SidebarText = (typeof SIDEBAR_TEXTS)[number];

export const GENERAL_DEFAULTS: GeneralSettings = {
  editorFont: "Courier Prime",
  columnWidth: "narrow",
  lineSpacing: "normal",
  invisiblesBrightness: 100,
  saveCursorPosition: false,
  sidebarText: "normal",
  navigatorMarkup: false,
  excludeNotesFromWordCount: false,
};

/** Line height for each spacing, times the text size (Highland: 32, 44 and 56 px lines for 34 px text). */
export const LINE_HEIGHTS: Record<LineSpacing, number> = { tight: 0.94, normal: 1.3, loose: 1.65 };

/** The sidebar's text for each size, times the normal size (Highland's Navigator: capitals 16, 19 and 23 px tall). */
export const SIDEBAR_SCALES: Record<SidebarText, number> = { normal: 1, large: 1.2, largest: 1.4 };

/** Show Invisibles' marks: their opacity for a brightness (0 is faint but still there). */
export function invisiblesOpacity(brightness: number): number {
  return 0.15 + (0.85 * Math.min(100, Math.max(0, brightness))) / 100;
}

/** A stored value made sound: unknown or missing values fall back to the defaults. */
export function generalSettings(read: (key: keyof GeneralSettings) => unknown): GeneralSettings {
  const pick = <T extends string>(key: keyof GeneralSettings, options: readonly T[], fallback: T): T => {
    const v = read(key);
    return options.includes(v as T) ? (v as T) : fallback;
  };
  const brightness = read("invisiblesBrightness");
  return {
    editorFont: pick("editorFont", EDITOR_FONTS, GENERAL_DEFAULTS.editorFont),
    columnWidth: pick("columnWidth", COLUMN_WIDTHS, GENERAL_DEFAULTS.columnWidth),
    lineSpacing: pick("lineSpacing", LINE_SPACINGS, GENERAL_DEFAULTS.lineSpacing),
    invisiblesBrightness: typeof brightness === "number" && Number.isFinite(brightness) ? Math.min(100, Math.max(0, brightness)) : GENERAL_DEFAULTS.invisiblesBrightness,
    saveCursorPosition: read("saveCursorPosition") === true,
    sidebarText: pick("sidebarText", SIDEBAR_TEXTS, GENERAL_DEFAULTS.sidebarText),
    navigatorMarkup: read("navigatorMarkup") === true,
    excludeNotesFromWordCount: read("excludeNotesFromWordCount") === true,
  };
}
