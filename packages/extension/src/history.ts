import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { CommitBatcher, defaultHistoryFolder, History, moveHistory, syncedFolder, type CommitInfo, type DocumentFiles, type SaveKind } from "@highwater/history";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { exportHistory, HistoryMirror } from "./mirror.ts";
import { BundleStore, splitBundlePath } from "./store.ts";

/** Our key in info.json: { documentId } ties a .highland file to its branch in the history. */
const INFO_KEY = "highwaterToo";
const HISTORY_SCHEME = "highwater-history";
const NOTICE_KEY = "highwater.historyNoticeShown";

/** The history folder: the writer's choice, else the system's application-data folder. */
export function historyRoot(): string {
  const chosen = vscode.workspace.getConfiguration("highwater").get<string>("historyFolder", "").trim();
  return chosen || defaultHistoryFolder(process.platform, process.env, homedir());
}

/**
 * The writing history (M7): each save commits the script text, Bin and Scratchpad to the
 * document's branch in the history repository. Explicit saves commit at once; autosaves at most every
 * five minutes, and once more when the document closes. A failed commit never blocks a save.
 */
export function registerHistory(context: vscode.ExtensionContext, store: BundleStore): void {
  const reasons = new Map<string, vscode.TextDocumentSaveReason>();
  const status = vscode.window.createStatusBarItem("highwater.history", vscode.StatusBarAlignment.Left, 0);
  status.name = "Highwater Too: writing history";
  status.command = "highwater.showHistory";
  let histories = new Map<string, History>();
  const lastCommit = new Map<string, Date>();
  const failures = new Map<string, string>();

  const enabled = () => vscode.workspace.getConfiguration("highwater").get<boolean>("writingHistory", true);
  const history = () => {
    const dir = historyRoot();
    let h = histories.get(dir);
    if (!h) histories.set(dir, (h = new History(dir)));
    return h;
  };

  /** The file a document's history belongs to: the .highland file, or a plain .fountain/.md file. */
  const keyOf = (doc: vscode.TextDocument | undefined): string | null => {
    if (!doc) return null;
    if (doc.uri.scheme === SCHEME) return splitBundlePath(doc.uri.fsPath)?.bundle ?? null;
    if (doc.uri.scheme === "file" && doc.languageId.startsWith("highland-")) return doc.uri.fsPath;
    return null;
  };

  /** Reads what the history records for a document, and its stored ID. */
  async function snapshot(key: string): Promise<{ id: string | null; files: DocumentFiles }> {
    if (key.toLowerCase().endsWith(".highland")) {
      const b = await store.snapshot(key);
      const info = b.info[INFO_KEY] as { documentId?: unknown } | undefined;
      const id = typeof info?.documentId === "string" ? info.documentId : null;
      return { id, files: { scriptName: b.textPath.split("/").pop()!, script: b.text, bin: b.binItems, ...(b.scratchpad !== undefined ? { scratchpad: b.scratchpad } : {}) } };
    }
    const ext = extname(key).toLowerCase();
    const scriptName = ext === ".fountain" || ext === ".spmd" ? "text.fountain" : ext === ".txt" ? "text.txt" : "text.md";
    return { id: null, files: { scriptName, script: await readFile(key, "utf8") } };
  }

  async function resolve(key: string) {
    const { id, files } = await snapshot(key);
    const resolved = await history().resolve({ id, path: key, text: files.script });
    // Highland drops keys it does not know when it saves; put the ID back.
    if (key.toLowerCase().endsWith(".highland") && resolved.id !== id) {
      await store.update(key, (b) => {
        b.setInfo({ ...b.info, [INFO_KEY]: { ...((b.info[INFO_KEY] as object | undefined) ?? {}), documentId: resolved.id } });
        return ["info.json"];
      });
    }
    return { ...resolved, files };
  }

  const mirror = new HistoryMirror(context, () => history());
  mirror.onDidChange(() => void updateStatus());
  const batcher = new CommitBatcher(async (key, kind) => {
    try {
      const r = await resolve(key);
      if (r.paused) return;
      const c = await history().commit(r.id, r.files, kind);
      failures.delete(key);
      if (c) {
        lastCommit.set(key, c.date);
        mirror.schedule();
      }
      void showNotice();
      view.refresh();
    } catch (error) {
      failures.set(key, (error as Error).message);
    }
    updateStatus();
  });

  /** Once ever: say that history is being kept, and where, with the ways to change that. */
  async function showNotice(): Promise<void> {
    if (context.globalState.get<boolean>(NOTICE_KEY)) return;
    await context.globalState.update(NOTICE_KEY, true);
    const choice = await vscode.window.showInformationMessage(
      `Highwater Too keeps a writing history of your scripts: each save is recorded in a git repository, one branch per script, in ${historyRoot()}. It stays on this computer.`,
      "Show History",
      "Change Location…",
      "Turn Off",
    );
    if (choice === "Show History") await vscode.commands.executeCommand("highwater.history.focus");
    else if (choice === "Change Location…") await changeLocation();
    else if (choice === "Turn Off") await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  }

  async function updateStatus(): Promise<void> {
    const key = keyOf(vscode.window.activeTextEditor?.document);
    if (!key || !enabled()) {
      status.hide();
      return;
    }
    const failed = failures.get(key);
    if (failed) {
      status.text = "$(warning) History";
      status.tooltip = `The last save was not added to the writing history: ${failed}. It will be tried again on the next save.`;
    } else {
      const last = lastCommit.get(key) ?? (await latest(key))?.date;
      status.text = last ? `$(history) ${when(last)}` : "$(history)";
      status.tooltip = last ? `Writing history: last save recorded ${last.toLocaleString()}. Click to see the saves.` : "Writing history: starts with the next save.";
      if (mirror.url) status.tooltip += mirror.state.error ? `\nNot mirrored yet: ${mirror.state.error}. Tried again after the next save.` : mirror.state.at ? `\nMirrored to ${mirror.url} at ${mirror.state.at.toLocaleTimeString()}.` : `\nMirrored to ${mirror.url}.`;
      if (mirror.url && mirror.state.error) status.text = status.text.replace("$(history)", "$(history)$(cloud-upload)");
    }
    status.show();
  }

  /** Looks a document's history up without creating anything (viewing must not write files). */
  async function lookup(key: string) {
    const { id, files } = await snapshot(key);
    return history().find({ id, path: key, text: files.script });
  }

  async function latest(key: string): Promise<CommitInfo | undefined> {
    try {
      const found = await lookup(key);
      return found ? (await history().log(found.id, 1))[0] : undefined;
    } catch {
      return undefined;
    }
  }

  async function changeLocation(): Promise<void> {
    const current = historyRoot();
    const fallback = defaultHistoryFolder(process.platform, process.env, homedir());
    const picked = await vscode.window.showQuickPick(
      [
        { label: "Default location", description: fallback, value: "default" as const },
        { label: "Choose a folder…", value: "choose" as const },
      ],
      { title: `Writing history is in ${current}` },
    );
    if (!picked) return;
    let target = fallback;
    if (picked.value === "choose") {
      const uris = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Use for Writing History", title: "Writing history folder" });
      if (!uris?.[0]) return;
      target = uris[0].fsPath;
      const sync = syncedFolder(target);
      if (sync) {
        const ok = await vscode.window.showWarningMessage(
          `That folder is kept in sync by ${sync}.`,
          { modal: true, detail: "Sync services can damage git repositories, especially when two computers save the same document. The default location plus a remote mirror is safer." },
          "Use It Anyway",
        );
        if (ok !== "Use It Anyway") return;
      }
    }
    if (target === current) return;
    const existing = existsSync(target) ? readdirSync(target) : [];
    if (existing.includes("index.json")) {
      const ok = await vscode.window.showInformationMessage(`${target} already holds a writing history. Use it from now on? The history in ${current} stays where it is.`, { modal: true }, "Use It");
      if (ok !== "Use It") return;
    } else if (existing.length > 0) {
      void vscode.window.showErrorMessage(`${target} is not empty. Choose an empty folder, or a new one, for the writing history.`);
      return;
    } else if (existsSync(current)) {
      const ok = await vscode.window.showInformationMessage(`Move the writing history from ${current} to ${target}?`, { modal: true }, "Move");
      if (ok !== "Move") return;
      await batcherIdle();
      await moveHistory(current, target);
    }
    await vscode.workspace.getConfiguration("highwater").update("historyFolder", target === fallback ? undefined : target, vscode.ConfigurationTarget.Global);
    histories = new Map();
    view.refresh();
    void updateStatus();
  }

  /** Waits for commits in progress. */
  async function batcherIdle(): Promise<void> {
    await history().idle();
  }

  async function showHistory(): Promise<void> {
    const doc = vscode.window.activeTextEditor?.document;
    const key = keyOf(doc);
    if (!doc || !key) {
      void vscode.window.showInformationMessage("Open a document to see its writing history.");
      return;
    }
    const found = await lookup(key);
    const commits = found ? await history().log(found.id) : [];
    if (!commits.length) {
      void vscode.window.showInformationMessage("No history yet: it starts with the next save.");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      commits.map((c) => ({ label: c.message, description: c.hash.slice(0, 7), commit: c })),
      { title: `Writing history: ${basename(key)}`, placeHolder: "Pick a save to compare with the script as it is now" },
    );
    if (picked) await compare(doc, key, picked.commit);
  }

  async function compare(doc: vscode.TextDocument, key: string, commit: CommitInfo): Promise<void> {
    const left = vscode.Uri.from({ scheme: HISTORY_SCHEME, path: `/${basename(key)} (${commit.hash.slice(0, 7)})`, query: JSON.stringify({ hash: commit.hash }) });
    await vscode.commands.executeCommand("vscode.diff", left, doc.uri, `${basename(key)}: ${commit.message} ↔ now`);
  }

  async function togglePause(): Promise<void> {
    const key = keyOf(vscode.window.activeTextEditor?.document);
    if (!key) return;
    const r = await resolve(key);
    await history().setPaused(r.id, !r.paused);
    void vscode.window.showInformationMessage(r.paused ? `Writing history is on again for ${basename(key)}.` : `Writing history is off for ${basename(key)}; earlier saves are kept.`);
    void vscode.commands.executeCommand("setContext", "highwater.historyPaused", !r.paused);
    view.refresh();
  }

  // The Writing History panel: the current script's saves; click one to compare it with now.
  const view = new HistoryView(async () => {
    const doc = vscode.window.activeTextEditor?.document;
    const key = keyOf(doc);
    if (!doc || !key || !enabled()) return null;
    const r = await lookup(key);
    void vscode.commands.executeCommand("setContext", "highwater.historyPaused", r?.paused ?? false);
    return r ? { doc, key, commits: await history().log(r.id) } : null;
  });

  context.subscriptions.push(
    status,
    { dispose: () => batcher.dispose() },
    vscode.window.registerTreeDataProvider("highwater.history", view),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("highwater.historyFolder") || e.affectsConfiguration("highwater.writingHistory")) {
        histories = new Map();
        view.refresh();
        void updateStatus();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void updateStatus();
      view.refresh();
    }),
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (keyOf(e.document)) reasons.set(e.document.uri.toString(), e.reason);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const key = keyOf(doc);
      if (!key || !enabled()) return;
      const reason = reasons.get(doc.uri.toString());
      reasons.delete(doc.uri.toString());
      void batcher.saved(key, reason === vscode.TextDocumentSaveReason.Manual || reason === undefined ? "save" : "autosave");
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = keyOf(doc);
      if (key && enabled()) void batcher.saved(key, "close");
    }),
    vscode.workspace.registerTextDocumentContentProvider(HISTORY_SCHEME, {
      provideTextDocumentContent: async (uri) => {
        const q = JSON.parse(uri.query) as { hash: string };
        return history().scriptAt(q.hash);
      },
    }),
    vscode.commands.registerCommand("highwater.showHistory", () => showHistory()),
    vscode.commands.registerCommand("highwater.history.compare", (item: HistoryItem) => compare(item.doc, item.key, item.commit)),
    vscode.commands.registerCommand("highwater.changeHistoryLocation", () => changeLocation()),
    vscode.commands.registerCommand("highwater.toggleDocumentHistory", () => togglePause()),
    mirror,
    vscode.commands.registerCommand("highwater.setUpHistoryMirror", () => mirror.setUp()),
    vscode.commands.registerCommand("highwater.pushHistoryNow", () => mirror.push(true)),
    vscode.commands.registerCommand("highwater.exportHistory", async () => {
      const key = keyOf(vscode.window.activeTextEditor?.document);
      if (!key) {
        void vscode.window.showInformationMessage("Open a document to export its writing history.");
        return;
      }
      const found = await lookup(key);
      if (!found) {
        void vscode.window.showInformationMessage("This script has no writing history yet: it starts with the next save.");
        return;
      }
      await exportHistory(history(), found.id, key);
    }),
    vscode.commands.registerCommand("highwater.openHistoryFolder", () => vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(historyRoot()))),
  );
  void updateStatus();
  // Catch up on pushes that could not be made last time (offline, say).
  setTimeout(() => void mirror.push(), 15_000);
}

