/**
 * Spelling in the Highland-Style Editor: which words to check, as pure functions (tested). The
 * dictionary (Hunspell's American English, via nspell) runs in a worker; see spelling.ts.
 */
import { hiddenRanges, type Document } from "@highwater/parser";
import { lineStyles } from "./line-styles.ts";

export interface Word {
  from: number;
  to: number;
  text: string;
}

/** What a script's spelling leaves alone: ranges not checked, and its characters' names. */
export interface SpellContext {
  /** Sorted, possibly overlapping source ranges. */
  skip: { from: number; to: number }[];
  /** Lower-case words of the character cues (MARA in a cue is fine as Mara in action too). */
  names: Set<string>;
}

/** Scene heading prefixes, which no dictionary has. */
const SCENE_WORDS = new Set(["int", "ext", "est"]);

/** Addresses, link targets, link definitions, e-mail addresses and Highwater's own notes. */
const NOT_WORDS = /\b(?:https?:\/\/|www\.)\S+|\]\([^)]*\)|\]\[[^\]]*\]|^[ \t]*\[[^\]\n]+\]:[^\n]*|\S+@\S+\.\S+|\[\[highwater:[^\]]*\]\]/gim;

export function spellContext(doc: Document): SpellContext {
  const skip: { from: number; to: number }[] = [];
  const add = (from: number, to: number) => to > from && skip.push({ from, to });
  for (const h of hiddenRanges(doc.overlays)) add(h.start, h.end);
  for (const d of doc.directives) add(d.span.start, d.span.end);
  for (const f of doc.titlePage?.fields ?? []) add(f.keySpan.start, f.keySpan.end + 1);
  for (const m of doc.source.matchAll(NOT_WORDS)) add(m.index, m.index + m[0].length);
  const names = new Set<string>();
  const src = doc.source;
  for (const [from, style] of lineStyles(doc)) {
    if (style.kind !== "cue") continue;
    let to = src.indexOf("\n", from);
    if (to < 0) to = src.length;
    add(from, to);
    for (const w of tokens(src.slice(from, to), from)) names.add(key(w.text).toLowerCase());
  }
  skip.sort((a, b) => a.from - b.from);
  return { skip, names };
}

const TOKEN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

function tokens(text: string, offset: number): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(TOKEN)) out.push({ from: offset + m.index, to: offset + m.index + m[0].length, text: m[0] });
  return out;
}

/** The form the dictionary knows: straight apostrophes. */
export function key(word: string): string {
  return word.replace(/’/g, "'");
}

/** The words of `text` (which starts at `offset` in the source) that should be checked. */
export function wordsToCheck(text: string, offset: number, ctx: SpellContext): Word[] {
  const out: Word[] = [];
  let s = 0;
  for (const w of tokens(text, offset)) {
    if (w.text.length < 2 || /\p{N}/u.test(w.text)) continue;
    while (s < ctx.skip.length && ctx.skip[s]!.to <= w.from) s++;
    // Inside a skipped range (any of those starting before the word's end).
    let skipped = false;
    for (let k = s; k < ctx.skip.length && ctx.skip[k]!.from < w.to; k++) if (ctx.skip[k]!.to > w.from) skipped = true;
    if (skipped) continue;
    const lower = key(w.text).toLowerCase();
    if (SCENE_WORDS.has(lower) || ctx.names.has(lower) || ctx.names.has(lower.replace(/'s$/, ""))) continue;
    out.push(w);
  }
  return out;
}

/** A suggestion in the misspelling's case: Capitalised or CAPITALS, and its kind of apostrophe. */
export function matchCase(original: string, suggestion: string): string {
  let s = suggestion;
  if (original.includes("’")) s = s.replace(/'/g, "’");
  const letters = original.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return s.toUpperCase();
  if (/^\p{Lu}/u.test(original) && /^\p{Ll}/u.test(s)) return s[0]!.toUpperCase() + s.slice(1);
  return s;
}

export { rankGuesses } from "./spell-rank.ts";
