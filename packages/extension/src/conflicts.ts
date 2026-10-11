import { basename } from "node:path";
import * as vscode from "vscode";
import { HighlandFileSystem, SCHEME, toHighlandUri } from "./fs-provider.ts";
import { openHighland } from "./open.ts";
import { splitBundlePath } from "./store.ts";

export const DISK_SCHEME = "highland-disk";

/** Read-only view of what is on disk right now, for Compare. */
export class DiskVersionProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly fs: HighlandFileSystem) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const p = splitBundlePath(uri.fsPath);
    if (!p) return "";
    return new TextDecoder().decode(await this.fs.store.readFromDisk(p.bundle, p.entry));
  }
}

/**
 * Another program (usually Highland 2) saved a bundle that is open here. Unmodified editors reload
 * on their own; editors with unsaved changes get Highland's choices: Revert, Save over, Save As,
 * plus Compare.
 */
export async function handleExternalChange(fs: HighlandFileSystem, bundle: string, entries: string[]): Promise<void> {
  fs.fireChanged(bundle, entries);
  const changed = new Set(entries.map((e) => toHighlandUri(bundle, e).toString()));
  const docs = vscode.workspace.textDocuments.filter((d) => d.uri.scheme === SCHEME && changed.has(d.uri.toString()));
  const dirty = docs.filter((d) => d.isDirty);
  if (docs.length > dirty.length) vscode.window.setStatusBarMessage(`$(sync) Reloaded ${basename(bundle)}: changed by another program`, 8000);
  for (const doc of dirty) await askAboutConflict(fs, doc);
}

async function askAboutConflict(fs: HighlandFileSystem, doc: vscode.TextDocument): Promise<void> {
  const p = splitBundlePath(doc.uri.fsPath)!;
  const name = basename(p.bundle) + (p.entry ? ` (${p.entry})` : "");
  for (;;) {
    const choice = await vscode.window.showWarningMessage(
      `${name} was changed by another program, and you have unsaved changes.`,
      { modal: false, detail: "Revert loads the version on disk. Save writes yours over it. Save As writes yours to a new file." },
      "Revert",
      "Save",
      "Save As…",
      "Compare",
    );
    if (choice === "Compare") {
      await vscode.commands.executeCommand("vscode.diff", doc.uri.with({ scheme: DISK_SCHEME }), doc.uri, `${name}: on disk ↔ yours`);
      continue; // ask again after showing the diff
    }
    if (choice === "Revert") await revert(doc);
    else if (choice === "Save") {
      await fs.store.write(p.bundle, p.entry, new TextEncoder().encode(doc.getText()));
      await revert(doc); // the editor now matches the disk: clear its modified state
    } else if (choice === "Save As…") {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(p.bundle.replace(/\.highland$/i, " copy.highland")),
        filters: { ".highland files": ["highland"] },
      });
      if (!target) continue;
      await fs.store.writeCopy(p.bundle, p.entry, new TextEncoder().encode(doc.getText()), target.fsPath);
      await revert(doc);
      await openHighland(target);
    }
    return;
  }
}

async function revert(doc: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.commands.executeCommand("workbench.action.files.revert");
}
