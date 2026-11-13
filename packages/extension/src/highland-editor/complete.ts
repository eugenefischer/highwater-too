/**
 * Completion in the Highwater Editor, as in the text editor: on a line after an empty
 * one, typed in capitals, the characters who already speak (most frequent first), scene-heading
 * prefixes and transitions; after INT. or EXT., the script's locations; after " - ", times of day.
 * Screenplays only. The suggestions come from the same pure function the text editor uses.
 */
import { acceptCompletion, autocompletion, insertCompletionText, startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type { Document } from "@highwater/parser";
import { suggest, vocabulary } from "../syntax/completion.ts";

const TYPES = { character: "variable", scene: "keyword", location: "namespace", time: "enum", transition: "keyword" } as const;

/** `current()` gives the latest parse of the text, or null when the document isn't a screenplay. */
export function screenplayCompletion(current: () => Document | null) {
  const source = (context: CompletionContext): CompletionResult | null => {
    const doc = current();
    if (!doc) return null;
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const afterBlank = line.number === 1 || context.state.doc.line(line.number - 1).text.trim() === "";
    let list = suggest(before, afterBlank, vocabulary(doc));
    // A typed space only brings up a heading's location or time, never the cue list.
    if (!context.explicit && before.endsWith(" ")) list = list.filter((s) => s.kind === "location" || s.kind === "time");
    if (!list.length) return null;
    const from = line.from + list[0]!.replaceFrom;
    // Not what is already typed: the line being typed is in the parse too ("INT. K" makes a location "K").
    const typed = context.state.sliceDoc(from, context.pos).trim();
    list = list.filter((s) => s.label !== typed);
    if (!list.length) return null;
    const options: Completion[] = list.map((s, i) => ({
      label: s.label,
      detail: s.kind,
      type: TYPES[s.kind],
      boost: Math.max(-99, -i), // keep the order suggest() gives (characters by how often they speak)
      apply: (view: EditorView, _c: Completion, at: number, to: number) => {
        view.dispatch(insertCompletionText(view.state, s.insert, at, to));
        // After a heading's prefix, offer the script's locations; after a location, the times.
        if (s.kind === "scene" || s.kind === "location") startCompletion(view);
      },
    }));
    return { from, options };
  };
  // Tab accepts as well as Enter, as in VS Code (ahead of Tab's indent).
  return [autocompletion({ override: [source], icons: false, activateOnTyping: true }), Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }]))];
}
