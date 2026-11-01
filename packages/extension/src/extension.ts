import { join } from "node:path";
import * as vscode from "vscode";
import { LANGUAGES } from "./language.ts";
import { DISK_SCHEME, DiskVersionProvider, handleExternalChange } from "./conflicts.ts";
import { HighlandFileSystem, SCHEME } from "./fs-provider.ts";
import { OPEN_VIEW_TYPE, OpenRedirect, openHighland } from "./open.ts";
import { registerCommands } from "./commands.ts";
import { registerConversions } from "./convert.ts";
import { registerLanguageFeatures } from "./language.ts";
import { registerPanels } from "./panels.ts";
import { registerPreview } from "./preview.ts";
import { registerTemplateStatus } from "./render-document.ts";
import { currentHistory, historyRoot, registerHistory } from "./history.ts";
import { startPlainExtras } from "./extras.ts";
import { focusedDocument } from "./focus.ts";
import { registerAsk } from "./ask.ts";
import { registerWorkspaceTools } from "./workspace-tools.ts";
import { registerWritingTools } from "./writing-tools.ts";
import { registerStatusBar } from "./status.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { registerHighlandEditor } from "./highland-editor/provider.ts";

/** VS Code glue only; all format, parsing and layout logic lives in the other packages. */
export function activate(context: vscode.ExtensionContext): void {
  // Questions to the writer (answered by script in the end-to-end tests).
  registerAsk(context);
  // The experimental Highland-style editor (M15).
  registerHighlandEditor(context);
  const store = new BundleStore({ backupFolder: () => backupFolder(context) });
  // Bin, Scratchpad and images for plain .fountain and .md files.
  startPlainExtras(context, { history: currentHistory, historyRoot });
  // The document the panes show.
  focusedDocument(context);
  const fs = new HighlandFileSystem(store);

  // Watch every open Highland document's file (VS Code may also ask the provider to watch).
  const watching = new Map<string, () => void>();
  const track = (doc: vscode.TextDocument): void => {
    const p = doc.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
    if (p && !watching.has(doc.uri.toString())) watching.set(doc.uri.toString(), store.watch(p.bundle));
  };
  vscode.workspace.textDocuments.forEach(track);
  const cache = registerLanguageFeatures(context, store);

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
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        title: "Open Document",
        filters: { Documents: ["highland", "fountain", "md", "markdown"], ".highland files": ["highland"], Fountain: ["fountain"], Markdown: ["md", "markdown"] },
      });
      for (const uri of picked ?? []) {
        if (/\.highland$/i.test(uri.fsPath)) await openHighland(uri);
        else {
          const doc = await vscode.workspace.openTextDocument(uri);
          const md = /\.(md|markdown)$/i.test(uri.fsPath) && doc.languageId === "markdown";
          await vscode.window.showTextDocument(md ? await vscode.languages.setTextDocumentLanguage(doc, LANGUAGES.markdown) : doc, { preview: false });
        }
      }
    }),
    vscode.commands.registerCommand("highwater.hello", () => {
      const version = String(context.extension.packageJSON.version ?? "unknown");
      void vscode.window.showInformationMessage(`Highwater Too ${version}`);
    }),
  );

  // Features, each on its own: one failing to start (say, a panel VS Code has not registered yet
  // after an update without a reload) must not take the others, or file access, down with it.
  const features: [string, () => void][] = [
    ["status bar", () => registerStatusBar(context, cache)],
    ["commands", () => registerCommands(context, store)],
    ["conversions and exports", () => registerConversions(context, store)],
    ["sidebar panels", () => registerPanels(context, store, fs, cache)],
    ["Live Margins and Title Page Builder", () => registerWorkspaceTools(context, cache)],
    ["completion, markers and cheat sheet", () => registerWritingTools(context, cache)],
    ["preview", () => registerPreview(context, store)],
    ["template indicator", () => registerTemplateStatus(context, store)],
    ["writing history", () => registerHistory(context, store)],
  ];
  for (const [name, start] of features) {
    try {
      start();
    } catch (error) {
      void vscode.window.showErrorMessage(`Highwater Too: the ${name} could not start (${(error as Error).message}). Reloading the window usually fixes this after an update.`);
    }
  }
}

/** Session backups: in the writing history folder (the writer's choice, or the system default). */
function backupFolder(_context: vscode.ExtensionContext): string {
  return join(historyRoot(), "backups");
}

export function deactivate(): void {}
