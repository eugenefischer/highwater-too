/**
 * Commands only the end-to-end tests use (registered in Test mode only): what the panes follow,
 * scrolling the Highwater Editor, and the editor-swap log. ask.ts registers the tests' scripted
 * answers itself, since they work through its questions.
 */
import * as vscode from "vscode";
import { focusedDocument } from "./focus.ts";
import { swapLog } from "./highland-editor/provider.ts";
import { pageCountOf } from "./page-count.ts";
import { activeDocument, activeView } from "./surface.ts";

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
    );
  }
}
