import type { ScriptTerms } from "@highwater/parser";

/**
 * The International settings, as Highland 2's Settings window has them: with "Use custom terms",
 * your own scene-heading prefixes, times of day and transitions (they decide what counts as a
 * heading or transition as well as what completion offers) and the words printed for (MORE) and
 * (CONT'D) where a speech breaks across pages. Kept as VS Code settings `highwater.<key>`.
 */
export interface InternationalSettings {
  useCustomTerms: boolean;
  customLocations: string[];
  customTimes: string[];
  customTransitions: string[];
  customMore: string;
  customContd: string;
}

/** Highland's lists (EJ's screenshot of its International settings). */
export const INTERNATIONAL_DEFAULTS: InternationalSettings = {
  useCustomTerms: false,
  customLocations: ["INT.", "EXT.", "EST.", "I./E.", "E./I."],
  customTimes: ["DAY", "NIGHT", "LATER", "CONTINUOUS", "MORNING", "AFTERNOON", "DAWN", "DUSK", "EVENING", "SUNSET", "MAGIC HOUR", "THE NEXT DAY", "MOMENTS LATER"],
  customTransitions: ["TO:", "FADE OUT."],
  customMore: "(MORE)",
  customContd: "(CONT’D)",
};

const LISTS = ["customLocations", "customTimes", "customTransitions"] as const;

/** Stored values made sound: lists of words (blanks dropped), non-empty wording, else the defaults. */
export function internationalSettings(read: (key: keyof InternationalSettings) => unknown): InternationalSettings {
  const out: InternationalSettings = { ...INTERNATIONAL_DEFAULTS };
  out.useCustomTerms = read("useCustomTerms") === true;
  for (const key of LISTS) {
    const v = read(key);
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) out[key] = v.map((x: string) => x.trim()).filter(Boolean);
  }
  for (const key of ["customMore", "customContd"] as const) {
    const v = read(key);
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

/** The terms the parser recognizes: null (Fountain's own) unless custom terms are on. */
export function scriptTermsOf(s: InternationalSettings): ScriptTerms | null {
  return s.useCustomTerms ? { sceneHeadings: s.customLocations, transitions: s.customTransitions } : null;
}

/** What completion offers: the custom lists, or null for the built-in ones. */
export function completionTermsOf(s: InternationalSettings): { prefixes: string[]; times: string[]; transitions: string[] } | null {
  return s.useCustomTerms ? { prefixes: s.customLocations.map((p) => `${p} `), times: s.customTimes, transitions: s.customTransitions } : null;
}

/** The (MORE) and (CONT'D) words to print, or nothing for the usual ones. */
export function speechBreakWordsOf(s: InternationalSettings): { more?: string; contd?: string } {
  return s.useCustomTerms ? { more: s.customMore, contd: s.customContd } : {};
}
