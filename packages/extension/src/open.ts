import * as vscode from "vscode";
import { toHighlandUri } from "./fs-provider.ts";
import { showDocument } from "./surface.ts";

export const OPEN_VIEW_TYPE = "highwater.open";

/**
 * Opening a .highland file from the Explorer lands here (it is the default editor for *.highland
 * files on disk). It opens the script through the highland: file system and closes itself. Only
 * file: URIs (package.json's pattern names the scheme): a script's own highland: URI, as a Search
 * result gives, must reach its editor with the line clicked.
 */
export class OpenRedirect implements vscode.CustomReadonlyEditorProvider {
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.html = `<p style="font-family: sans-serif; padding: 1em">Opening ${escapeHtml(document.uri.fsPath)}…</p>`;
    try {
      await openHighland(document.uri, panel.viewColumn);
      panel.dispose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      panel.webview.html = `<p style="font-family: sans-serif; padding: 1em">Could not open this file as a .highland document: ${escapeHtml(message)}</p>`;
    }
  }
}

/** Opens a .highland file's script: in its Highland-Style Editor if it is open in one, else as text. */
export async function openHighland(file: vscode.Uri, viewColumn?: vscode.ViewColumn): Promise<void> {
  await showDocument(await vscode.workspace.openTextDocument(toHighlandUri(file.fsPath)), viewColumn);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
