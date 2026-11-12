import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { formOf, type CommitInfo, type History, type WorkInfo } from "@highwater/history";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
import type { Connector } from "./connect.ts";
import { plainExtras } from "./extras.ts";
import type { HistoryMirror } from "./mirror.ts";
import type { BundleStore } from "./store.ts";

export interface WorksHost {
  history(): History;
  mirror: HistoryMirror;
  connector: Connector;
  store: BundleStore;
  openFile(path: string): Promise<void>;
  restoreWork(work: WorkInfo): Promise<void>;
  /** A save's text, read only, beside the work's file if it is here. */
  showSave(path: string | null, title: string, commit: CommitInfo): Promise<void>;
  /** The history changed: refresh the panels and the status bar. */
  changed(): void;
}

export type WorkNode = Node;

type Node = { kind: "work"; work: WorkInfo; here: string | undefined } | { kind: "save"; work: WorkInfo; here: string | undefined; commit: CommitInfo };

/**
 * The Works panel (Writing history 2): every work in the catalog, newest save first, and for works
 * on this computer their saves. From here a work is opened, restored, removed from this computer,
 * or its history deleted.
 */
export class WorksView implements vscode.TreeDataProvider<Node> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly #host: WorksHost;

  constructor(host: WorksHost) {
    this.#host = host;
  }

  refresh(): void {
    this.#changed.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "save") {
      const t = new vscode.TreeItem(`${node.commit.date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`);
      t.description = node.commit.message.replace(/^(\S+) \S+ \S+, /, "$1, ");
      t.tooltip = `${node.commit.message}\n${node.commit.hash}`;
      t.iconPath = new vscode.ThemeIcon("history");
      t.command = { command: "highwater.works.showSave", title: "Show", arguments: [node] };
      return t;
    }
    const w = node.work;
    const t = new vscode.TreeItem(w.title, w.local ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    t.description = node.here ? basename(node.here) : w.local ? "history on this computer" : "on the mirror";
    const kind = w.form === "highland" ? ".highland file" : w.form ? `.${w.form} file` : "file";
    t.tooltip = `${w.title}\nKept as a ${kind}${w.file ? ` (${w.file})` : ""}${w.lastSave ? `\nLast saved ${w.lastSave.toLocaleString()}` : ""}\n${node.here ? `Here: ${node.here}` : w.local ? "Its history is on this computer; its file is not." : "Only on the mirror."}`;
    t.iconPath = new vscode.ThemeIcon(node.here ? "file" : w.local ? "history" : "cloud");
    t.contextValue = node.here ? "work.here" : w.local ? "work.local" : "work.remote";
    if (node.here) t.command = { command: "highwater.works.open", title: "Open", arguments: [node] };
    return t;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const h = this.#host.history();
    if (!node) {
      const works = await h.works().catch(() => []);
      return works.map((work) => ({ kind: "work", work, here: work.paths.slice().reverse().find((p) => existsSync(p)) }));
    }
    if (node.kind === "save" || !node.work.local) return [];
    const saves = await h.branchLog(node.work.branch, 200);
    return saves.map((commit) => ({ kind: "save", work: node.work, here: node.here, commit }));
  }

  // -------------------------------------------------------------------------------------------

  async open(node: Node): Promise<void> {
    if (node.here) await this.#host.openFile(node.here);
    else await this.restore(node);
  }

  async restore(node: Node): Promise<void> {
    await this.#host.restoreWork(node.work);
    this.#host.changed();
  }

  async showSave(node: Node): Promise<void> {
    if (node.kind !== "save") return;
    await this.#host.showSave(node.here ?? null, node.work.title, node.commit);
  }

  /** Remove from This Computer: the history goes from here (sent to the mirror first), and stays there. */
  async remove(node: Node): Promise<void> {
    const w = node.work;
    const { mirror } = this.#host;
    if (!w.local || !w.id) return;
    if (!mirror.url) {
      void vscode.window.showErrorMessage(`Without a history mirror, removing ${w.title} from this computer would lose its history. Delete Writing History… removes it for good.`);
      return;
    }
    const ok = await ask(
      "warning",
      `Remove the writing history of “${w.title}” from this computer?`,
      { modal: true, detail: `It is sent to the mirror first and stays there: you can restore it, or connect its file again, later. ${node.here ? `${basename(node.here)} itself is not touched.` : ""}`.trim() },
      "Remove",
    );
    if (ok !== "Remove") return;
    if (!(await mirror.push(true))) {
      void vscode.window.showErrorMessage(`Could not send ${w.title}'s latest saves to the mirror, so its history was not removed.`);
      return;
    }
    const h = this.#host.history();
    const paths = await h.remove({ id: w.id, branch: w.branch });
    await plainExtras().removeFor(w.id);
    this.#host.connector.forget(paths);
    this.#host.changed();
    void vscode.window.showInformationMessage(`${w.title}'s writing history is no longer on this computer. It is still on the mirror.`);
  }

  /** Delete Writing History…: permanent, here or everywhere; the file stays and starts a new history. */
  async delete(node: Node): Promise<void> {
    const w = node.work;
    if (!w.id) return;
    const h = this.#host.history();
    const { mirror } = this.#host;
    const count = w.local ? (await h.branchLog(w.branch, 100_000)).length : 0;
    const saves = count ? `All ${count.toLocaleString()} saves` : "Its saves";
    const first = await ask(
      "warning",
      `Delete the writing history of “${w.title}”?`,
      {
        modal: true,
        detail: `${saves} will be deleted permanently. This cannot be undone.\n\nThe file itself is not deleted. If you keep working on it, that is the beginning of a new history.`,
      },
      "Delete History",
    );
    if (first !== "Delete History") return;
    let everywhere = true;
    if (mirror.url) {
      const where = await ask(
        "warning",
        "Delete everywhere?",
        {
          modal: true,
          detail:
            "Delete Everywhere removes it from the mirror and from every computer linked to it, when each next syncs.\n\nOnly on This Computer deletes it here; the mirror and your other computers keep their copies, and this computer will not fetch it back.",
        },
        "Delete Everywhere",
        "Only on This Computer",
      );
      if (!where) return;
      everywhere = where === "Delete Everywhere";
    }
    // A plain file keeps its Bin, Scratchpad and settings for its new history.
    for (const p of w.paths) if (formOf(p) !== "highland") await plainExtras().keepForNewHistory(p, w.id);
    let paths: string[];
    if (everywhere) {
      paths = (await h.deleteWork({ id: w.id, branch: w.branch })).paths;
      if (mirror.url) {
        await mirror.deleteRemote(w.branch);
        await mirror.push(true);
      }
    } else if (w.local) paths = await h.remove({ id: w.id, branch: w.branch }, { exclude: true });
    else {
      await h.exclude({ id: w.id, branch: w.branch });
      paths = [];
    }
    this.#host.connector.forget(paths.length ? paths : w.paths);
    this.#host.changed();
    void vscode.window.showInformationMessage(`The writing history of ${w.title} was deleted${everywhere && mirror.url ? " everywhere" : mirror.url ? " on this computer" : ""}.`);
  }
}

