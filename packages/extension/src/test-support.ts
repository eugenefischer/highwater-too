/**
 * Commands only the end-to-end tests use (registered in Test mode only): what the panes follow,
 * scrolling the Highwater Editor, the editor-swap log, scripts opening as text (for the tests of
 * the text editor), and Revert to a save. ask.ts registers the tests' scripted
 * answers itself, since they work through its questions.
 */
import * as vscode from "vscode";
import { focusedDocument } from "./focus.ts";
import { swapLog } from "./highland-editor/provider.ts";
import { pageCountOf } from "./page-count.ts";
import { activeDocument, activeView, editorDefaults } from "./surface.ts";
import { historyApi } from "./history.ts";

export function registerTestCommands(context: vscode.ExtensionContext): void {
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      // What the panes follow, for the end-to-end tests of the Highwater Editor.
      vscode.commands.registerCommand("highwater.test.surface", () => {
        const view = activeView();
        return { document: activeDocument()?.uri.toString(), view: !!view, ready: view?.ready, pagesSent: view?.pagesSent, selection: view?.selections[0], focused: focusedDocument().key, focusedText: focusedDocument().script?.getText(), pageCount: (() => { const d = activeDocument(); return d ? pageCountOf(d) : undefined; })() };
      }),
      vscode.commands.registerCommand("highwater.test.revealInView", (offset: number) => activeView()?.reveal(offset, "center", true)),
      vscode.commands.registerCommand("highwater.test.swapLog", () => swapLog.splice(0)),
      // Scripts open in VS Code's text editor while this is false (the Highwater Editor otherwise).
      vscode.commands.registerCommand("highwater.test.textEditorDefault", (on: boolean) => void (editorDefaults.highwater = !on)),
      // Revert to This Save, as the Writing History panel asks for it: true if it went through.
      vscode.commands.registerCommand("highwater.test.revert", (key: string, hash: string) => historyApi?.revert(key, hash) ?? false),
    );
  }
}
