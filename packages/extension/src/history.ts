import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { CommitBatcher, computerName, defaultHistoryFolder, formOf, History, moveHistory, syncedFolder, type CommitInfo, type DocumentFiles, type Form, type SaveKind, type WorkInfo } from "@highwater/history";
import { writeBundle } from "@highwater/bundle";
import { mkdir, writeFile } from "node:fs/promises";
import { openHighland } from "./open.ts";
import { LANGUAGES } from "./language.ts";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { exportHistory, HistoryMirror } from "./mirror.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { EXTRAS_SCHEME, plainExtras, toExtras } from "./extras.ts";
import { detectAssetsFolder, ExtrasFolder, noteId } from "./extras-folder.ts";
import { toBundle, withoutSavedText } from "./to-bundle.ts";
import { Connector } from "./connect.ts";

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
  if (!h) histories.set(dir, (h = new History(dir)));
  return h;
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
  const lastCommit = new Map<string, Date>();
  const failures = new Map<string, string>();

  const enabled = () => vscode.workspace.getConfiguration("highwater").get<boolean>("writingHistory", true);
  const history = () => historyAt(historyRoot());
  const extras = plainExtras();

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

  /** Reads what the history records for a document, and its stored ID. */
  async function snapshot(key: string): Promise<{ id: string | null; files: DocumentFiles }> {
    if (key.toLowerCase().endsWith(".highland")) {
      const b = await store.snapshot(key);
      const info = b.info[INFO_KEY] as { documentId?: unknown } | undefined;
      const id = typeof info?.documentId === "string" ? info.documentId : null;
      // Everything else in the file too (settings, assets, …): the commit is the file unpacked.
      const others = b.paths
        .filter((p) => p !== b.textPath && p !== "scratchpad.txt" && !/^bin\/\d+\.txt$/.test(p) && !p.endsWith("/"))
        .map((p) => ({ path: p, data: p === "info.json" ? withoutSavedText(b.get(p)!) : b.get(p)! }));
      return { id, files: { scriptName: b.textPath.split("/").pop()!, script: b.text, bin: b.binItems, ...(b.scratchpad !== undefined ? { scratchpad: b.scratchpad } : {}), others } };
    }
    const ext = extname(key).toLowerCase();
    const scriptName = ext === ".fountain" || ext === ".spmd" ? "text.fountain" : ext === ".txt" ? "text.txt" : "text.md";
    const script = await readFile(key, "utf8");
    // Its Bin, Scratchpad, settings and images, kept outside the file.
    return { id: noteId(script), files: { scriptName, script, ...(await extras.historyFiles(key)) } };
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
      if (kind !== "convert" && kind !== "restore") await connector.check(key);
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
    } catch (error) {
      failures.set(key, (error as Error).message);
    }
    void updateStatus();
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
        // One History per folder, kept: a second one for the same folder would race the first.
        extras.forget();
        view.refresh();
        void updateStatus();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      void updateStatus();
      view.refresh();
      // A file this computer has no history for: look it up in the catalog (asked once).
      const key = keyOf(e?.document);
      if (key && enabled()) void connector.check(key).then(() => view.refresh());
      // Opening a document: bring in other computers' saves, at most once a minute.
      if (enabled() && mirror.url && keyOf(e?.document) && Date.now() - mirror.lastPull > 60_000) void pulled(mirror.pull());
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
    vscode.commands.registerCommand("highwater.history.decide", async () => {
      const key = keyOf(vscode.window.activeTextEditor?.document);
      if (key) await connector.check(key);
    }),
    // Used by the conversions (convert.ts), not shown in the Command Palette.
    vscode.commands.registerCommand("highwater.history.settle", (path: string) => settle(path)),
    vscode.commands.registerCommand("highwater.history.converted", async (path: string, note: string) => {
      if (enabled()) await commitNow(path, "convert", note);
      view.refresh();
    }),
    vscode.commands.registerCommand("highwater.history.compare", (item: HistoryItem) => compare(item.doc, item.key, item.commit)),
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
    vscode.commands.registerCommand("highwater.openWorkFromHistory", () => openWork()),
    vscode.commands.registerCommand("highwater.openHistoryFolder", () => vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(historyRoot()))),
  );
  void updateStatus();

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
    const work = await vscode.window.showQuickPick(
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

  /** Restores a work not on this computer (fetching it first if only the mirror has it). */
  async function restoreWork(w: WorkInfo): Promise<void> {
    const h = history();
    // Only in the catalog: fetch its history first (the writer asked for this work).
    if (!w.local) {
      if (!mirror.url) return void vscode.window.showErrorMessage(`${w.title}'s history is not on this computer. Set up the history mirror to fetch it.`);
      if (!(await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Fetching ${w.title}…` }, () => mirror.fetchWork(w.branch)))) return;
    }
    const latest = (await h.branchLog(w.branch, 1))[0];
    if (!latest) return;
    const files = await h.filesAt(latest.hash);
    const form = latest.form ?? savedForm(files);
    const ext = form === "highland" ? "highland" : form;
    const name = latest.file ?? `${w.title}.${ext}`;
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(), name)),
      filters: { [ext === "highland" ? ".highland files" : `.${ext} files`]: [ext] },
      title: `Restore ${w.title}`,
    });
    if (!target) return;
    const path = target.fsPath;
    if (formOf(path) !== form) {
      void vscode.window.showErrorMessage(`${w.title} is kept as a .${ext} file, and is restored as one. To change that, convert it after restoring.`);
      return;
    }
    if (existsSync(path)) {
      const choice = await vscode.window.showWarningMessage(
        `${basename(path)} is already in that folder.`,
        { modal: true, detail: "It may have been copied or synced there. Open it instead, or replace it with the restored work?" },
        "Open It",
        "Replace It",
      );
      if (!choice) return;
      if (choice === "Open It") return void (await openFile(path));
    }
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
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /** After a pull: show what came in, and bring in open plain files' Bin and Scratchpad. */
  async function pulled(work: Promise<string[]>): Promise<void> {
    const updated = await work.catch(() => [] as string[]);
    if (updated.length) {
      extras.forget();
      for (const d of vscode.workspace.textDocuments) if (extras.isPlain(d)) await extras.bringIn(d.uri.fsPath).catch(() => false);
      view.refresh();
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
