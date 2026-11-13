import * as vscode from "vscode";
import { activeView, onDidChangeActiveSurface } from "../surface.ts";

/**
 * VS Code's Highwater Too sidebar while a Highwater Editor is in front: its five views are
 * hidden (the editor's own sidebar has them), and this sixth view, only a note, keeps the icon.
 * Whenever a Highwater Editor is given focus, the Highwater Too sidebar closes if it is open.
 */
export const NOTE_VIEW = "highwater.inEditor";

let note: vscode.TreeView<never> | undefined;
let asked = 0;

/** A Highwater Editor was given focus: close the Highwater Too sidebar if it is showing. */
export function editorFocused(): void {
  asked = Date.now();
  setTimeout(closeIfShown, 150);
}

function closeIfShown(): void {
  if (note?.visible && activeView()) void vscode.commands.executeCommand("workbench.action.closeSidebar");
}

export function registerSidebarNote(context: vscode.ExtensionContext): void {
  note = vscode.window.createTreeView<never>(NOTE_VIEW, { treeDataProvider: { getChildren: () => [], getTreeItem: (x) => x } });
  let last = activeView();
  context.subscriptions.push(
    note,
    // VS Code swaps the views a moment after the editor comes to the front; catch the note appearing then.
    note.onDidChangeVisibility((e) => {
      if (e.visible && Date.now() - asked < 600) closeIfShown();
    }),
    onDidChangeActiveSurface(() => {
      const now = activeView();
      if (now && now !== last) editorFocused();
      last = now;
    }),
  );
}
