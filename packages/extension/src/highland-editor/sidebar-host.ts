/**
 * The extension's side of the Highland-Style Editor's sidebar (sidebar.ts is the page's): where
 * it was left (for every document), the Navigator's kinds to list, and the Scratchpad, read from
 * and saved to the .highland file or a plain file's extras.
 */
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import * as vscode from "vscode";
import { pick } from "../ask.ts";
import { parseSave } from "../save-message.ts";
import { plainExtras } from "../extras.ts";
import { bundleOf } from "../render-document.ts";
import { extrasApi, type AssetItem, type Owner } from "../panels.ts";
import { historyApi } from "../history.ts";
import type { WorkNode } from "../works.ts";
import { assetMarkdown, binDetail, binLabel } from "../syntax/workspace.ts";
import type { BundleStore } from "../store.ts";
import { NAVIGATOR_LABELS, NAVIGATOR_TYPES, type NavigatorFilters } from "../syntax/navigator.ts";

const STATE_KEY = "highwater.sidebar";

/** What the Writing History panel's buttons and gear menu may run. */
const HISTORY_COMMANDS = new Set([
  "highwater.toggleDocumentHistory",
  "highwater.exportHistory",
  "highwater.connectToWork",
  "highwater.linkHistoryToFile",
  "highwater.setUpHistoryMirror",
  "highwater.pushHistoryNow",
  "highwater.signInHistoryMirror",
  "highwater.forgetHistoryMirrorSignIn",
  "highwater.openHistoryFolder",
  "highwater.changeHistoryLocation",
]);


/** The views the sidebar's not-yet-moved panels point to, in VS Code's sidebar. */

