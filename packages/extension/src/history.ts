import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { CommitBatcher, History, type DocumentFiles, type SaveKind } from "@highwater/history";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { BundleStore, splitBundlePath } from "./store.ts";

/** Our key in info.json: { documentId } ties a .highland file to its history repo. */
const INFO_KEY = "highwaterToo";
const HISTORY_SCHEME = "highwater-history";

/**
 * The writing history (M7): each save commits the script text, Bin and Scratchpad to the
 * document's repo in the history folder. Explicit saves commit at once; autosaves at most every
 * five minutes, and once more when the document closes. A failed commit never blocks a save.
 */
export function registerHistory(context: vscode.ExtensionContext, store: BundleStore): void {
  const reasons = new Map<string, vscode.TextDocumentSaveReason>();
  const status = vscode.window.createStatusBarItem("highwater.history", vscode.StatusBarAlignment.Left, 0);
  status.name = "Highwater Too: writing history";
  let histories = new Map<string, History>();
  let askedThisSession = false;

  const folder = () => vscode.workspace.getConfiguration("highwater").get<string>("historyFolder", "").trim();
  const enabled = () => vscode.workspace.getConfiguration("highwater").get<boolean>("writingHistory", true);
  const historyFor = (dir: string) => {
    let h = histories.get(dir);
    if (!h) histories.set(dir, (h = new History(dir)));
    return h;
  };

  const batcher = new CommitBatcher(async (key, kind) => {
    try {
      await commit(key, kind);
      status.hide();
    } catch (error) {
      status.text = "$(warning) History";
      status.tooltip = `The last save was not added to the writing history: ${(error as Error).message}. It will be tried again on the next save.`;
      status.show();
    }
  });

  /** key: the .highland file, or the plain .fountain/.md file. */
  async function commit(key: string, kind: SaveKind): Promise<void> {
    const dir = folder();
    if (!dir) return;
    const h = historyFor(dir);
    const isBundle = key.toLowerCase().endsWith(".highland");
    let files: DocumentFiles;
    let id: string | null = null;
    if (isBundle) {
      const b = await store.snapshot(key);
      const info = b.info[INFO_KEY] as { documentId?: unknown } | undefined;
      id = typeof info?.documentId === "string" ? info.documentId : null;
      files = { scriptName: b.textPath.split("/").pop()!, script: b.text, bin: b.binItems, ...(b.scratchpad !== undefined ? { scratchpad: b.scratchpad } : {}) };
    } else {
      const ext = extname(key).toLowerCase() === ".fountain" || extname(key).toLowerCase() === ".spmd" ? ".fountain" : extname(key).toLowerCase() === ".txt" ? ".txt" : ".md";
      files = { scriptName: `text${ext}`, script: await readFile(key, "utf8") };
    }
    const resolved = await h.resolve({ id, path: key, text: files.script });
    // Highland drops keys it does not know when it saves; put the ID back.
    if (isBundle && resolved.id !== id) {
      await store.update(key, (b) => {
        b.setInfo({ ...b.info, [INFO_KEY]: { ...((b.info[INFO_KEY] as object | undefined) ?? {}), documentId: resolved.id } });
        return ["info.json"];
      });
    }
    await h.commit(resolved.repo, files, kind);
  }

  /** The file a saved document belongs to, if it gets history. */
  const keyOf = (doc: vscode.TextDocument): string | null => {
    if (doc.uri.scheme === SCHEME) return splitBundlePath(doc.uri.fsPath)?.bundle ?? null;
    if (doc.uri.scheme === "file" && doc.languageId.startsWith("highland-")) return doc.uri.fsPath;
    return null;
  };

  async function ensureFolder(): Promise<boolean> {
    if (folder()) return true;
    if (askedThisSession || !enabled()) return false;
    askedThisSession = true;
    const choice = await vscode.window.showInformationMessage(
      "Keep a writing history? Each save is recorded in a git repository of its own, a record of how your script was written. Choose a folder to keep it in.",
      "Choose Folder…",
      "Not Now",
      "Never",
    );
    if (choice === "Never") {
      await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
      return false;
    }
    if (choice !== "Choose Folder…") return false;
    const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Use for Writing History", title: "Writing history folder" });
    if (!picked?.[0]) return false;
    await vscode.workspace.getConfiguration("highwater").update("historyFolder", picked[0].fsPath, vscode.ConfigurationTarget.Global);
    return true;
  }

  context.subscriptions.push(
    status,
    { dispose: () => batcher.dispose() },
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("highwater.historyFolder")) histories = new Map();
    }),
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (keyOf(e.document)) reasons.set(e.document.uri.toString(), e.reason);
    }),
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const key = keyOf(doc);
      if (!key || !enabled()) return;
      const reason = reasons.get(doc.uri.toString());
      reasons.delete(doc.uri.toString());
      if (!(await ensureFolder())) return;
      void batcher.saved(key, reason === vscode.TextDocumentSaveReason.Manual || reason === undefined ? "save" : "autosave");
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = keyOf(doc);
      if (key && folder()) void batcher.saved(key, "close");
    }),
    vscode.workspace.registerTextDocumentContentProvider(HISTORY_SCHEME, {
      provideTextDocumentContent: async (uri) => {
        const q = JSON.parse(uri.query) as { repo: string; hash: string; file: string };
        return historyFor(folder()).show(q.repo, q.hash, q.file);
      },
    }),
    vscode.commands.registerCommand("highwater.showHistory", () => showHistory()),
    vscode.commands.registerCommand("highwater.openHistoryFolder", async () => {
      if (!(await ensureFolderAsked())) return;
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(folder()));
    }),
  );

  async function ensureFolderAsked(): Promise<boolean> {
    askedThisSession = false;
    return ensureFolder();
  }

  async function showHistory(): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    const key = doc ? keyOf(doc) : null;
    if (!doc || !key) {
      void vscode.window.showInformationMessage("Open a Highland script to see its writing history.");
      return;
    }
    if (!(await ensureFolderAsked())) return;
    const h = historyFor(folder());
    let text = doc.getText();
    let id: string | null = null;
    if (key.toLowerCase().endsWith(".highland")) {
      const b = await store.snapshot(key);
      const info = b.info[INFO_KEY] as { documentId?: unknown } | undefined;
      id = typeof info?.documentId === "string" ? info.documentId : null;
      text = b.text;
    }
    const { repo } = await h.resolve({ id, path: key, text });
    const commits = await h.log(repo);
    if (!commits.length) {
      void vscode.window.showInformationMessage("No history yet: it starts with the next save.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      commits.map((c) => ({ label: c.message, description: c.hash.slice(0, 7), commit: c })),
      { title: `Writing history: ${basename(key)}`, placeHolder: "Pick a save to compare with the script as it is now" },
    );
    if (!picked) return;
    const names = (await h.show(repo, picked.commit.hash, "").catch(() => "")).split("\n");
    const file = names.find((n) => /^text\.[^/]+$/.test(n.trim()))?.trim() ?? "text.fountain";
    const left = vscode.Uri.from({ scheme: HISTORY_SCHEME, path: `/${basename(key)} (${picked.commit.hash.slice(0, 7)})`, query: JSON.stringify({ repo, hash: picked.commit.hash, file }) });
    await vscode.commands.executeCommand("vscode.diff", left, doc.uri, `${basename(key)}: ${picked.label} ↔ now`);
  }
}
