import * as vscode from "vscode";
import { askText } from "./ask.ts";
import { join } from "node:path";
import { markerText, nextMarker } from "./syntax/completion.ts";
import { activeOffsets, editActive, revealOffset } from "./surface.ts";

/** Markers and the syntax cheat sheet (completion is the Highwater Editor's own: highland-editor/complete.ts). */
export function registerWritingTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.insertMarker", async () => {
      const active = activeOffsets();
      if (!active) return;
      const label = await askText({ title: "Insert Marker", prompt: "A label for the marker (optional); it shows in the Navigator." });
      if (label === undefined) return;
      const sel = active.selections[0] ?? { anchor: 0, head: 0 };
      const start = Math.min(sel.anchor, sel.head);
      const text = markerText(label);
      await editActive(active.document, [{ start, end: Math.max(sel.anchor, sel.head), text }], [{ anchor: start + text.length, head: start + text.length }]);
    }),
    vscode.commands.registerCommand("highwater.nextMarker", async () => {
      const active = activeOffsets();
      if (!active) return;
      const doc = active.document;
      const at = nextMarker(doc.getText(), active.selections[0]?.head ?? 0);
      if (at === null) {
        void vscode.window.showInformationMessage("No markers in this document. Insert one with ⌃M.");
        return;
      }
      await revealOffset(doc, at, "center", true);
    }),
    vscode.commands.registerCommand("highwater.cheatSheet", () =>
      vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.file(join(context.extensionPath, "media", "cheatsheet.md"))),
    ),
  );
}
