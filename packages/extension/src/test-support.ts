/**
 * Commands only the end-to-end tests use (registered in Test mode only): what the panes follow,
 * scrolling the Highwater Editor, the editor-swap log, the sidebar's panel, and Revert to a save. ask.ts registers the tests' scripted
 * answers itself, since they work through its questions.
 */
import * as vscode from "vscode";
import { postTo } from "./highland-editor/messages.ts";
import { focusedDocument } from "./focus.ts";
import { swapLog } from "./highland-editor/provider.ts";
import { pageCountOf } from "./page-count.ts";
import { activeDocument, activeView } from "./surface.ts";
import { historyApi } from "./history.ts";
import { worksViewForTests } from "./highland-editor/works-view-provider.ts";

export function registerTestCommands(context: vscode.ExtensionContext): void {
  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      // What the panes follow, for the end-to-end tests of the Highwater Editor.
      vscode.commands.registerCommand("highwater.test.surface", () => {
        const view = activeView();
        return { document: activeDocument()?.uri.toString(), view: !!view, ready: view?.ready, pagesSent: view?.pagesSent, selection: view?.selections[0], focused: focusedDocument().key, focusedText: focusedDocument().script?.getText(), pageCount: (() => { const d = activeDocument(); return d ? pageCountOf(d) : undefined; })() };
      }),
      vscode.commands.registerCommand("highwater.test.revealInView", (offset: number) => activeView()?.reveal(offset, "center", true)),
      // Selects in the active Highwater Editor (offsets in the document), as the writer would; resolves once the page has.
      // Types in the active Highwater Editor as key presses would, and takes the page's own undo or redo step (as ⌘Z, ⇧⌘Z).
      vscode.commands.registerCommand("highwater.test.typeInView", (text: string) => {
        const view = activeView();
        if (view) postTo(view.panel, { type: "testType", text });
      }),
      vscode.commands.registerCommand("highwater.test.pageStep", (dir: "undo" | "redo") => {
        const view = activeView();
        if (view) postTo(view.panel, { type: "historyStep", dir });
      }),
      vscode.commands.registerCommand("highwater.test.selectInView", (anchor: number, head: number) => activeView()?.apply([], [{ anchor, head }]) ?? false),
      vscode.commands.registerCommand("highwater.test.swapLog", () => swapLog.splice(0)),
      // Revert to This Save, as the Writing History panel asks for it: true if it went through.
      // The Works view in VS Code's sidebar: whether its page is ready and which works it lists; with a message, as if the page sent it.
      vscode.commands.registerCommand("highwater.test.worksView", (msg?: unknown) => {
        const handled = msg ? worksViewForTests.receive(msg as never) : undefined;
        return { ready: worksViewForTests.ready, works: worksViewForTests.works, handled };
      }),
      // What the Highwater Editor's sidebar shows, as its page last reported it.
      vscode.commands.registerCommand("highwater.test.sidebarState", () => context.globalState.get("highwater.sidebar")),
      vscode.commands.registerCommand("highwater.test.revert", (key: string, hash: string) => historyApi?.revert(key, hash) ?? false),
    );
  }
}
