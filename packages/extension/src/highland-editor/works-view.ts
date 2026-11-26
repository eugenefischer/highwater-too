/**
 * The Works view's script (works-view-html.ts is its page): the Works panel of the Highwater
 * Editor's sidebar (sidebar/works.ts), on its own, so a work can be opened or restored from the
 * writing history or the mirror with no document open. The extension's side is works-view-provider.ts.
 */
import type { FromPage, ToPage } from "./messages.ts";
import { WorksPanel } from "./sidebar/works.ts";
import { installTooltips } from "./sidebar/tips.ts";
import { $, type SidebarDeps } from "./sidebar/ui.ts";

declare function acquireVsCodeApi(): { postMessage(message: FromPage): void };
const vscode = acquireVsCodeApi();
const post = (msg: FromPage) => vscode.postMessage(msg);

installTooltips();
// The panel only posts: the rest of what the editor's sidebar gives its panels is the text's.
const works = new WorksPanel({ post } as SidebarDeps);
$("wvopen").onclick = () => post({ type: "worksViewCommand", command: "highwater.open" });
$("wvnew").onclick = () => post({ type: "worksViewCommand", command: "highwater.newDocument" });

window.addEventListener("message", (e: MessageEvent<ToPage>) => {
  const msg = e.data;
  if (msg.type === "works") works.show(msg.items, msg.mirror, msg.computer, msg.reveal);
  else if (msg.type === "workSaves") works.saves(msg.i, msg.saves);
  else if (msg.type === "workRenamed") works.renamed(msg.i, msg.error);
});
post({ type: "ready" });
