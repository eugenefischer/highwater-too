import { basename } from "node:path";
import { CommitBatcher, formOf, type CommitInfo, type SaveKind } from "@highwater/history";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
import { SCHEME } from "./fs-provider.ts";
import { HistoryMirror } from "./mirror.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { EXTRAS_SCHEME, plainExtras } from "./extras.ts";
import { Connector } from "./connect.ts";
import { focusedDocument } from "./focus.ts";
import { deletedElsewhere, revertTo, Works, type WorksHost } from "./works.ts";
import { highwaterOpener } from "./surface.ts";
import { restoreCommands } from "./history-restore.ts";
import { historyAt, historyRoot } from "./history-location.ts";
import { historyRecords, type Instead } from "./history-records.ts";
import { historyStatus } from "./history-status.ts";
import { registerHistoryCommands } from "./history-commands.ts";

const NOTICE_KEY = "highwater.historyNoticeShown";

/** The writing history, for the Highwater Editor's sidebar (set by registerHistory). */
export let historyApi:
  | {
      /** A document's saves, newest first, and whether its history is on, paused, off, or not begun. */
      saves(key: string): Promise<{ state: "on" | "paused" | "off" | "none"; commits: CommitInfo[] }>;
      /** True once the document holds the save's text (false if cancelled or it failed). */
      revert(key: string, hash: string): Promise<boolean>;
      /** A save's text (the script), for comparing in the page. */
      saveText(hash: string): Promise<string>;
      works: Works;
      /** The mirror's last outcome (when it last synced, its error, whether it waits for a sign-in). */
      mirror(): { at: Date | null; error: string | null; signIn: boolean; busy: boolean };
      onDidChange(listener: () => void): vscode.Disposable;
    }
  | undefined;

/**
 * The writing history (M7): each save commits the script text, Bin and Scratchpad to the
 * document's branch in the history repository. Explicit saves commit at once; autosaves at most every
 * five minutes, and once more when the document closes. A failed commit never blocks a save.
 *
 * Here: the recording, the status bar and the events; the commands are in history-commands.ts,
 * reading what is recorded in history-records.ts, the folder in history-location.ts.
 */
