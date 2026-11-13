import { basename } from "node:path";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
import { HighlandFileSystem, SCHEME, toHighlandUri } from "./fs-provider.ts";
import { openHighland } from "./open.ts";
import { splitBundlePath } from "./store.ts";
import { currentHistory } from "./history-location.ts";
import { showDocument } from "./surface.ts";

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
 * on their own; editors with unsaved changes get Highland's choices, as Highland words them:
 * Save Anyway, Revert or Save As, plus Compare. As in Highland, the version that loses is kept:
 * in the writing history (a save noting it was set aside), or in the backups when the history is
 * off.
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
  const kept = currentHistory() ? "kept in the writing history" : "kept in the backups";
  for (;;) {
    const choice = await ask(
      "warning",
      `The document “${name}” has been changed by another application.`,
      {
        modal: true,
        detail: `Save Anyway keeps your changes, and the other application's version is ${kept}. Revert keeps the other application's changes, and your changes are ${kept}. Save As saves your changes to a different file. Compare shows the two side by side.`,
      },
      "Save Anyway",
      "Revert",
      "Save As…",
      "Compare",
    );
    if (choice === "Compare") {
      await vscode.commands.executeCommand("vscode.diff", doc.uri.with({ scheme: DISK_SCHEME }), doc.uri, `${name}: other application's version ↔ yours`);
      continue; // ask again after showing the diff
    }
    if (choice === "Save Anyway") {
      // Theirs first (what is on disk), then yours over it: the history ends where the file is.
      await setAside(fs, p.bundle, "set aside: the version saved by another application");
      await fs.store.write(p.bundle, p.entry, new TextEncoder().encode(doc.getText()));
      await revert(doc); // the editor now matches the disk: clear its modified state
      await vscode.commands.executeCommand("highwater.history.record", p.bundle);
    } else if (choice === "Revert") {
      await setAside(fs, p.bundle, "set aside: your unsaved changes", { entry: p.entry, text: doc.getText() });
      await revert(doc);
      await vscode.commands.executeCommand("highwater.history.record", p.bundle);
    } else if (choice === "Save As…") {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(p.bundle.replace(/\.highland$/i, " copy.highland")),
        filters: { ".highland files": ["highland"] },
      });
      if (!target) continue;
      await fs.store.writeCopy(p.bundle, p.entry, new TextEncoder().encode(doc.getText()), target.fsPath);
      await vscode.commands.executeCommand("highwater.history.separate", target.fsPath).then(undefined, () => undefined);
      await revert(doc);
      await openHighland(target);
    }
    return; // dismissed: the changes stay unsaved, and saving asks again
  }
}

/** Keeps the version that lost: as a save in the writing history, or else in the backups. */
async function setAside(fs: HighlandFileSystem, bundle: string, note: string, yours?: { entry: string; text: string }): Promise<void> {
  const recorded = await vscode.commands.executeCommand<boolean>("highwater.history.setAside", bundle, note, yours).then(
    (r) => r === true,
    () => false,
  );
  if (recorded) return;
  const where = await fs.store.keepAside(bundle, yours?.entry, yours ? new TextEncoder().encode(yours.text) : undefined);
  vscode.window.setStatusBarMessage(`$(archive) Kept ${basename(where)} in the backups`, 8000);
}

async function revert(doc: vscode.TextDocument): Promise<void> {
  await showDocument(doc); // the editor it's open in, which Revert File acts on
  await vscode.commands.executeCommand("workbench.action.files.revert");
}