/**
 * Works another computer deleted, just removed here by a pull, push or fetch: their plain files
 * keep their Bin and Scratchpad for a new history, and their files are looked at afresh.
 */
export async function deletedElsewhere(host: WorksHost, removed: { id: string; paths: string[] }[]): Promise<void> {
  for (const r of removed) {
    for (const p of r.paths) if (formOf(p) !== "highland") await plainExtras().keepForNewHistory(p, r.id);
    host.connector.forget(r.paths);
    if (r.paths.length) void vscode.window.showInformationMessage(`The writing history of ${basename(r.paths.at(-1)!)} was deleted on another computer. The file is untouched; if you keep working on it, it starts a new history.`);
  }
  host.changed();
}

/** After main came in: local works that began as a copy of another work's save are offered to join it. */
export async function afterPull(host: WorksHost, asked: Set<string>): Promise<void> {
  const h = host.history();
  if (!host.mirror.url) return;
  const works = await h.works();
  for (const c of await h.copyCandidates()) {
    const pair = `${c.branch}|${c.other.branch}`;
    if (asked.has(pair)) continue;
    asked.add(pair);
    const mine = works.find((w) => w.branch === c.branch);
    const path = mine?.paths.at(-1);
    if (!path) continue;
    const name = basename(path);
    const sameForm = !c.other.form || c.other.form === formOf(path);
    const join = sameForm ? "Join Them" : "Make This File the Work's File";
    const separate = sameForm ? "Keep Separate" : "Keep as a Separate Copy";
    const choice = await ask(
      "warning",
      `The history of ${name} on this computer started from a save of “${c.other.title}” made on another computer.`,
      {
        modal: true,
        detail: sameForm
          ? `Join them: fetch that work's history and continue it with ${name}, keeping both histories (nothing is lost). Or keep them as separate works.`
          : `“${c.other.title}” is kept as ${c.other.form === "highland" ? "a .highland file" : `a .${c.other.form} file`}, and ${name} is a different kind of file. Make this file the work's file: the histories are joined and continue with ${name}, recorded as a conversion. Or keep it as a separate copy.`,
      },
      join,
      separate,
    );
    if (!choice) continue;
    if (choice === separate) {
      await h.notJoin(c.branch, c.other.branch);
      continue;
    }
    if (!(await host.mirror.fetchWork(c.other.branch))) continue;
    const id = await h.join(c.id, c.other, { form: formOf(path), file: name });
    // The work's ID moves with it: into .highland files, and a plain file's Bin and Scratchpad.
    for (const p of mine?.paths ?? []) {
      if (formOf(p) === "highland" && existsSync(p)) {
        await host.store.update(p, (b) => {
          b.setInfo({ ...b.info, highwaterToo: { ...((b.info.highwaterToo as object | undefined) ?? {}), documentId: id } });
          return ["info.json"];
        });
      }
    }
    await plainExtras().moveTo(c.id, id);
    host.connector.forget(mine?.paths ?? []);
    await host.mirror.push();
    host.changed();
  }
}

