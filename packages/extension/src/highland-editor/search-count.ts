/**
 * The number of matches in the Find box (⌘F), beside the search field, as VS Code's own find
 * widget shows it: "3 of 12" when the selection is a match (after Enter or the arrows), "12 matches"
 * otherwise, "No results" when nothing matches. Counted over the whole text, up to MAX.
 */
import { getSearchQuery, searchPanelOpen, type SearchQuery } from "@codemirror/search";
import type { EditorState } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

/** Beyond this many matches the count reads "10000+" (counting stops, so a huge text stays quick). */
export const MAX = 10_000;

/** Where every match starts and ends (at most MAX), in order. */
export function matchesOf(state: EditorState, query: SearchQuery): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  if (!query.search || !query.valid) return out;
  const cursor = query.getCursor(state) as Iterator<{ from: number; to: number }>;
  for (let r = cursor.next(); !r.done && out.length <= MAX; r = cursor.next()) out.push({ from: r.value.from, to: r.value.to });
  return out;
}

/** What the count says, given the matches and the selection. */
export function countLabel(matches: { from: number; to: number }[], selection: { from: number; to: number }): string {
  if (!matches.length) return "No results";
  const over = matches.length > MAX;
  const total = over ? `${MAX}+` : String(matches.length);
  // Binary search for a match exactly at the selection.
  let lo = 0;
  let hi = Math.min(matches.length, MAX) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = matches[mid]!;
    if (m.from < selection.from) lo = mid + 1;
    else if (m.from > selection.from) hi = mid - 1;
    else return m.to === selection.to ? `${mid + 1} of ${total}` : `${total} ${matches.length === 1 ? "match" : "matches"}`;
  }
  return `${total} ${matches.length === 1 ? "match" : "matches"}`;
}

export const searchCount = ViewPlugin.fromClass(
  class {
    #query: SearchQuery | null = null;
    #matches: { from: number; to: number }[] = [];

    constructor(readonly view: EditorView) {
      this.#refresh(true);
    }

    update(u: ViewUpdate) {
      const query = getSearchQuery(u.state);
      const changed = u.docChanged || !this.#query || !query.eq(this.#query);
      if (changed || u.selectionSet || searchPanelOpen(u.state) !== searchPanelOpen(u.startState)) this.#refresh(changed);
    }

    #refresh(recount: boolean) {
      const state = this.view.state;
      if (!searchPanelOpen(state)) {
        this.#query = null;
        this.#matches = [];
        return;
      }
      if (recount) {
        this.#query = getSearchQuery(state);
        this.#matches = matchesOf(state, this.#query);
      }
      // The panel is made when it opens; its count is put in once, after the search field.
      const panel = this.view.dom.querySelector(".cm-panel.cm-search");
      const field = panel?.querySelector<HTMLInputElement>("input[name=search]");
      if (!panel || !field) return;
      let count = panel.querySelector<HTMLElement>(".hl-search-count");
      if (!count) {
        count = document.createElement("span");
        count.className = "hl-search-count";
        count.setAttribute("aria-live", "polite");
        field.after(count);
      }
      const q = this.#query!;
      count.textContent = !q.search ? "" : !q.valid ? "Invalid pattern" : countLabel(this.#matches, state.selection.main);
      count.classList.toggle("none", !!q.search && (!q.valid || !this.#matches.length));
    }
  },
);
