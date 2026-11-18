import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Typewriter Scrolling (Highland's View menu; app-wide): the line being typed stays at one height,
 * one line below the middle of the editor (EJ, 2026-11-18; Highland's own height, measured from two
 * screenshots, is within about half a line of it). Typing, Return and deleting bring the cursor's
 * line back there; clicking, the arrow keys and scrolling don't. Space above and below the text lets
 * the first and last lines reach that height too, so a short or empty document starts there.
 */

/** Where the typing line's centre sits, from the top of the editor's visible area. */
let target = 0;

/** The typing line's centre: one line below the middle of what shows. */
function measure(view: EditorView): { target: number; top: number; bottom: number } {
  const height = view.scrollDOM.clientHeight;
  const line = view.defaultLineHeight;
  const centre = height / 2 + line;
  return { target: centre, top: Math.max(0, centre - line / 2), bottom: Math.max(0, height - centre - line / 2) };
}

/** Keeps the space above and below the text right as the editor's size or text size changes. */
const spacing = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.place();
    }
    update(u: ViewUpdate) {
      if (u.geometryChanged || u.heightChanged) this.place();
    }
    place() {
      this.view.requestMeasure({
        read: (v) => measure(v),
        write: (m, v) => {
          target = m.target;
          v.dom.style.setProperty("--tw-top", `${m.top}px`);
          v.dom.style.setProperty("--tw-bottom", `${m.bottom}px`);
        },
      });
    }
    destroy() {
      this.view.dom.style.removeProperty("--tw-top");
      this.view.dom.style.removeProperty("--tw-bottom");
    }
  },
);

/** Typing and deleting (and undo, which types for you) scroll the cursor's line to the height. */
const follow = EditorState.transactionExtender.of((tr) => {
  if (!tr.docChanged || !target) return null;
  if (!(tr.isUserEvent("input") || tr.isUserEvent("delete") || tr.isUserEvent("undo") || tr.isUserEvent("redo"))) return null;
  // The cursor's line box at the target: its top half a line above it.
  return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: "start", yMargin: Math.max(0, target - lineHeight / 2) }) };
});

let lineHeight = 0;
const lineHeightWatch = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      lineHeight = view.defaultLineHeight;
    }
    update(u: ViewUpdate) {
      lineHeight = u.view.defaultLineHeight;
    }
  },
);

/** On: the class that adds the space (page.css), the spacing and the following. */
export function typewriter(on: boolean): Extension {
  return on ? [EditorView.editorAttributes.of({ class: "hl-typewriter" }), spacing, lineHeightWatch, follow] : [];
}