/** Revert to This Save: the save's text, Bin and Scratchpad into the open document; saving records it. */
export async function revertTo(host: WorksHost, doc: vscode.TextDocument, key: string, commit: CommitInfo): Promise<void> {
  const h = host.history();
  const files = await h.filesAt(commit.hash);
  const when = commit.date.toLocaleString();
  const ok = await ask(
    "warning",
    `Go back to the save of ${when}?`,
    {
      modal: true,
      detail: "Its text replaces the document's (unsaved, so you can look before saving), and its Bin and Scratchpad replace the current ones. Saving records it as a revert; every later save stays in the history.",
    },
    "Revert to This Save",
  );
  if (ok !== "Revert to This Save") return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), files.script);
  if (!(await vscode.workspace.applyEdit(edit))) return;
  if (key.toLowerCase().endsWith(".highland")) {
    await host.store.update(key, (b) => {
      b.setBinItems(files.bin ?? []);
      if (files.scratchpad !== undefined) b.scratchpad = files.scratchpad;
      return b.paths.filter((p) => p.startsWith("bin/") || p === "scratchpad.txt");
    });
  } else {
    const folder = await plainExtras().folder(key, true);
    if (folder) {
      await folder.setBinItems(files.bin ?? []);
      if (files.scratchpad !== undefined) {
        await folder.ensureScratchpad();
        await writeFile(folder.scratchpadPath, files.scratchpad);
      }
      plainExtras().changed(key);
    }
  }
  host.connector.setNext(key, { kind: "revert", note: `to the save of ${when}` });
  await vscode.commands.executeCommand("highwater.panels.refresh");
  host.changed();
}
