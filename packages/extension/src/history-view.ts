/** The Writing History view in VS Code's sidebar (used with the text editor): the focused document's saves. */
import * as vscode from "vscode";
import type { CommitInfo } from "@highwater/history";

/** "14:03" today, else "11 Oct". */
export function when(d: Date): string {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export interface HistoryItem {
  key: string;
  commit: CommitInfo;
}

export class HistoryView implements vscode.TreeDataProvider<HistoryItem> {
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
