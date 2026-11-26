/**
 * The extension's side of the Works panel: every work in the writing history, listed for the page,
 * and what the panel's buttons do. The Highwater Editor's sidebar (sidebar-host.ts) and the Works
 * view in VS Code's own sidebar (works-view-provider.ts) each have one.
 */
import { basename } from "node:path";
import * as vscode from "vscode";
import { computerName } from "@highwater/history";
import { parseSave } from "../save-message.ts";
import { historyApi } from "../history.ts";
import type { WorkNode } from "../works.ts";
import { debounce } from "../debounce.ts";
import type { FromPage, ToPage, WorkRow, WorkSaveRow } from "./messages.ts";

/** What the Works panel's More menu calls showing a work's file, as VS Code names it on each system. */
const REVEAL_LABEL = process.platform === "darwin" ? "Reveal in Finder" : process.platform === "win32" ? "Reveal in File Explorer" : "Reveal in File Manager";

export interface WorksHost {
  /** Handles a message from the page; false if it isn't the Works panel's. */
  handle(msg: FromPage): boolean;
  /** Sends the works (again), and from now on whenever the writing history changes. */
  ready(): void;
  dispose(): void;
}

export function worksHost(post: (msg: ToPage) => void): WorksHost {
  let workNodes: WorkNode[] = [];
  const sendWorks = async () => {
    const remote = !!vscode.workspace.getConfiguration("highwater").get<string>("historyRemote", "").trim();
    const m = historyApi?.mirror();
    const mirror = remote && m ? { busy: m.busy, at: m.at?.getTime() ?? null, error: m.error, signIn: m.signIn } : null;
    if (!historyApi) return post({ type: "works", items: [], mirror, computer: computerName(), reveal: REVEAL_LABEL });
    workNodes = (await historyApi.works.getChildren().catch(() => [])) as WorkNode[];
    const items = workNodes.map((n, i): WorkRow => {
      const w = n.work;
      const words = w.latest ? parseSave(w.latest.message).words : "";
      return {
        i,
        title: w.title,
        file: n.here ? basename(n.here) : (w.file ?? ""),
        at: w.lastSave?.getTime() ?? null,
        words,
        kind: n.here ? "here" : w.local ? "local" : "remote",
      };
    });
    post({ type: "works", items, mirror, computer: computerName(), reveal: REVEAL_LABEL });
  };
  const sendWorkSaves = async (i: number) => {
    const node = workNodes[i];
    if (!node || !historyApi) return;
    const saves = (await historyApi.works.getChildren(node).catch(() => [])) as WorkNode[];
    post({
      type: "workSaves",
      i,
      saves: saves.map((n) => (n.kind === "save" ? { at: n.commit.date.getTime(), ...parseSave(n.commit.message) } : null)).filter((s): s is WorkSaveRow => s !== null),
    });
  };
  const workAction = async (i: number, action: string) => {
    const node = workNodes[i];
    if (!node || !historyApi) return;
    const w = historyApi.works;
    if (action === "open") await w.open(node);
    else if (action === "restore") await w.restore(node);
    else if (action === "remove") await w.remove(node);
    else if (action === "delete") await w.delete(node);
    else if (action === "reveal" && node.here) await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(node.here));
  };
  const changed = debounce(200, () => void sendWorks());
  let watch: vscode.Disposable | undefined;

  return {
    handle(msg) {
      if (msg.type === "worksRefresh") void vscode.commands.executeCommand("highwater.works.refresh");
      else if (msg.type === "workAction" && typeof msg.i === "number" && typeof msg.action === "string") void workAction(msg.i, msg.action);
      else if (msg.type === "workSaves" && typeof msg.i === "number") void sendWorkSaves(msg.i);
      else if (msg.type === "workRename" && typeof msg.i === "number" && typeof msg.title === "string") {
        const node = workNodes[msg.i];
        const i = msg.i;
        const file = typeof msg.file === "string" ? msg.file : undefined;
        if (node && historyApi) void historyApi.works.rename(node, msg.title, file).then((error) => post({ type: "workRenamed", i, ...(error ? { error } : {}) }));
      } else return false;
      return true;
    },
    ready() {
      watch ??= historyApi?.onDidChange(changed);
      void sendWorks();
    },
    dispose() {
      changed.cancel();
      watch?.dispose();
    },
  };
}
