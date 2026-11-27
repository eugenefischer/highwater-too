import { sceneHeadingPrefix, scriptTerms, type Document } from "@highwater/parser";

/** What a screenplay already uses: character names by how often they speak, and scene locations. */
export interface ScriptVocabulary {
  characters: string[];
  locations: string[];
}

export const SCENE_PREFIXES = ["INT. ", "EXT. ", "INT./EXT. ", "I/E. ", "EST. "];
export const TIMES = ["DAY", "NIGHT", "CONTINUOUS", "LATER", "MOMENTS LATER", "MORNING", "AFTERNOON", "EVENING", "SAME"];
export const TRANSITIONS = ["CUT TO:", "FADE OUT.", "FADE IN:", "DISSOLVE TO:", "SMASH CUT TO:", "MATCH CUT TO:", "JUMP CUT TO:", "FADE TO BLACK."];

const PREFIX = /^(?:\.(?!\.)|(?:INT\.?\/EXT|INT|EXT|EST|I\/E)[.\s])\s*/i;

/** A scene heading's prefix at the start of a line, spaces after it included (custom terms when they're on). */
function headingPrefix(text: string): string | null {
  if (!scriptTerms()) return PREFIX.exec(text)?.[0] ?? null;
  if (/^\.(?!\.)/.test(text)) return /^\.\s*/.exec(text)![0];
  const n = sceneHeadingPrefix(text);
  return n === null ? null : text.slice(0, n) + (/^\s*/.exec(text.slice(n))?.[0] ?? "");
}

/** What completion offers for headings, times and transitions (the International settings' lists when custom terms are on). */
export interface CompletionTerms {
  prefixes: string[];
  times: string[];
  transitions: string[];
}

export function vocabulary(doc: Document): ScriptVocabulary {
  const speaks = new Map<string, number>();
  const places = new Map<string, number>();
  for (const e of doc.elements) {
    if (e.kind === "dialogue" && e.character.trim()) speaks.set(e.character.trim(), (speaks.get(e.character.trim()) ?? 0) + 1);
    if (e.kind === "sceneHeading") {
      const prefix = headingPrefix(e.text);
      const place = (prefix ? e.text.slice(prefix.length) : e.text).split(/\s+-\s+/)[0]!.trim();
      if (place) places.set(place, (places.get(place) ?? 0) + 1);
    }
  }
  const byUse = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  return { characters: byUse(speaks), locations: byUse(places) };
}

export type Suggestion = { label: string; kind: "character" | "scene" | "location" | "time" | "transition"; insert: string; replaceFrom: number };

/**
 * Suggestions for the line being typed, given the text before the cursor on that line and whether
 * the line above is empty (cues, headings and transitions start after an empty line).
 * `replaceFrom` is the column the suggestion replaces from.
 */
export function suggest(before: string, afterBlank: boolean, vocab: ScriptVocabulary, terms: CompletionTerms | null = null): Suggestion[] {
  if (!afterBlank) return [];
  const lists = terms ?? { prefixes: SCENE_PREFIXES, times: TIMES, transitions: TRANSITIONS };
  // In a scene heading: the location after the prefix, then the time after " - ".
  const heading = headingPrefix(before);
  if (heading !== null) {
    const rest = before.slice(heading.length);
    const dash = rest.lastIndexOf(" - ");
    if (dash >= 0) {
      const from = heading.length + dash + 3;
      return lists.times.map((t) => ({ label: t, kind: "time" as const, insert: t, replaceFrom: from }));
    }
    return vocab.locations.map((l) => ({ label: l, kind: "location" as const, insert: `${l} - `, replaceFrom: heading.length }));
  }
  // Otherwise only on a line typed in capitals so far, two characters at least: a cue, heading or
  // transition being started, not the capital that opens every line of action. Capitals in any
  // alphabet (ÉLODIE, JOSÉ), by the parser's own test for a cue: no lower-case letter.
  if (!/^\p{Lu}[^\p{Ll}]+$/u.test(before)) return [];
  const out: Suggestion[] = [];
  for (const c of vocab.characters) out.push({ label: c, kind: "character", insert: c, replaceFrom: 0 });
  for (const p of lists.prefixes) out.push({ label: p.trim(), kind: "scene", insert: p, replaceFrom: 0 });
  for (const t of lists.transitions) out.push({ label: t, kind: "transition", insert: t, replaceFrom: 0 });
  return out;
}

/** Highland's marker, as Insert Marker writes it. */
export function markerText(label: string): string {
  return label.trim() ? `{{%m: ${label.trim()}}}` : "{{%m}}";
}

/** Offsets of every marker in the text. */
export function markerOffsets(text: string): number[] {
  return [...text.matchAll(/\{\{\s*%m\b[^}]*\}\}/gi)].map((m) => m.index!);
}

/** The first marker after `offset`, wrapping to the first one; null when there are none. */
export function nextMarker(text: string, offset: number): number | null {
  const all = markerOffsets(text);
  return all.find((o) => o > offset) ?? all[0] ?? null;
}
