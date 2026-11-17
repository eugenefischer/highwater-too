import * as vscode from "vscode";
import { EXTRAS_SCHEME } from "./extras.ts";
import { SCHEME } from "./fs-provider.ts";
import { autoSaveDelay, backupSettings } from "./highland-editor/backup-settings.ts";

/**
 * Settings → Backup's Save Automatically (`highwater.autoSave`): our documents save themselves
 * a second after typing stops, or every few minutes while they have unsaved changes. Each of
 * these saves is recorded in the writing history as an Autosave. Other files are left to VS
 * Code's own Auto Save.
 */
export const autoSaving = new Set<string>();

const ours = (doc: vscode.TextDocument) =>
  !doc.isUntitled && (doc.uri.scheme === SCHEME || doc.uri.scheme === EXTRAS_SCHEME || (doc.uri.scheme === "file" && doc.languageId.startsWith("highland-")));

export function registerAutoSave(context: vscode.ExtensionContext): void {
  const timers = new Map<string, NodeJS.Timeout>();
  const mode = () => backupSettings((k) => vscode.workspace.getConfiguration("highwater").get(k)).autoSave;
  const clear = (key: string) => {
    clearTimeout(timers.get(key));
    timers.delete(key);
  };
  const save = async (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    timers.delete(key);
    if (doc.isClosed || !doc.isDirty) return;
    autoSaving.add(key);
    try {
      await doc.save();
    } finally {
      autoSaving.delete(key);
    }
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = e.document;
      if (!e.contentChanges.length || !ours(doc)) return;
      const m = mode();
      const delay = autoSaveDelay(m);
      const key = doc.uri.toString();
      if (delay === null) return clear(key);
      // While typing: a second after the last change. Every N minutes: N minutes after the first unsaved change.
      if (m === "typing") clear(key);
      else if (timers.has(key)) return;
      timers.set(key, setTimeout(() => void save(doc), delay));
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => clear(doc.uri.toString())),
    vscode.workspace.onDidCloseTextDocument((doc) => clear(doc.uri.toString())),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("highwater.autoSave")) for (const key of [...timers.keys()]) clear(key);
    }),
    { dispose: () => [...timers.keys()].forEach(clear) },
  );
}