export function registerHistory(context: vscode.ExtensionContext, store: BundleStore): void {
  const reasons = new Map<string, vscode.TextDocumentSaveReason>();
  const lastCommit = new Map<string, Date>();
  const failures = new Map<string, string>();

  const enabled = () => vscode.workspace.getConfiguration("highwater").get<boolean>("writingHistory", true);
  const history = () => historyAt(historyRoot());
  const extras = plainExtras();
  const focus = focusedDocument(context);

  /**
   * The file a document's history belongs to: the .highland file, or a plain .fountain/.md file
   * (also for that file's Bin items and Scratchpad).
   */
  const keyOf = (doc: vscode.TextDocument | undefined): string | null => {
    if (!doc) return null;
    if (doc.uri.scheme === SCHEME) return splitBundlePath(doc.uri.fsPath)?.bundle ?? null;
    if (doc.uri.scheme === EXTRAS_SCHEME) return extras.ownerOf(doc.uri) ?? null;
    if (doc.uri.scheme === "file" && doc.languageId.startsWith("highland-")) return doc.uri.fsPath;
    return null;
  };

  const records = historyRecords({ store, extras, history });
  const { resolve, lookup, peek, latest } = records;

  const mirror = new HistoryMirror(context, () => history());
  const connector = new Connector({
    history: () => history(),
    historyRoot,
    mirror,
    store,
    commit: (key, kind, note) => commitNow(key, kind, note),
    compare: async (key, commit) => (await highwaterOpener.open(await documentFor(key)))?.compareWith(commit.hash, commit.date),
    changed: () => void updateStatus(),
  });
  const status = historyStatus({ key: () => focus.key ?? null, enabled, connector, mirror, failures, lastCommit, latest });
  const updateStatus = status.update;
  mirror.onDidChange(() => void updateStatus());
  /** Commits in progress, per document, so a conversion can wait for them. */
  const inflight = new Map<string, Promise<void>>();
  const batcher = new CommitBatcher((key, kind) => {
    const run = commitNow(key, kind);
    inflight.set(key, run);
    void run.finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
    return run;
  });

  async function commitNow(key: string, kind: SaveKind, note?: string): Promise<void> {
    try {
      // A file this computer has no history for may belong to a work in the catalog: ask first.
      if (kind !== "convert" && kind !== "restore" && kind !== "connect") await connector.check(key);
      if (connector.undecided(key)) return; // its saves wait for the writer's choice
      const next = kind === "save" || kind === "autosave" || kind === "close" ? connector.takeNext(key) : undefined;
      const r = await resolve(key);
      if (r.paused) return;
      const c = await history().commit(r.id, r.files, next?.kind ?? kind, new Date(), next?.note ?? note, { form: formOf(key), file: basename(key) });
      if (!key.toLowerCase().endsWith(".highland")) await extras.recorded(key, c?.hash ?? null);
      failures.delete(key);
      if (c) {
        lastCommit.set(key, c.date);
        // The catalog goes to main with the next push; with no mirror, now.
        if (mirror.url) mirror.schedule();
        else await history().flushCatalog();
      }
      void showNotice();
      view.refresh();
      works.refresh();
    } catch (error) {
      failures.set(key, (error as Error).message);
    }
    void updateStatus();
  }

  /**
   * Keeps a version that lost a conflict with another application, as a save noting why. Not for
   * a file whose saves are held (undecided) or whose history is paused: false then, so the caller
   * keeps it in the backups instead.
   */
  async function keepVersion(key: string, note: string, instead?: Instead): Promise<boolean> {
    if (connector.undecided(key)) return false;
    try {
      const r = await resolve(key, instead);
      if (r.paused) return false;
      const c = await history().commit(r.id, r.files, "save", new Date(), note, { form: formOf(key), file: basename(key) });
      if (c) {
        lastCommit.set(key, c.date);
        if (mirror.url) mirror.schedule();
        else await history().flushCatalog();
      }
      view.refresh();
      return true; // recorded now, or identical to the last save (kept already)
    } catch (error) {
      failures.set(key, (error as Error).message);
      return false;
    }
  }

  /** Before a conversion: the file's last save is in the history, and nothing is still being recorded. */
  async function settle(key: string): Promise<void> {
    if (!enabled()) return;
    await inflight.get(key);
    await batcher.saved(key, "save");
    await history().idle();
  }
  /** Once ever: say that history is being kept, and where, with the ways to change that. */
  async function showNotice(): Promise<void> {
    if (context.globalState.get<boolean>(NOTICE_KEY)) return;
    await context.globalState.update(NOTICE_KEY, true);
    const choice = await ask(
      "info",
      `Highwater Too keeps a writing history of your scripts: each save is recorded in a git repository, one branch per script, in ${historyRoot()}. It stays on this computer.`,
      {},
      "Show History",
      "Change Location…",
      "Turn Off",
    );
    if (choice === "Show History") await vscode.commands.executeCommand("highwater.showHistory");
    else if (choice === "Change Location…") await vscode.commands.executeCommand("highwater.changeHistoryLocation");
    else if (choice === "Turn Off") await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  }

  /**
   * A document came into focus (or was in focus when the writing history started: VS Code starts
   * the extension for the file being opened, before anything here listens).
   */
  function focused(): void {
    void updateStatus();
    view.refresh();
    const key = focus.key;
    if (!key || !enabled()) return;
    // A file this computer has no history for: look it up in the catalog (asked once); one that
    // is an older save of its work: offer the latest.
    void connector
      .check(key)
      .then(() => connector.offerLatest(key))
      .then(() => view.refresh());
    // Opening a document: bring in other computers' saves, at most once a minute.
    if (mirror.url && Date.now() - mirror.lastPull > 60_000) void pulled(mirror.pull());
  }

  // The saves changed (the Highwater Editor's Writing History panel listens).
  const changedSaves = new vscode.EventEmitter<void>();
  const view = { refresh: () => changedSaves.fire() };
  /** The document a save belongs to (opened if need be). */
  const documentFor = async (key: string): Promise<vscode.TextDocument> =>
    vscode.workspace.textDocuments.find((d) => keyOf(d) === key && !(d.uri.scheme === SCHEME && splitBundlePath(d.uri.fsPath)?.entry) && d.uri.scheme !== EXTRAS_SCHEME) ??
    vscode.workspace.openTextDocument(key.toLowerCase().endsWith(".highland") ? vscode.Uri.file(key).with({ scheme: SCHEME }) : vscode.Uri.file(key));

  // The Works panel: every work in the catalog, and what can be done with each.
  const askedJoins = new Set<string>();
  const worksHost: WorksHost = {
    history: () => history(),
    mirror,
    connector,
    store,
    openFile: (path) => openFile(path),
    restoreWork: (w) => restoreWork(w),
    settle: (key) => settle(key),
    record: async (key, kind, note) => {
      await inflight.get(key);
      await commitNow(key, kind, note);
    },
    changed: () => {
      view.refresh();
      works.refresh();
      void updateStatus();
    },
  };
  const works = new Works(worksHost);
  // Open Work, Connect, Restore and what follows a pull (history-restore.ts).
  const { openWork, connectToWork, restoreWork, openFile, pulled } = restoreCommands({ history, historyRoot, enabled, mirror, connector, store, extras, focus, settle, lookup, commitNow, updateStatus, view, works, worksHost, askedJoins });
  // For the Highwater Editor's sidebar (sidebar-host.ts): the same history, for one document.
  historyApi = {
    async saves(key) {
      if (!enabled()) return { state: "off", commits: [] };
      const r = await peek(key).catch(() => null);
      return { state: !r ? "none" : r.paused ? "paused" : "on", commits: r ? await history().log(r.id) : [] };
    },
    async revert(key, hash) {
      const r = await lookup(key);
      const commit = r && (await history().log(r.id)).find((c) => c.hash === hash);
      return commit ? revertTo(worksHost, await documentFor(key), key, commit) : false;
    },
    saveText: (hash) => history().scriptAt(hash),
    works,
    mirror: () => ({ ...mirror.state, busy: mirror.busy }),
    onDidChange: (listener) => {
      const a = changedSaves.event(listener);
      const b = works.onDidChange(listener);
      const c = mirror.onDidChange(listener);
      const d = vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("highwater") && listener());
      return { dispose: () => (a.dispose(), b.dispose(), c.dispose(), d.dispose()) };
    },
  };
  // Works another computer deleted, removed here whenever main comes in (pull, push or fetch).
  context.subscriptions.push(mirror.onDidRemoveDeleted((removed) => void deletedElsewhere(worksHost, removed)));

  context.subscriptions.push(
    status.item,
    { dispose: () => batcher.dispose() },
    changedSaves,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("highwater.historyFolder") || e.affectsConfiguration("highwater.writingHistory")) {
        // One History per folder, kept: a second one for the same folder would race the first.
        extras.forget();
        view.refresh();
        void updateStatus();
      }
    }),
    focus.onDidChange(() => focused()),
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
    mirror,
  );
  registerHistoryCommands(context, { enabled, history, focus, extras, mirror, connector, works, records, view, inflight, commitNow, keepVersion, settle, updateStatus, pulled, openWork, connectToWork });

  // The document already in focus (often the one whose opening started the extension).
  focused();

  // On start-up: bring in other computers' saves, then push what could not be pushed last time
  // (offline, say); and every ten minutes, pull again.
  setTimeout(() => {
    if (enabled() && mirror.url) void pulled(mirror.sync());
  }, 15_000);
  const timer = setInterval(() => {
    if (enabled() && mirror.url) void pulled(mirror.pull());
  }, 10 * 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