/** "14:03" today, else "11 Oct". */
function when(d: Date): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

interface HistoryItem {
  doc: vscode.TextDocument;
  key: string;
  commit: CommitInfo;
}

class HistoryView implements vscode.TreeDataProvider<HistoryItem> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;

  constructor(private readonly load: () => Promise<{ doc: vscode.TextDocument; key: string; commits: CommitInfo[] } | null>) {}

  refresh(): void {
    this.#changed.fire();
  }

  getTreeItem(item: HistoryItem): vscode.TreeItem {
    const [kind, ...rest] = item.commit.message.split(" ");
    const t = new vscode.TreeItem(`${when(item.commit.date)} · ${rest.slice(1).join(" ").replace(/^.*?, /, "")}`);
    t.description = kind ?? "";
    t.tooltip = `${item.commit.message}\n${item.commit.hash}\nClick to compare with the script as it is now.`;
    t.iconPath = new vscode.ThemeIcon(kind === "Save" ? "save" : "history");
    t.command = { command: "highwater.history.compare", title: "Compare", arguments: [item] };
    return t;
  }

  async getChildren(item?: HistoryItem): Promise<HistoryItem[]> {
    if (item) return [];
    const data = await this.load().catch(() => null);
    if (!data) return [];
    return data.commits.map((commit) => ({ doc: data.doc, key: data.key, commit }));
  }
}
