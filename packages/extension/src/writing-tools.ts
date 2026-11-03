import * as vscode from "vscode";
import { askText } from "./ask.ts";
import { join } from "node:path";
import { LANGUAGES, type ParseCache } from "./language.ts";
import { markerText, nextMarker, suggest, vocabulary } from "./syntax/completion.ts";
import { activeOffsets, editActive, revealOffset } from "./surface.ts";

const KINDS = {
  character: vscode.CompletionItemKind.Value,
  scene: vscode.CompletionItemKind.Keyword,
  location: vscode.CompletionItemKind.Reference,
  time: vscode.CompletionItemKind.EnumMember,
  transition: vscode.CompletionItemKind.Keyword,
} as const;

/** M9: completion in screenplays, markers, and the syntax cheat sheet. */
export function registerWritingTools(context: vscode.ExtensionContext, cache: ParseCache): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: LANGUAGES.fountain },
      {
        provideCompletionItems(document, position, _token, context) {
          const before = document.lineAt(position.line).text.slice(0, position.character);
          const afterBlank = position.line === 0 || document.lineAt(position.line - 1).isEmptyOrWhitespace;
          let list = suggest(before, afterBlank, vocabulary(cache.get(document)));
          // A typed space only brings up a heading's location or time, never the cue list.
          if (context.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter) list = list.filter((s) => s.kind === "location" || s.kind === "time");
          return list.map((s, i) => {
            const item = new vscode.CompletionItem({ label: s.label, description: s.kind }, KINDS[s.kind]);
            item.insertText = s.insert;
            item.range = new vscode.Range(position.line, s.replaceFrom, position.line, position.character);
            item.sortText = String(i).padStart(4, "0");
            // After a location, offer the times straight away.
            if (s.kind === "location") item.command = { command: "editor.action.triggerSuggest", title: "" };
            return item;
          });
        },
      },
      " ",
    ),
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
