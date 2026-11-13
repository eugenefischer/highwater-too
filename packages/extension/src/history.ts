import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname } from "node:path";
import { CommitBatcher, defaultHistoryFolder, formOf, History, moveHistory, syncedFolder, type CommitInfo, type DocumentFiles, type SaveKind } from "@highwater/history";
import { readBundle } from "@highwater/bundle";
import { writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { ask, pick } from "./ask.ts";
import { SCHEME } from "./fs-provider.ts";
import { exportHistory, HistoryMirror } from "./mirror.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { EXTRAS_SCHEME, plainExtras } from "./extras.ts";
import { ID_NOTE, idNote, noteId } from "./extras-folder.ts";
import { withoutSavedText } from "./to-bundle.ts";
import { Connector } from "./connect.ts";
import { focusedDocument } from "./focus.ts";
import { deletedElsewhere, revertTo, Works, type WorksHost } from "./works.ts";
import { activeView } from "./surface.ts";
import { postTo } from "./highland-editor/messages.ts";
import { restoreCommands } from "./history-restore.ts";

/** Our key in info.json: { documentId } ties a .highland file to its branch in the history. */
const INFO_KEY = "highwaterToo";
const HISTORY_SCHEME = "highwater-history";
const NOTICE_KEY = "highwater.historyNoticeShown";

/** The history folder: the writer's choice, else the system's application-data folder. */
export function historyRoot(): string {
  const chosen = vscode.workspace.getConfiguration("highwater").get<string>("historyFolder", "").trim();
  return chosen || defaultHistoryFolder(process.platform, process.env, homedir());
}

let histories = new Map<string, History>();

/** The writing history in the current history folder, or null when it is turned off. */
export function currentHistory(): History | null {
  if (!vscode.workspace.getConfiguration("highwater").get<boolean>("writingHistory", true)) return null;
  return historyAt(historyRoot());
}

function historyAt(dir: string): History {
  let h = histories.get(dir);
  if (!h) histories.set(dir, (h = new History(dir, { stillHas })));
  return h;
}

/**
 * The work's file at `path` is still there and still the work's: it exists and names this ID or
 * none (Highland 2 drops the ID when it saves). Otherwise a file found elsewhere with the work's ID
 * or text is the work's file moved, not a copy.
 */
async function stillHas(path: string, id: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const named = await fileId(path).catch(() => null);
  return named === null || named === id;
}

/** "14:03" today, else "11 Oct". */
function when(d: Date): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The document ID a file names: in a .highland file's info.json, or a plain file's ID note. */
async function fileId(path: string): Promise<string | null> {
  if (path.toLowerCase().endsWith(".highland")) {
    const ours = (await readBundle(path)).bundle.info[INFO_KEY] as { documentId?: unknown } | undefined;
    return typeof ours?.documentId === "string" ? ours.documentId : null;
  }
  return noteId(await readFile(path, "utf8"));
}

/**
 * The writing history (M7): each save commits the script text, Bin and Scratchpad to the
 * document's branch in the history repository. Explicit saves commit at once; autosaves at most every
 * five minutes, and once more when the document closes. A failed commit never blocks a save.
 */
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

export function registerHistory(context: vscode.ExtensionContext, store: BundleStore): void {
  const reasons = new Map<string, vscode.TextDocumentSaveReason>();
  const status = vscode.window.createStatusBarItem("highwater.history", vscode.StatusBarAlignment.Left, 0);
  status.name = "Highwater Too: writing history";
  status.command = "highwater.showHistory";
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

  /**
   * Reads what the history records for a document, and its stored ID. `instead`: one entry's text
   * as it is in the editor rather than on disk (unsaved changes being set aside).
   */
  async function snapshot(key: string, instead?: Instead): Promise<{ id: string | null; files: DocumentFiles }> {
    if (key.toLowerCase().endsWith(".highland")) {
      const b = await store.snapshot(key);
      const info = b.info[INFO_KEY] as { documentId?: unknown } | undefined;
      const id = typeof info?.documentId === "string" ? info.documentId : null;
      // Everything else in the file too (settings, assets, …): the commit is the file unpacked.
      const others = b.paths
        .filter((p) => p !== b.textPath && p !== "scratchpad.txt" && !/^bin\/\d+\.txt$/.test(p) && !p.endsWith("/"))
        .map((p) => ({ path: p, data: p === "info.json" ? withoutSavedText(b.get(p)!) : b.get(p)! }));
      const files: DocumentFiles = { scriptName: b.textPath.split("/").pop()!, script: b.text, bin: [...b.binItems], ...(b.scratchpad !== undefined ? { scratchpad: b.scratchpad } : {}), others };
      if (instead) {
        // (The store's bundle is shared and read-only: the change goes into this copy of its parts.)
        const bin = /^bin\/(\d+)\.txt$/.exec(instead.entry);
        if (instead.entry === "") files.script = instead.text;
        else if (instead.entry === "scratchpad.txt") files.scratchpad = instead.text;
        else if (bin) files.bin![Number(bin[1])] = instead.text;
      }
      return { id, files };
    }
    const ext = extname(key).toLowerCase();
    const scriptName = ext === ".fountain" || ext === ".spmd" ? "text.fountain" : ext === ".txt" ? "text.txt" : "text.md";
    const script = await readFile(key, "utf8");
    // Its Bin, Scratchpad, settings and images, kept outside the file.
    return { id: noteId(script), files: { scriptName, script, ...(await extras.historyFiles(key)) } };
  }

  async function resolve(key: string, instead?: Instead) {
    const { id, files } = await snapshot(key, instead);
    const resolved = await history().resolve({ id, path: key, text: files.script });
    // Highland drops keys it does not know when it saves; put the ID back (or the new one, for a
    // copy kept as a separate work). A copy is not written to until the writer decides.
    if (key.toLowerCase().endsWith(".highland") && resolved.id !== id && !resolved.copyOf) {
      await store.update(key, (b) => {
        b.setInfo({ ...b.info, [INFO_KEY]: { ...((b.info[INFO_KEY] as object | undefined) ?? {}), documentId: resolved.id } });
        return ["info.json"];
      });
    }
    // A plain file's ID note naming another work (a copy kept separate) names its own work now.
    if (!key.toLowerCase().endsWith(".highland") && id && resolved.id !== id && !resolved.copyOf) {
      const text = await readFile(key, "utf8");
      const now = text.replace(ID_NOTE, idNote(resolved.id));
      if (now !== text) {
        await writeFile(key, now);
        files.script = files.script.replace(ID_NOTE, idNote(resolved.id));
      }
    }
    return { ...resolved, files };
  }

  const mirror = new HistoryMirror(context, () => history());
  const connector = new Connector({
    history: () => history(),
    historyRoot,
    mirror,
    store,
    commit: (key, kind, note) => commitNow(key, kind, note),
    compare: async (key, commit) => {
      const doc = vscode.workspace.textDocuments.find((d) => keyOf(d) === key && !(d.uri.scheme === SCHEME && splitBundlePath(d.uri.fsPath)?.entry));
      if (doc) await compare(doc, key, commit);
    },
    changed: () => void updateStatus(),
  });
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
    if (choice === "Show History") await showHistory();
    else if (choice === "Change Location…") await changeLocation();
    else if (choice === "Turn Off") await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  }

  async function updateStatus(): Promise<void> {
    const key = (focus.key ?? null);
    if (!key || !enabled()) {
      status.hide();
      return;
    }
    const failed = failures.get(key);
    status.command = "highwater.showHistory";
    if (connector.undecided(key)) {
      status.text = "$(history)$(warning) Choose";
      status.tooltip = `${basename(key)} matches a work in your writing history, and its saves are not recorded until you choose how it continues. Click to choose.`;
      status.command = "highwater.history.decide";
    } else if (failed) {
      status.text = "$(warning) History";
      status.tooltip = `The last save was not added to the writing history: ${failed}. It will be tried again on the next save.`;
    } else {
      const last = lastCommit.get(key) ?? (await latest(key))?.date;
      status.text = last ? `$(history) ${when(last)}` : "$(history)";
      status.tooltip = last ? `Writing history: last save recorded ${last.toLocaleString()}. Click to see the saves.` : "Writing history: starts with the next save.";
      if (mirror.url) {
        if (mirror.state.signIn) {
          status.tooltip += `\nNot mirrored: ${mirror.url} needs you to sign in. Click to sign in.`;
          status.text = status.text.replace("$(history)", "$(history)$(warning)");
          status.command = "highwater.signInHistoryMirror";
        } else if (mirror.state.error) {
          status.tooltip += `\nNot mirrored yet: ${mirror.state.error}. Tried again in ten minutes and after the next save.`;
          status.text = status.text.replace("$(history)", "$(history)$(cloud-upload)");
        } else status.tooltip += mirror.state.at ? `\nMirrored to ${mirror.url} at ${mirror.state.at.toLocaleTimeString()}.` : `\nMirrored to ${mirror.url}.`;
      }
    }
    status.show();
  }

  /** Looks a document's history up without creating anything (viewing must not write files). */
  async function lookup(key: string) {
    const { id, files } = await snapshot(key);
    return history().find({ id, path: key, text: files.script });
  }

  /** For showing the history (the panels, the status bar): as it is now, not after a pull in progress. */
  async function peek(key: string) {
    const { id, files } = await snapshot(key);
    return history().find({ id, path: key, text: files.script }, { wait: false });
  }

  async function latest(key: string): Promise<CommitInfo | undefined> {
    try {
      const found = await peek(key);
      return found ? (await history().log(found.id, 1))[0] : undefined;
    } catch {
      return undefined;
    }
  }

  async function changeLocation(): Promise<void> {
    const current = historyRoot();
    const fallback = defaultHistoryFolder(process.platform, process.env, homedir());
    const picked = await pick(
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
        const ok = await ask(
          "warning",
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
      const ok = await ask("info", `${target} already holds a writing history. Use it from now on? The history in ${current} stays where it is.`, { modal: true }, "Use It");
      if (ok !== "Use It") return;
    } else if (existing.length > 0) {
      void vscode.window.showErrorMessage(`${target} is not empty. Choose an empty folder, or a new one, for the writing history.`);
      return;
    } else if (existsSync(current)) {
      const ok = await ask("info", `Move the writing history from ${current} to ${target}?`, { modal: true }, "Move");
      if (ok !== "Move") return;
      await batcherIdle();
      await moveHistory(current, target);
    }
    await vscode.workspace.getConfiguration("highwater").update("historyFolder", target === fallback ? undefined : target, vscode.ConfigurationTarget.Global);
    // The folders' contents moved: start afresh with both.
    histories.delete(current);
    histories.delete(target);
    extras.forget();
    view.refresh();
    void updateStatus();
  }

  /** Waits for commits in progress. */
  async function batcherIdle(): Promise<void> {
    await history().idle();
  }

  async function showHistory(): Promise<void> {
    // In the Highwater Editor, its sidebar's Writing History panel.
    const hv = activeView();
    if (hv) {
      postTo(hv.panel, { type: "showPanel", panel: "history" });
      return;
    }
    const key = focus.key;
    const doc = await focus.document();
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
    const picked = await pick(
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
    const key = (focus.key ?? null);
    if (!key) return;
    if (connector.undecided(key)) {
      void vscode.window.showWarningMessage(`First choose how ${basename(key)} continues: click Choose in the status bar.`);
      return;
    }
    const r = await resolve(key);
    await history().setPaused(r.id, !r.paused);
    void vscode.window.showInformationMessage(r.paused ? `Writing history is on again for ${basename(key)}.` : `Writing history is off for ${basename(key)}; earlier saves are kept.`);
    view.refresh();
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
    showSave: async (path, title, commit) => {
      const left = vscode.Uri.from({ scheme: HISTORY_SCHEME, path: `/${title} (${commit.hash.slice(0, 7)})`, query: JSON.stringify({ hash: commit.hash }) });
      if (path && existsSync(path)) {
        const right = path.toLowerCase().endsWith(".highland") ? vscode.Uri.file(path).with({ scheme: SCHEME }) : vscode.Uri.file(path);
        await vscode.commands.executeCommand("vscode.diff", left, right, `${title}: ${commit.message} ↔ now`);
      } else await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(left), { preview: true });
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
    status,
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
    vscode.workspace.registerTextDocumentContentProvider(HISTORY_SCHEME, {
      provideTextDocumentContent: async (uri) => {
        const q = JSON.parse(uri.query) as { hash: string };
        return history().scriptAt(q.hash);
      },
    }),
    vscode.commands.registerCommand("highwater.showHistory", () => showHistory()),
    // Refreshing the Works panel brings the catalog up to date from the mirror first.
    vscode.commands.registerCommand("highwater.works.refresh", async () => {
      if (enabled() && mirror.url) await pulled(mirror.pull(true));
      works.refresh();
    }),
    vscode.commands.registerCommand("highwater.history.decide", async () => {
      const key = (focus.key ?? null);
      if (key) await connector.check(key);
    }),
    // Used by the conversions (convert.ts), not shown in the Command Palette.
    vscode.commands.registerCommand("highwater.history.settle", (path: string) => settle(path)),
    // Used when another application changed an open .highland file (conflicts.ts): the version
    // that loses is kept as a save, then the one that wins is recorded on top.
    vscode.commands.registerCommand("highwater.history.setAside", async (path: string, note: string, instead?: Instead) => {
      if (!enabled()) return false;
      await inflight.get(path);
      await batcherIdle();
      return keepVersion(path, note, instead);
    }),
    // A copy the writer made on purpose (Save As… in conflicts.ts): it starts a history of its own.
    vscode.commands.registerCommand("highwater.history.separate", async (path: string) => {
      if (enabled()) await history().retire(path);
    }),
    vscode.commands.registerCommand("highwater.history.record", async (path: string) => {
      if (enabled()) await commitNow(path, "save");
    }),
    vscode.commands.registerCommand("highwater.history.converted", async (path: string, note: string) => {
      if (enabled()) await commitNow(path, "convert", note);
      view.refresh();
    }),
    vscode.commands.registerCommand("highwater.changeHistoryLocation", () => changeLocation()),
    vscode.commands.registerCommand("highwater.toggleDocumentHistory", () => togglePause()),
    mirror,
    vscode.commands.registerCommand("highwater.setUpHistoryMirror", () => mirror.setUp()),
    vscode.commands.registerCommand("highwater.signInHistoryMirror", async () => {
      await mirror.signIn();
      view.refresh();
      void updateStatus();
    }),
    vscode.commands.registerCommand("highwater.forgetHistoryMirrorSignIn", () => mirror.forgetSignIn()),
    vscode.commands.registerCommand("highwater.pushHistoryNow", () => pulled(mirror.sync(true))),
    vscode.commands.registerCommand("highwater.exportHistory", async () => {
      const key = (focus.key ?? null);
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
    vscode.commands.registerCommand("highwater.openWorkFromHistory", () => openWork()),
    vscode.commands.registerCommand("highwater.connectToWork", () => connectToWork()),
    vscode.commands.registerCommand("highwater.openHistoryFolder", () => vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(historyRoot()))),
  );
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

/** One entry of a .highland file as an editor holds it (not as on disk). */
interface Instead {
  entry: string;
  text: string;
}