/** Images small enough to show in the Assets panel, by extension. */
const THUMB_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

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
  const owner = (): Owner | null => {
    const b = bundle();
    if (b) return { bundle: b };
    const p = plain();
    return p ? { plain: p } : null;
  };

  // The Bin: Highland's cards, edited in place; text dragged in from the page becomes a new one.
  const sendBin = async () => {
    const o = owner();
    const items = o && extrasApi ? await extrasApi.bin.items(o).catch(() => []) : [];
    post({ type: "bin", items: items.map((i) => ({ text: i.text, label: binLabel(i.text, 80), detail: binDetail(i.text) })), available: !!o });
  };
  const binTask = (f: (o: Owner) => Promise<unknown>) => {
    const o = owner();
    if (!o || !extrasApi) return;
    void f(o).then(
      () => sendBin(),
      (e: unknown) => {
        void vscode.window.showErrorMessage(`Could not change the Bin: ${(e as Error).message}`);
        void sendBin();
      },
    );
  };

  // Assets: the document's images, with a small picture of each; dragged into the page as references.
  let assetItems: AssetItem[] = [];
  const sendAssets = async () => {
    const o = owner();
    assetItems = o && extrasApi ? await extrasApi.assets.list(o).catch(() => []) : [];
    const items = await Promise.all(
      assetItems.map(async (a) => {
        const dot = a.name.lastIndexOf(".");
        const ext = dot > 0 ? a.name.slice(dot + 1).toLowerCase() : "";
        const info = extrasApi!.assets.info(a);
        const mime = THUMB_TYPES[ext];
        const bytes = mime ? await extrasApi!.assets.read(a) : null;
        const thumb = bytes && bytes.length <= 3 * 1024 * 1024 ? `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` : null;
        return { name: a.name, label: dot > 0 ? a.name.slice(0, dot) : a.name, detail: [ext, info?.dimensions, info?.size].filter(Boolean).join(" · "), reference: assetMarkdown(a.name, a.folder), thumb };
      }),
    );
    post({ type: "assets", items, available: !!o });
  };
  const assetTask = (f: (o: Owner) => Promise<unknown>) => {
    const o = owner();
    if (!o || !extrasApi) return;
    void f(o).then(
      () => sendAssets(),
      (e: unknown) => void vscode.window.showErrorMessage(`Could not change the assets: ${(e as Error).message}`),
    );
  };

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

  // Writing History: this document's saves, newest first, with the state of its recording and the
  // mirror for the panel's foot, and the actions for its gear menu.
  const sendHistory = async () => {
    const k = bundle() ?? plain();
    const name = k ? basename(k) : "";
    const config = vscode.workspace.getConfiguration("highwater");
    const remote = !!config.get<string>("historyRemote", "").trim();
    const mirror = historyApi?.mirror();
    const { state, commits } = historyApi && k ? await historyApi.saves(k).catch(() => ({ state: "none" as const, commits: [] })) : { state: "none" as const, commits: [] };
    const off = !config.get<boolean>("writingHistory", true);
    const note = !k
      ? "Save the document to start its writing history."
      : off
        ? "The writing history is off (highwater.writingHistory)."
        : commits.length
          ? ""
          : state === "paused"
            ? "The writing history is off for this document."
            : "No saves yet: the history starts with the next save.";
    const saves = commits.map((c) => ({ hash: c.hash, at: c.date.getTime(), ...parseSave(c.message) }));
    const menu: { label: string; command: string; sep?: boolean }[] = [
      ...(k ? [{ label: "Connect to a Work's History…", command: "highwater.connectToWork" }] : []),
      ...(plain() ? [{ label: "Link Writing History to This File", command: "highwater.linkHistoryToFile" }] : []),
      { label: remote ? "Change History Mirror…" : "Set Up History Mirror…", command: "highwater.setUpHistoryMirror", sep: !!k },
      ...(remote
        ? [
            { label: "Sync Writing History Now", command: "highwater.pushHistoryNow" },
            { label: "Sign In to History Mirror…", command: "highwater.signInHistoryMirror" },
            { label: "Forget History Mirror Sign-In", command: "highwater.forgetHistoryMirrorSignIn" },
          ]
        : []),
      { label: "Reveal Writing History Folder", command: "highwater.openHistoryFolder", sep: true },
      { label: "Change Writing History Location…", command: "highwater.changeHistoryLocation" },
    ];
    post({
      type: "history",
      title: name,
      note,
      saves,
      state: off ? "off" : state,
      document: !!k,
      mirror: remote && mirror ? { at: mirror.at?.getTime() ?? null, error: mirror.error, signIn: mirror.signIn } : null,
      menu,
    });
  };
  // Works: every work in the writing history; a work here opens, others can be restored.
  let workNodes: WorkNode[] = [];
  const saveNodes = new Map<number, WorkNode[]>();
  const sendWorks = async () => {
    if (!historyApi) return post({ type: "works", items: [] });
    workNodes = (await historyApi.works.getChildren().catch(() => [])) as WorkNode[];
    saveNodes.clear();
    const items = workNodes.map((n, i) => {
      const t = historyApi!.works.getTreeItem(n);
      return { i, title: String(typeof t.label === "string" ? t.label : (t.label?.label ?? "")), detail: String(t.description ?? ""), tip: typeof t.tooltip === "string" ? t.tooltip : "", kind: t.contextValue === "work.here" ? "here" : t.contextValue === "work.local" ? "local" : "remote" };
    });
    post({ type: "works", items });
  };
  const sendWorkSaves = async (i: number) => {
    const node = workNodes[i];
    if (!node || !historyApi) return;
    const saves = (await historyApi.works.getChildren(node).catch(() => [])) as WorkNode[];
    saveNodes.set(i, saves);
    post({
      type: "workSaves",
      i,
      saves: saves.map((n, j) => {
        const t = historyApi!.works.getTreeItem(n);
        return { j, when: String(typeof t.label === "string" ? t.label : ""), detail: String(t.description ?? ""), tip: typeof t.tooltip === "string" ? t.tooltip : "" };
      }),
    });
  };
  const workMenu = async (i: number) => {
    const node = workNodes[i];
    if (!node || !historyApi) return;
    const kind = historyApi.works.getTreeItem(node).contextValue;
    const w = historyApi.works;
    const items = [
      ...(kind === "work.here" ? [{ label: "Open", run: () => w.open(node) }] : [{ label: "Restore…", run: () => w.restore(node) }]),
      ...(kind === "work.here" || kind === "work.local" ? [{ label: "Remove from This Computer…", run: () => w.remove(node) }] : []),
      { label: "Delete Writing History…", run: () => w.delete(node) },
    ];
    const chosen = await pick(items, { title: (node as { work: { title: string } }).work.title });
    if (chosen) await chosen.run();
  };
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  const historyChanged = () => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      void sendHistory();
      void sendWorks();
    }, 200);
  };
  let historyWatch: vscode.Disposable | undefined;

  const subscriptions: vscode.Disposable[] = [
    { dispose: () => historyWatch?.dispose() },
    // The Scratchpad changed elsewhere (another window on the same file, a restored save).
    plainExtras().onDidChangeFile((events) => {
      const p = plain();
      if (p && events.some((e) => e.uri.fsPath.endsWith("scratchpad.txt"))) void sendScratchpad();
    }),
    {
      dispose: store().onExternalChange((b, entries) => {
        if (b !== bundle()) return;
        if (entries.includes("scratchpad.txt")) void sendScratchpad();
        void sendBin();
        void sendAssets();
      }),
    },
    // This extension's own writes: a Bin item cut or saved in its tab, a Revert, an image added in VS Code's sidebar.
    {
      dispose: store().onDidWrite((b, entries) => {
        if (b !== bundle()) return;
        if (entries.some((e) => e.startsWith("bin/"))) void sendBin();
        if (entries.some((e) => e.startsWith("assets/"))) void sendAssets();
      }),
    },
    plainExtras().onDidChange((p) => {
      if (p !== plain()) return;
      void sendBin();
      void sendAssets();
    }),
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
      else if (msg.type === "binAdd" && typeof msg.text === "string") {
        const text = msg.text;
        binTask((o) => extrasApi!.bin.add(text, o));
      } else if (msg.type === "binEdit" && typeof msg.index === "number" && typeof msg.text === "string") {
        const index = msg.index as number;
        const text = msg.text as string;
        binTask((o) => extrasApi!.bin.edit(o, index, text));
      } else if (msg.type === "binMove" && typeof msg.from === "number" && typeof msg.to === "number") {
        const from = msg.from as number;
        const to = msg.to as number;
        binTask((o) => extrasApi!.bin.reorder(from, to, o));
      } else if (msg.type === "binDelete" && typeof msg.index === "number") {
        const index = msg.index;
        binTask(async (o) => {
          const item = (await extrasApi!.bin.items(o))[index];
          if (item) await extrasApi!.bin.remove(item);
        });
      } else if (msg.type === "binOp" && msg.op && typeof msg.op === "object") {
        // A Bin change from the page, done or undone there (see webview.ts): add, remove or move.
        const op = msg.op as { kind: string; index?: number; text?: string; from?: number; to?: number };
        binTask(async (o) => {
          // A plain file's first Bin item: the one-time note on where it is kept; declined, the page undoes it.
          if (op.kind === "add" && o.plain !== undefined && !(await plainExtras().confirm(o.plain))) {
            post({ type: "binRefused" });
            return;
          }
          await extrasApi!.bin.change(o, (items) => {
            const next = [...items];
            if (op.kind === "add" && typeof op.text === "string") next.splice(Math.min(op.index ?? next.length, next.length), 0, op.text);
            else if (op.kind === "remove" && typeof op.text === "string") {
              // The item at that place, or else the first one with that text (the Bin changed meanwhile).
              const at = next[op.index ?? -1] === op.text ? op.index! : next.indexOf(op.text);
              if (at >= 0) next.splice(at, 1);
            } else if (op.kind === "move" && typeof op.from === "number" && typeof op.to === "number" && op.from < next.length) {
              const [item] = next.splice(op.from, 1);
              next.splice(Math.min(op.to, next.length), 0, item!);
            }
            return next;
          });
        });
      } else if (msg.type === "binTake" && typeof msg.index === "number") {
        // Dragged into the text: out of the Bin, without asking.
        const index = msg.index;
        binTask((o) => extrasApi!.bin.change(o, (items) => items.filter((_, i) => i !== index)));
      } else if (msg.type === "binExport") {
        // Highland's "Export Bin contents to a new document": a new plain-text document with every item, in
        // order, a blank line, "---" and a blank line between; the Bin keeps its items.
        const o = owner();
        if (o && extrasApi)
          void extrasApi.bin.items(o).then((items) => vscode.workspace.openTextDocument({ content: items.map((i) => i.text).join("\n\n---\n\n"), language: "plaintext" }).then((d) => vscode.window.showTextDocument(d, { preview: false })));
      } else if (msg.type === "assetsAdd") assetTask((o) => extrasApi!.assets.add(o));
      else if (msg.type === "assetsImport" && Array.isArray(msg.files)) {
        const files = (msg.files as { name: unknown; data: unknown }[]).filter((f): f is { name: string; data: Uint8Array } => typeof f.name === "string" && f.data instanceof Uint8Array);
        assetTask((o) => extrasApi!.assets.importFiles(o, files));
      } else if (msg.type === "assetDelete" && typeof msg.name === "string") {
        const item = assetItems.find((a) => a.name === msg.name);
        if (item) assetTask(() => extrasApi!.assets.remove(item));
      } else if (msg.type === "assetOpen" && typeof msg.name === "string") {
        const item = assetItems.find((a) => a.name === msg.name);
        if (item) void vscode.commands.executeCommand("highwater.assets.open", item);
      }
      else if (msg.type === "historyCompare" && typeof msg.hash === "string") {
        const k = bundle() ?? plain();
        if (k && historyApi) void historyApi.compare(k, msg.hash);
      } else if (msg.type === "historyRevert" && typeof msg.hash === "string") {
        const k = bundle() ?? plain();
        if (k && historyApi) void historyApi.revert(k, msg.hash);
      } else if (msg.type === "historyCommand" && typeof msg.command === "string" && HISTORY_COMMANDS.has(msg.command)) {
        void vscode.commands.executeCommand(msg.command).then(() => sendHistory());
      } else if (msg.type === "worksRefresh") void vscode.commands.executeCommand("highwater.works.refresh");
      else if (msg.type === "workOpen" && typeof msg.i === "number") {
        const node = workNodes[msg.i];
        if (node && historyApi) void historyApi.works.open(node);
      } else if (msg.type === "workMenu" && typeof msg.i === "number") void workMenu(msg.i);
      else if (msg.type === "workSaves" && typeof msg.i === "number") void sendWorkSaves(msg.i);
      else if (msg.type === "workSave" && typeof msg.i === "number" && typeof msg.j === "number") {
        const node = saveNodes.get(msg.i)?.[msg.j];
        if (node && historyApi) void historyApi.works.showSave(node);
      }
      else return false;
      return true;
    },
    ready() {
      post({ type: "sidebar", state: context.globalState.get(STATE_KEY) ?? {} });
      void sendFilters();
      void sendScratchpad(true);
      void sendBin();
      void sendAssets();
      historyWatch ??= historyApi?.onDidChange(historyChanged);
      void sendHistory();
      void sendWorks();
    },
    dispose() {
      for (const s of subscriptions) s.dispose();
    },
  };
}
