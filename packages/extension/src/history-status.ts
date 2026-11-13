import { basename } from "node:path";
import type { CommitInfo } from "@highwater/history";
import * as vscode from "vscode";
import type { Connector } from "./connect.ts";
import type { HistoryMirror } from "./mirror.ts";

/** "14:03" today, else "11 Oct". */
function when(d: Date): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** The writing history's status-bar item: the focused document's last recorded save, or what needs doing. */
export function historyStatus(deps: {
  key: () => string | null;
  enabled: () => boolean;
  connector: Connector;
  mirror: HistoryMirror;
  failures: Map<string, string>;
  lastCommit: Map<string, Date>;
  latest: (key: string) => Promise<CommitInfo | undefined>;
}) {
  const { enabled, connector, mirror, failures, lastCommit, latest } = deps;
  const status = vscode.window.createStatusBarItem("highwater.history", vscode.StatusBarAlignment.Left, 0);
  status.name = "Highwater Too: writing history";
  status.command = "highwater.showHistory";

  async function updateStatus(): Promise<void> {
    const key = deps.key();
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

  return { item: status, update: updateStatus };
}
