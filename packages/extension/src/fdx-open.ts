import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { createDocument, writeBundle } from "@highwater/bundle";
import { fdxToFountain } from "@highwater/pdf";
import * as vscode from "vscode";
import { openHighland } from "./open.ts";

export const FDX_VIEW_TYPE = "highwater.importFdx";

/**
 * Opening a Final Draft (.fdx) file converts it, as Highland 2 does: a new .highland screenplay
 * beside it ("name.highland", or "name 2.highland"… if that is taken) opens in its place. The .fdx
 * file is left as it was.
 */
export class FdxOpener implements vscode.CustomReadonlyEditorProvider {
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.html = page(`Converting ${document.uri.fsPath} to a .highland file…`);
    try {
      await importFdx(document.uri, panel.viewColumn);
      panel.dispose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      panel.webview.html = page(`Could not convert this Final Draft file: ${message}`);
    }
  }
}

/** Converts a .fdx file to a new .highland file beside it and opens that. Returns its path. */
export async function importFdx(file: vscode.Uri, viewColumn?: vscode.ViewColumn): Promise<string> {
  const text = fdxToFountain(await readFile(file.fsPath, "utf8"));
  const target = freeName(dirname(file.fsPath), basename(file.fsPath, extname(file.fsPath)));
  await writeBundle(target, createDocument({ mode: "fountain", template: "Screenplay", text }));
  await openHighland(vscode.Uri.file(target), viewColumn);
  void vscode.window.showInformationMessage(`Converted ${basename(file.fsPath)} to ${basename(target)}. The Final Draft file is unchanged.`);
  return target;
}

function freeName(dir: string, name: string): string {
  for (let n = 1; ; n++) {
    const p = join(dir, `${n === 1 ? name : `${name} ${n}`}.highland`);
    if (!existsSync(p)) return p;
  }
}

function page(text: string): string {
  const safe = text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<p style="font-family: sans-serif; padding: 1em">${safe}</p>`;
}
