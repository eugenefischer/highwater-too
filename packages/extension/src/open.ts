import * as vscode from "vscode";
import { toHighlandUri } from "./fs-provider.ts";

export const OPEN_VIEW_TYPE = "highwater.open";

/**
 * Opening a .highland file from the Explorer lands here (it is the default editor for *.highland).
 * It opens the script as text through the highland: file system and closes itself.
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

export async function openHighland(file: vscode.Uri, viewColumn?: vscode.ViewColumn): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(toHighlandUri(file.fsPath));
  return vscode.window.showTextDocument(doc, { viewColumn: viewColumn ?? vscode.ViewColumn.Active, preview: false });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
