/**
 * Custom terms (the International settings' "Use custom terms", as Highland 2's): the words that
 * start a scene heading and end a transition, in place of Fountain's. They change what counts as
 * a heading or transition in every parse until set again. Null: Fountain's own rules.
 */
export interface ScriptTerms {
  /** A line starting with one of these (any case) is a scene heading: "INT.", "EXT.", "INNEN." */
  sceneHeadings: string[];
  /** A line in capitals ending with one of these is a transition: "TO:", "FADE OUT." */
  transitions: string[];
}

const SCENE = /^(?:INT\.?\/EXT|INT\/EXT|I\/E|INT|EXT|EST)[.\s]/i;
const TRANSITION = /^[^\p{Ll}]*TO:$/u;

let terms: ScriptTerms | null = null;
let generation = 0;

/** Sets the custom terms (null for Fountain's), for every parse from now on. */
export function setScriptTerms(next: ScriptTerms | null): void {
  const clean = next && { sceneHeadings: tidy(next.sceneHeadings), transitions: tidy(next.transitions) };
  if (JSON.stringify(clean) === JSON.stringify(terms)) return;
  terms = clean;
  generation++;
}

/** Bumped whenever the terms change: a cached parse from an older generation is stale. */
export function scriptTermsGeneration(): number {
  return generation;
}

/** The custom terms in force, or null. */
export function scriptTerms(): ScriptTerms | null {
  return terms;
}

/** How long the scene heading's prefix is at the start of `text` (a line), or null if it doesn't start one. */
export function sceneHeadingPrefix(text: string): number | null {
  if (!terms) return SCENE.exec(text)?.[0].length ?? null;
  const upper = text.toUpperCase();
  let best: number | null = null;
  for (const term of terms.sceneHeadings) {
    const t = term.toUpperCase();
    if (!upper.startsWith(t)) continue;
    // "INT" mustn't take "INTERIOR"; a term ending in a full stop or the like can be followed by anything.
    const after = text[t.length];
    if (after !== undefined && /[\p{L}\p{N}]$/u.test(t) && /[\p{L}\p{N}]/u.test(after)) continue;
    if (best === null || t.length > best) best = t.length;
  }
  return best;
}

export function isSceneHeadingText(text: string): boolean {
  return sceneHeadingPrefix(text) !== null;
}

/** A transition's line: in capitals and ending with a transition term (Fountain: "TO:"). */
export function isTransitionText(text: string): boolean {
  if (!terms) return TRANSITION.test(text);
  if (/\p{Ll}/u.test(text)) return false;
  const upper = text.trimEnd().toUpperCase();
  return terms.transitions.some((t) => upper.endsWith(t.toUpperCase()));
}

function tidy(list: string[]): string[] {
  return list.map((s) => s.trim()).filter(Boolean);
}
