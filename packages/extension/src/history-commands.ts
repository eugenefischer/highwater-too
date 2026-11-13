import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { defaultHistoryFolder, moveHistory, syncedFolder, type History, type SaveKind } from "@highwater/history";
import * as vscode from "vscode";
import { ask, pick } from "./ask.ts";
import type { Connector } from "./connect.ts";
import type { PlainExtras } from "./extras.ts";
import type { focusedDocument } from "./focus.ts";
import { exportHistory, type HistoryMirror } from "./mirror.ts";
import { activeView, highwaterOpener } from "./surface.ts";
import { forgetHistories, historyRoot } from "./history-location.ts";
import type { HistoryRecords, Instead } from "./history-records.ts";
import type { Works } from "./works.ts";

/** What the writing history's commands work with (registerHistory makes it). */
export interface HistoryCommandsCore {
  enabled: () => boolean;
  history: () => History;
  focus: ReturnType<typeof focusedDocument>;
  extras: PlainExtras;
  mirror: HistoryMirror;
  connector: Connector;
  works: Works;
  records: HistoryRecords;
  view: { refresh(): void };
  inflight: Map<string, Promise<void>>;
  commitNow(key: string, kind: SaveKind, note?: string): Promise<void>;
  keepVersion(key: string, note: string, instead?: Instead): Promise<boolean>;
  settle(key: string): Promise<void>;
  updateStatus(): Promise<void>;
  pulled(run: ReturnType<HistoryMirror["pull"]>): Promise<void>;
  openWork(): Promise<void>;
  connectToWork(): Promise<void>;
}

/** The writing history's commands: the Command Palette's, and those other parts of the extension call. */
export function registerHistoryCommands(context: vscode.ExtensionContext, core: HistoryCommandsCore): void {
  const { enabled, history, focus, extras, mirror, connector, works, view, inflight, commitNow, keepVersion, settle, updateStatus, pulled, openWork, connectToWork } = core;
  const { resolve, lookup } = core.records;

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
      await history().idle();
      await moveHistory(current, target);
    }
    await vscode.workspace.getConfiguration("highwater").update("historyFolder", target === fallback ? undefined : target, vscode.ConfigurationTarget.Global);
    // The folders' contents moved: start afresh with both.
    forgetHistories(current, target);
    extras.forget();
    view.refresh();
    void updateStatus();
  }

  /** The Writing History panel of the document in front (in the Highwater Editor; from the text editor too). */
  async function showHistory(): Promise<void> {
    const doc = activeView()?.document ?? (await focus.document());
    if (!doc || !focus.key) {
      void vscode.window.showInformationMessage("Open a document to see its writing history.");
      return;
    }
    (await highwaterOpener.open(doc))?.showPanel("history");
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

  context.subscriptions.push(
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
      await history().idle();
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
}
