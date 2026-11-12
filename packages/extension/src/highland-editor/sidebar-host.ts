/**
 * The extension's side of the Highland-Style Editor's sidebar (sidebar.ts is the page's): where
 * it was left (for every document), the Navigator's kinds to list, and the Scratchpad, read from
 * and saved to the .highland file or a plain file's extras.
 */
import { writeFile } from "node:fs/promises";
import * as vscode from "vscode";
import { pick } from "../ask.ts";
import { plainExtras } from "../extras.ts";
import { bundleOf } from "../render-document.ts";
import type { BundleStore } from "../store.ts";
import { NAVIGATOR_LABELS, NAVIGATOR_TYPES, type NavigatorFilters } from "../syntax/navigator.ts";

const STATE_KEY = "highwater.sidebar";

/** The views the sidebar's not-yet-moved panels point to, in VS Code's sidebar. */
const VIEWS: Record<string, string> = { bin: "highwater.bin", assets: "highwater.assets", history: "highwater.history", works: "highwater.works" };

export interface SidebarHost {
  /** Handles a message from the page; false if it isn't the sidebar's. */
  handle(msg: { type: string } & Record<string, unknown>): boolean;
  /** The page is ready (again): send it everything. */
  ready(): void;
  dispose(): void;
}

export function sidebarHost(context: vscode.ExtensionContext, store: () => BundleStore, panel: vscode.WebviewPanel, document: () => vscode.TextDocument): SidebarHost {
  const post = (msg: object) => void panel.webview.postMessage(msg);
  const bundle = () => bundleOf(document());
  const plain = () => (!bundle() && document().uri.scheme === "file" ? document().uri.fsPath : undefined);
  const key = () => bundle() ?? plain() ?? document().uri.toString();

  const readScratchpad = async (): Promise<string> => {
    const b = bundle();
    if (b) return (await store().snapshot(b)).scratchpad ?? "";
    const p = plain();
    if (!p) return "";
    return (await (await plainExtras().folder(p))?.scratchpad()) ?? "";
  };
  const sendScratchpad = async (force = false) => post({ type: "scratchpad", text: await readScratchpad().catch(() => ""), force });

  /** Saves the Scratchpad; for a plain file's first one, after the one-time note on where it is kept. */
  const saveScratchpad = async (text: string): Promise<void> => {
    const b = bundle();
    if (b) {
      await store().update(b, (x) => ((x.scratchpad = text), ["scratchpad.txt"]));
      post({ type: "scratchpadSaved", text });
      return;
    }
    const p = plain();
    if (!p) return;
    const extras = plainExtras();
    let folder = await extras.folder(p);
    if (!folder || (await folder.scratchpad()) === undefined) {
      if (!(await extras.confirm(p))) return sendScratchpad(true);
      folder = await extras.folder(p, true);
      if (!folder) return sendScratchpad(true);
    }
    await writeFile(await folder.ensureScratchpad(), text, "utf8");
    extras.fireChanged([folder.scratchpadPath]);
    post({ type: "scratchpadSaved", text });
  };

  // Highland's per-document Navigator kinds: chosen here (as before, in the workspace), else navigatorFilters.json.
  const filtersKey = () => `navigatorFilters:${key()}`;
  const sendFilters = async () => {
    const chosen = context.workspaceState.get<NavigatorFilters>(filtersKey());
    const b = bundle();
    const json = !chosen && b ? (await store().snapshot(b).catch(() => null))?.getText("navigatorFilters.json") : undefined;
    post({ type: "navFilters", json, filters: chosen });
  };
  const chooseFilters = async () => {
    await sendFilters();
    const current = context.workspaceState.get<NavigatorFilters>(filtersKey());
    const picks = NAVIGATOR_TYPES.map((t) => ({ label: NAVIGATOR_LABELS[t], type: t, picked: current ? current[t] : true }));
    const chosen = await pick(picks, { canPickMany: true, title: "Show in the Navigator" });
    if (!chosen) return;
    await context.workspaceState.update(filtersKey(), Object.fromEntries(NAVIGATOR_TYPES.map((t) => [t, chosen.some((c) => c.type === t)])));
    await sendFilters();
  };

  const subscriptions: vscode.Disposable[] = [
    // The Scratchpad changed elsewhere (another window on the same file, a restored save).
    plainExtras().onDidChangeFile((events) => {
      const p = plain();
      if (p && events.some((e) => e.uri.fsPath.endsWith("scratchpad.txt"))) void sendScratchpad();
    }),
    { dispose: store().onExternalChange((b, entries) => b === bundle() && entries.includes("scratchpad.txt") && void sendScratchpad()) },
  ];

  return {
    handle(msg) {
      if (msg.type === "sidebarState") void context.globalState.update(STATE_KEY, msg.state);
      else if (msg.type === "scratchpadSave" && typeof msg.text === "string") {
        void saveScratchpad(msg.text).catch((e: unknown) => void vscode.window.showErrorMessage(`Could not save the Scratchpad: ${(e as Error).message}`));
      } else if (msg.type === "scratchpadExport" && typeof msg.text === "string") {
        // Highland: "Export Scratchpad contents to a new document": an untitled one in the same language.
        void vscode.workspace.openTextDocument({ content: msg.text, language: document().languageId }).then((d) => vscode.window.showTextDocument(d, { preview: false }));
      } else if (msg.type === "navTypes") void chooseFilters();
      else if (msg.type === "showView" && typeof msg.view === "string" && VIEWS[msg.view]) void vscode.commands.executeCommand(`${VIEWS[msg.view]}.focus`);
      else return false;
      return true;
    },
    ready() {
      post({ type: "sidebar", state: context.globalState.get(STATE_KEY) ?? {} });
      void sendFilters();
      void sendScratchpad(true);
    },
    dispose() {
      for (const s of subscriptions) s.dispose();
    },
  };
}
