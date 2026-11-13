import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { CommitBatcher, computerName, defaultHistoryFolder, formOf, History, moveHistory, syncedFolder, type CommitInfo, type DocumentFiles, type Form, type SaveKind, type WorkInfo } from "@highwater/history";
import { readBundle, writeBundle } from "@highwater/bundle";
import { mkdir, writeFile } from "node:fs/promises";
import { openHighland } from "./open.ts";
import { LANGUAGES } from "./language.ts";
import * as vscode from "vscode";
import { ask, pick } from "./ask.ts";
import { SCHEME } from "./fs-provider.ts";
import { exportHistory, HistoryMirror } from "./mirror.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { EXTRAS_SCHEME, plainExtras, toExtras } from "./extras.ts";
import { detectAssetsFolder, ExtrasFolder, ID_NOTE, idNote, noteId } from "./extras-folder.ts";
import { toBundle, withoutSavedText } from "./to-bundle.ts";
import { Connector } from "./connect.ts";
import { focusedDocument, roleOf, scriptIsOpen } from "./focus.ts";
import { afterPull, deletedElsewhere, revertTo, WorksView, type WorksHost } from "./works.ts";
import { activeView, showDocument } from "./surface.ts";

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
/** The writing history, for the Highland-Style Editor's sidebar (set by registerHistory). */
export let historyApi:
  | {
      /** A document's saves, newest first, and whether its history is on, paused, off, or not begun. */
      saves(key: string): Promise<{ state: "on" | "paused" | "off" | "none"; commits: CommitInfo[] }>;
      compare(key: string, hash: string): Promise<void>;
      /** A save's text (the script), for comparing in the page. */
      saveText(hash: string): Promise<string>;
      revert(key: string, hash: string): Promise<void>;
      works: WorksView;
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
    // In the Highland-Style Editor, its sidebar's Writing History panel.
    const hv = activeView();
    if (hv) {
      void hv.panel.webview.postMessage({ type: "showPanel", panel: "history" });
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
    void vscode.commands.executeCommand("setContext", "highwater.historyPaused", !r.paused);
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

  // The Writing History panel: the current script's saves; click one to compare it with now.
  const view = new HistoryView(async () => {
    const key = focus.key;
    if (!key || !enabled()) return null;
    const r = await peek(key);
    void vscode.commands.executeCommand("setContext", "highwater.historyPaused", r?.paused ?? false);
    return r ? { key, commits: await history().log(r.id) } : null;
  });
  /** The document a save in the Writing History pane belongs to (opened if need be). */
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
  const works = new WorksView(worksHost);
  // For the Highland-Style Editor's sidebar (sidebar-host.ts): the same history, for one document.
  historyApi = {
    async saves(key) {
      if (!enabled()) return { state: "off", commits: [] };
      const r = await peek(key).catch(() => null);
      return { state: !r ? "none" : r.paused ? "paused" : "on", commits: r ? await history().log(r.id) : [] };
    },
    saveText: (hash) => history().scriptAt(hash),
    async compare(key, hash) {
      const r = await lookup(key);
      const commit = r && (await history().log(r.id)).find((c) => c.hash === hash);
      if (commit) await compare(await documentFor(key), key, commit);
    },
    async revert(key, hash) {
      const r = await lookup(key);
      const commit = r && (await history().log(r.id)).find((c) => c.hash === hash);
      if (commit) await revertTo(worksHost, await documentFor(key), key, commit);
    },
    works,
    mirror: () => ({ ...mirror.state, busy: mirror.busy }),
    onDidChange: (listener) => {
      const a = view.onDidChangeTreeData(listener);
      const b = works.onDidChangeTreeData(listener);
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
    vscode.window.registerTreeDataProvider("highwater.history", view),
    vscode.window.registerTreeDataProvider("highwater.works", works),
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
    vscode.commands.registerCommand("highwater.history.revert", async (item: HistoryItem) => revertTo(worksHost, await documentFor(item.key), item.key, item.commit)),
    // Refreshing the Works panel brings the catalog up to date from the mirror first.
    vscode.commands.registerCommand("highwater.works.refresh", async () => {
      if (enabled() && mirror.url) await pulled(mirror.pull(true));
      works.refresh();
    }),
    vscode.commands.registerCommand("highwater.works.open", (node: Parameters<WorksView["open"]>[0]) => works.open(node)),
    vscode.commands.registerCommand("highwater.works.restore", (node: Parameters<WorksView["restore"]>[0]) => works.restore(node)),
    vscode.commands.registerCommand("highwater.works.showSave", (node: Parameters<WorksView["showSave"]>[0]) => works.showSave(node)),
    vscode.commands.registerCommand("highwater.works.remove", (node: Parameters<WorksView["remove"]>[0]) => works.remove(node)),
    vscode.commands.registerCommand("highwater.works.delete", (node: Parameters<WorksView["delete"]>[0]) => works.delete(node)),
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
    vscode.commands.registerCommand("highwater.history.compare", async (item: HistoryItem) => compare(await documentFor(item.key), item.key, item.commit)),
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

  /**
   * Open Work from History…: any work in the history (pulled from another computer too). A work
   * already on this computer opens; any other is restored exactly as its latest save was kept — a
   * .highland or plain file under its recorded name — and continues the same history. Converting it
   * is a separate step afterwards; going back to an older save is done from the open document.
   */
  async function openWork(): Promise<void> {
    const h = history();
    if (mirror.url) await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Bringing in the writing history…" }, () => pulled(mirror.pull()));
    const works = await h.works();
    if (!works.length) {
      void vscode.window.showInformationMessage(mirror.url ? "The writing history has no works yet." : "The writing history has no works yet. To bring in works saved on another computer, set up the history mirror there and here.");
      return;
    }
    const work = await pick(
      works.map((w) => {
        const here = w.paths.slice().reverse().find((p) => existsSync(p));
        return {
          label: w.title,
          description: here ? basename(here) : w.local ? "history on this computer" : "on the mirror",
          detail: `Last saved ${w.lastSave!.toLocaleString()}${w.file ? ` as ${w.file}` : ""}${w.latest ? ` · ${w.latest.message.replace(/^\S+ \S+ \S+, /, "")}` : ""}`,
          work: w,
          here,
        };
      }),
      { title: "Open Work from History", placeHolder: "Choose a work", matchOnDescription: true },
    );
    if (!work) return;
    if (work.here) return void (await openFile(work.here));
    await restoreWork(work.work);
  }

  /**
   * Connect to a Work's History…: the writer joins the focused document (and its own history, if
   * it has one) to another work, usually one whose file is no longer where it was saved: renamed
   * or moved after Highland 2 removed its ID, say. Nothing finds such a file by itself; this is the
   * writer's choice, and permanent, so it is spelled out and confirmed first.
   */
  async function connectToWork(): Promise<void> {
    const key = focus.key;
    if (!key) return void vscode.window.showInformationMessage("Open a document to connect it to a work's writing history.");
    if (!enabled()) return void vscode.window.showInformationMessage("Turn the writing history on to connect a document to a work's history.");
    const h = history();
    const name = basename(key);
    // Its latest save goes into its own history first, so nothing is left out of the join.
    await settle(key);
    const own = await lookup(key);
    const others = (await h.works()).filter((w) => w.id && w.branch !== own?.branch);
    const missing = others.filter((w) => w.local && w.paths.length > 0 && !w.paths.some((p) => existsSync(p)));
    type Item = vscode.QuickPickItem & { work?: WorkInfo; all?: true };
    const item = (w: WorkInfo): Item => {
      const last = w.paths.at(-1);
      return {
        label: w.title,
        description: last ? basename(last) : (w.file ?? ""),
        detail: [w.lastSave ? `Last saved ${w.lastSave.toLocaleString()}` : "", last ? `was at ${last}` : w.local ? "" : "only on the mirror"].filter(Boolean).join(" · "),
        work: w,
      };
    };
    const title = `Connect ${name} to a work's writing history`;
    let picked = await pick<Item>([...missing.map(item), { label: "Show All Works…", all: true }], {
      title,
      placeHolder: missing.length ? "Works whose file is no longer where it was saved" : "No work's file is missing from where it was saved",
    });
    if (picked?.all) picked = await pick<Item>(others.map(item), { title, placeHolder: "Every work in the writing history" });
    const w = picked?.work;
    if (!w?.id) return;

    const form = formOf(key);
    const kept = w.form;
    const saves = own ? (await h.log(own.id, 10_000)).length : 0;
    const previous = w.paths.filter((p) => p !== key);
    const detail = [
      `${name} becomes the file of “${w.title}”, and its saves continue that work's history${w.lastSave ? ` (last saved ${w.lastSave.toLocaleString()})` : ""}.`,
      own
        ? `${name}'s own writing history (${saves} save${saves === 1 ? "" : "s"}) is joined into the history of “${w.title}” in one merge. Both are kept, but they can never be separated again, and ${name}'s separate history is deleted, here and, when they next sync, on your other computers.`
        : `${name} has no writing history of its own: the history of “${w.title}” continues from ${name} as it is now, Bin and Scratchpad included.`,
      kept && kept !== form ? `“${w.title}” is kept as ${kept === "highland" ? "a .highland file" : `a .${kept} file`}, and continues as ${name}, recorded as a conversion.` : "",
      previous.length ? `The work's previous file (${previous.map((p) => basename(p)).join(", ")}) is no longer tracked: if it turns up again, it starts a history of its own.` : "",
      "This cannot be undone.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const ok = await ask("warning", `Permanently join ${name}${own ? " and its writing history" : ""} to the writing history of “${w.title}”?`, { modal: true, detail }, "Join Permanently");
    if (ok !== "Join Permanently") return;

    if (!w.local && !(await mirror.fetchWork(w.branch))) return;
    connector.forget([key, ...previous]);
    for (const p of previous) await h.retire(p);
    if (own) {
      const id = await h.join(own.id, { id: w.id, branch: w.branch, form: kept }, { form, file: name }, "connected by hand");
      // The work's ID goes into a .highland file; a plain file's Bin and Scratchpad move with it.
      if (form === "highland") {
        await store.update(key, (b) => {
          b.setInfo({ ...b.info, highwaterToo: { ...((b.info.highwaterToo as object | undefined) ?? {}), documentId: id } });
          return ["info.json"];
        });
      } else await extras.moveTo(own.id, id);
      if (mirror.url) mirror.schedule();
      else await h.flushCatalog();
    } else {
      await h.claim({ id: w.id, branch: w.branch }, key);
      // Recorded now (even if nothing changed), so the history shows where the file joined it.
      await commitNow(key, kind(kept, form), `to ${name}, connected by hand`);
    }
    extras.forget();
    await vscode.commands.executeCommand("highwater.panels.refresh");
    view.refresh();
    works.refresh();
    void updateStatus();
    void vscode.window.showInformationMessage(`${name} now continues the writing history of “${w.title}”.`);
  }

  /** A connection to a work kept as another kind of file is a conversion. */
  function kind(kept: Form | null, form: Form): SaveKind {
    return kept && kept !== form ? "convert" : "connect";
  }

  /** Restores a work not on this computer (fetching it first if only the mirror has it). */
  async function restoreWork(w: WorkInfo): Promise<void> {
    const h = history();
    if (!w.local && !mirror.url) return void vscode.window.showErrorMessage(`${w.title}'s history is not on this computer. Set up the history mirror to fetch it.`);
    // Where it goes is asked before anything is fetched, so a cancelled restore leaves nothing here.
    const here = w.local ? (await h.branchLog(w.branch, 1))[0] : undefined;
    const known = here?.form ?? w.form ?? (here ? savedForm(await h.filesAt(here.hash)) : "highland");
    const ext = known === "highland" ? "highland" : known;
    const name = here?.file ?? w.file ?? `${w.title}.${ext}`;
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(), name)),
      filters: { [ext === "highland" ? ".highland files" : `.${ext} files`]: [ext] },
      title: `Restore ${w.title}`,
    });
    if (!target) return;
    const path = target.fsPath;
    if (formOf(path) !== known) {
      void vscode.window.showErrorMessage(`${w.title} is kept as a .${ext} file, and is restored as one. To change that, convert it after restoring.`);
      return;
    }
    if (existsSync(path)) {
      const choice = await ask(
        "warning",
        `${basename(path)} is already in that folder.`,
        { modal: true, detail: "It may have been copied or synced there. Open it instead, or replace it with the restored work?" },
        "Open It",
        "Replace It",
      );
      if (!choice) return;
      if (choice === "Open It") return void (await openFile(path));
    }
    // Only in the catalog: fetch its history now (the writer asked for this work).
    if (!w.local && !(await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Fetching ${w.title}…` }, () => mirror.fetchWork(w.branch)))) return;
    const latest = (await h.branchLog(w.branch, 1))[0];
    if (!latest) return;
    const files = await h.filesAt(latest.hash);
    const form = latest.form ?? savedForm(files);
    if (form !== known) return void vscode.window.showErrorMessage(`${w.title} is now kept as a .${form === "highland" ? "highland" : form} file. Restore it again to choose a name for that.`);
    // The restored file continues the work's history.
    const id = await h.claim(w, path);
    if (form === "highland") await writeBundle(path, toBundle(files, id));
    else {
      // A plain file, exactly as saved: the text, its Bin, Scratchpad and the rest back with
      // Highwater Too, its images in the folder its text refers to, beside it.
      const images = (files.others ?? []).filter((o) => /^assets\/[^/]+$/.test(o.path));
      await writeFile(path, files.script);
      const kept = toExtras(files);
      const folderName = images.length ? (detectAssetsFolder(files.script, images.map((o) => o.path.slice("assets/".length))) ?? `${basename(path, extname(path))} assets`) : null;
      if (folderName) {
        const dir = join(dirname(path), folderName);
        await mkdir(dir, { recursive: true });
        for (const a of images) await writeFile(join(dir, a.path.slice("assets/".length)), a.data);
      }
      if (kept.bin.length || kept.scratchpad !== undefined || kept.document || folderName) {
        const folder = new ExtrasFolder(join(historyRoot(), "extras", id));
        await folder.replace(kept);
        if (folderName) await folder.updateSettings({ assetsFolder: folderName });
      }
      extras.forget();
    }
    await commitNow(path, "restore", `on ${computerName()}`);
    await openFile(path);
    view.refresh();
    void updateStatus();
  }

  async function openFile(path: string): Promise<void> {
    if (path.toLowerCase().endsWith(".highland")) {
      await openHighland(vscode.Uri.file(path));
      return;
    }
    let doc = await vscode.workspace.openTextDocument(path);
    if (/\.(md|markdown)$/i.test(path) && doc.languageId === "markdown") doc = await vscode.languages.setTextDocumentLanguage(doc, LANGUAGES.markdown);
    await showDocument(doc);
  }

  /**
   * After a pull: show what came in, bring in open plain files' Bin and Scratchpad, drop works
   * deleted elsewhere, and offer to join histories that began as copies.
   */
  async function pulled(work: Promise<string[]>): Promise<void> {
    const updated = await work.catch(() => [] as string[]);
    if (updated.length) {
      extras.forget();
      for (const d of vscode.workspace.textDocuments) if (extras.isPlain(d)) await extras.bringIn(d.uri.fsPath).catch(() => false);
      if (updated.includes("main")) await afterPull(worksHost, askedJoins).catch(() => undefined);
      // Open files that are now older saves of their works: offer the latest.
      const open = new Set<string>();
      for (const d of vscode.workspace.textDocuments) {
        const role = roleOf(d);
        if (role.kind === "script" && scriptIsOpen(role.key)) open.add(role.key);
      }
      for (const key of open) await connector.offerLatest(key).catch(() => undefined);
      view.refresh();
      works.refresh();
      void updateStatus();
    }
  }
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

/** A save's form, judged by its files, for saves made before the Highwater-Form line. */
function savedForm(files: DocumentFiles): Form {
  const info = files.others?.find((o) => o.path === "info.json");
  if (info) {
    try {
      if ("type" in (JSON.parse(new TextDecoder().decode(info.data)) as object)) return "highland";
    } catch {
      // not a .highland file's info.json
    }
  }
  return formOf(files.scriptName);
}

/** "14:03" today, else "11 Oct". */
function when(d: Date): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

interface HistoryItem {
  key: string;
  commit: CommitInfo;
}

class HistoryView implements vscode.TreeDataProvider<HistoryItem> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;

  constructor(private readonly load: () => Promise<{ key: string; commits: CommitInfo[] } | null>) {}

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
    t.contextValue = "save";
    return t;
  }

  async getChildren(item?: HistoryItem): Promise<HistoryItem[]> {
    if (item) return [];
    const data = await this.load().catch(() => null);
    if (!data) return [];
    return data.commits.map((commit) => ({ key: data.key, commit }));
  }
}
