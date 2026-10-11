import { join } from "node:path";
import * as vscode from "vscode";
import { DISK_SCHEME, DiskVersionProvider, handleExternalChange } from "./conflicts.ts";
import { HighlandFileSystem, SCHEME } from "./fs-provider.ts";
import { OPEN_VIEW_TYPE, OpenRedirect, openHighland } from "./open.ts";
import { registerCommands } from "./commands.ts";
import { registerLanguageFeatures } from "./language.ts";
import { registerPanels } from "./panels.ts";
import { registerStatusBar } from "./status.ts";
import { BundleStore, splitBundlePath } from "./store.ts";

/** VS Code glue only; all format, parsing and layout logic lives in the other packages. */
export function activate(context: vscode.ExtensionContext): void {
  const store = new BundleStore({ backupFolder: () => backupFolder(context) });
  const fs = new HighlandFileSystem(store);

  // Watch every open Highland document's file (VS Code may also ask the provider to watch).
  const watching = new Map<string, () => void>();
  const track = (doc: vscode.TextDocument): void => {
    const p = doc.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
    if (p && !watching.has(doc.uri.toString())) watching.set(doc.uri.toString(), store.watch(p.bundle));
  };
  vscode.workspace.textDocuments.forEach(track);
  const cache = registerLanguageFeatures(context, store);
  registerStatusBar(context, cache);
  registerCommands(context, store);
  registerPanels(context, store, fs, cache);

  context.subscriptions.push(
    { dispose: () => store.dispose() },
    vscode.workspace.onDidOpenTextDocument(track),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      watching.get(doc.uri.toString())?.();
      watching.delete(doc.uri.toString());
    }),
    vscode.workspace.registerFileSystemProvider(SCHEME, fs, { isCaseSensitive: true }),
    vscode.workspace.registerTextDocumentContentProvider(DISK_SCHEME, new DiskVersionProvider(fs)),
    vscode.window.registerCustomEditorProvider(OPEN_VIEW_TYPE, new OpenRedirect()),
    { dispose: store.onExternalChange((bundle, entries) => void handleExternalChange(fs, bundle, entries)) },
    vscode.commands.registerCommand("highwater.open", async () => {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { "Highland document": ["highland"] } });
      for (const uri of picked ?? []) await openHighland(uri);
    }),
    vscode.commands.registerCommand("highwater.hello", () => {
      const version = String(context.extension.packageJSON.version ?? "unknown");
      void vscode.window.showInformationMessage(`Highwater Too ${version}`);
    }),
  );
}

/** Session backups: <history folder>/backups once one is set, else the extension's own storage. */
function backupFolder(context: vscode.ExtensionContext): string {
  const history = vscode.workspace.getConfiguration("highwater").get<string>("historyFolder", "").trim();
  return history ? join(history, "backups") : join(context.globalStorageUri.fsPath, "backups");
}

export function deactivate(): void {}
