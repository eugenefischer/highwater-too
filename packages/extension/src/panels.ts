import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import * as vscode from "vscode";
import { HighlandFileSystem, SCHEME, toHighlandUri } from "./fs-provider.ts";
import type { ParseCache } from "./language.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { NAVIGATOR_LABELS, NAVIGATOR_TYPES, navigatorItems, parseFilters, type NavigatorFilters, type NavigatorItem, type NavigatorType } from "./syntax/navigator.ts";
import { assetMarkdown, binLabel, move, uniqueName } from "./syntax/workspace.ts";

/**
 * The Highland sidebar (M6): Navigator, Bin and Assets as tree views in a "Highwater Too" view
 * container, the Scratchpad as an editor tab. They follow the last active Highland editor.
 */
export function registerPanels(context: vscode.ExtensionContext, store: BundleStore, fs: HighlandFileSystem, cache: ParseCache): void {
  const current = new CurrentDocument();
  const navigator = new NavigatorView(context, store, cache, current);
  const bin = new BinView(store, fs, current);
  const assets = new AssetsView(store, current);

  const binTree = vscode.window.createTreeView("highwater.bin", { treeDataProvider: bin, dragAndDropController: bin, canSelectMany: false });
  const assetTree = vscode.window.createTreeView("highwater.assets", { treeDataProvider: assets, dragAndDropController: assets });
  const navTree = vscode.window.createTreeView("highwater.navigator", { treeDataProvider: navigator, showCollapseAll: true });

  const refreshAll = () => {
    navigator.refresh();
    bin.refresh();
    assets.refresh();
    navTree.description = current.script ? basename(current.label) : "";
  };
  current.onDidChange(refreshAll);

  let timer: NodeJS.Timeout | undefined;
  /** Scripts the sidebar has been shown for since they were opened. */
  const shown = new Set<string>();
  context.subscriptions.push(
    binTree,
    assetTree,
    navTree,
    current,
    vscode.window.onDidChangeActiveTextEditor((e) => {
      current.follow(e?.document);
      void showSidebar(e);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document !== current.script) return;
      clearTimeout(timer);
      timer = setTimeout(() => navigator.refresh(), 250);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      current.closed(d);
      shown.delete(d.uri.toString());
    }),
    { dispose: store.onExternalChange((path) => (path === current.bundle ? refreshAll() : undefined)) },

    vscode.commands.registerCommand("highwater.navigator.reveal", (uri: vscode.Uri, offset: number) => reveal(uri, offset)),
    vscode.commands.registerCommand("highwater.navigator.filter", () => navigator.chooseFilters()),

    vscode.commands.registerCommand("highwater.copyToBin", () => toBin(false)),
    vscode.commands.registerCommand("highwater.cutToBin", () => toBin(true)),
    vscode.commands.registerCommand("highwater.bin.new", () => bin.add("")),
    vscode.commands.registerCommand("highwater.bin.open", (item: BinItem) => bin.open(item)),
    vscode.commands.registerCommand("highwater.bin.insert", (item: BinItem) => insertText(current, item.text)),
    vscode.commands.registerCommand("highwater.bin.moveUp", (item: BinItem) => bin.reorder(item.index, item.index - 1)),
    vscode.commands.registerCommand("highwater.bin.moveDown", (item: BinItem) => bin.reorder(item.index, item.index + 1)),
    vscode.commands.registerCommand("highwater.bin.delete", (item: BinItem) => bin.remove(item)),

    vscode.commands.registerCommand("highwater.assets.add", () => assets.add()),
    vscode.commands.registerCommand("highwater.assets.insert", (item: AssetItem) => insertText(current, assetMarkdown(item.name))),
    vscode.commands.registerCommand("highwater.assets.open", (item: AssetItem) => vscode.commands.executeCommand("vscode.open", toHighlandUri(item.bundle, `assets/${item.name}`))),
    vscode.commands.registerCommand("highwater.assets.delete", (item: AssetItem) => assets.remove(item)),

    vscode.commands.registerCommand("highwater.openScratchpad", () => openScratchpad(store, current)),
  );
  for (const e of [vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors]) if (e) current.follow(e.document);
  void showSidebar(vscode.window.activeTextEditor);

  /**
   * Opening a Highland script switches the sidebar to Highwater Too, once per opening, then hands
   * the keyboard back to the editor. Setting highwater.showSidebarOnOpen turns this off.
   */
  async function showSidebar(editor: vscode.TextEditor | undefined): Promise<void> {
    const doc = editor?.document;
    if (!doc || !doc.languageId.startsWith("highland-")) return;
    const parts = doc.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
    if (parts && parts.entry !== "") return; // Bin items and the Scratchpad
    const key = doc.uri.toString();
    if (shown.has(key)) return;
    shown.add(key);
    if (!vscode.workspace.getConfiguration("highwater").get<boolean>("showSidebarOnOpen", true)) return;
    await vscode.commands.executeCommand("workbench.view.extension.highwater");
    await vscode.window.showTextDocument(doc, { ...(editor.viewColumn ? { viewColumn: editor.viewColumn } : {}), preserveFocus: false });
  }

  async function toBin(cut: boolean): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const bundle = editor ? splitBundlePath(editor.document.uri.fsPath)?.bundle : undefined;
    if (!editor || editor.document.uri.scheme !== SCHEME || !bundle) {
      void vscode.window.showInformationMessage("The Bin is kept inside .highland files; open one to use it.");
      return;
    }
    const ranges = editor.selections.filter((s) => !s.isEmpty);
    if (!ranges.length) return;
    const text = ranges.map((r) => editor.document.getText(r)).join("\n\n");
    await bin.add(text, bundle);
    if (cut) await editor.edit((e) => ranges.forEach((r) => e.delete(r)));
  }
}

/** The Highland script (and its bundle, if any) the panels show. */
class CurrentDocument implements vscode.Disposable {
  script: vscode.TextDocument | undefined;
  bundle: string | undefined;
  readonly #emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#emitter.event;

  get label(): string {
    return this.bundle ?? this.script?.uri.fsPath ?? "";
  }

  follow(doc: vscode.TextDocument | undefined): void {
    if (!doc || !doc.languageId.startsWith("highland-")) return;
    const parts = doc.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
    // A Bin item or the Scratchpad keeps its bundle's script in view.
    if (parts && parts.entry !== "") {
      if (parts.bundle === this.bundle) return;
      const script = vscode.workspace.textDocuments.find((d) => d.uri.toString() === toHighlandUri(parts.bundle).toString());
      this.set(script, parts.bundle);
      return;
    }
    if (doc === this.script) return;
    this.set(doc, parts?.bundle);
  }

  closed(doc: vscode.TextDocument): void {
    if (doc === this.script) this.set(undefined, this.bundle);
  }

  private set(script: vscode.TextDocument | undefined, bundle: string | undefined): void {
    this.script = script;
    this.bundle = bundle;
    void vscode.commands.executeCommand("setContext", "highwater.inBundle", bundle !== undefined);
    void vscode.commands.executeCommand("setContext", "highwater.hasDocument", script !== undefined || bundle !== undefined);
    this.#emitter.fire();
  }

  dispose(): void {
    this.#emitter.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Navigator

const ICONS: Record<NavigatorType, string> = {
  sceneHeaders: "device-camera-video",
  sectionHeaders: "symbol-namespace",
  synopses: "note",
  notes: "comment",
  images: "file-media",
  links: "link",
  referenceLinks: "references",
  includedFiles: "file-symlink-file",
  markers: "bookmark",
};

class NavigatorView implements vscode.TreeDataProvider<NavigatorItem> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  #filters: NavigatorFilters = parseFilters(undefined);

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: BundleStore,
    private readonly cache: ParseCache,
    private readonly current: CurrentDocument,
  ) {}

  refresh(): void {
    void this.#loadFilters().then(() => this.#changed.fire());
  }

  getTreeItem(item: NavigatorItem): vscode.TreeItem {
    const t = new vscode.TreeItem(item.label, item.children.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    t.iconPath = new vscode.ThemeIcon(ICONS[item.type]);
    t.tooltip = `${NAVIGATOR_LABELS[item.type]}: ${item.label}`;
    const doc = this.current.script;
    if (doc) t.command = { command: "highwater.navigator.reveal", title: "Go to", arguments: [doc.uri, item.span.start] };
    return t;
  }

  getChildren(item?: NavigatorItem): NavigatorItem[] {
    if (item) return item.children;
    const doc = this.current.script;
    return doc ? navigatorItems(this.cache.get(doc), this.#filters) : [];
  }

  /** Highland's per-document type toggles: from navigatorFilters.json, changed here per document. */
  async chooseFilters(): Promise<void> {
    await this.#loadFilters();
    const picks = NAVIGATOR_TYPES.map((t) => ({ label: NAVIGATOR_LABELS[t], type: t, picked: this.#filters[t] }));
    const chosen = await vscode.window.showQuickPick(picks, { canPickMany: true, title: "Show in the Navigator" });
    if (!chosen) return;
    const filters = Object.fromEntries(NAVIGATOR_TYPES.map((t) => [t, chosen.some((c) => c.type === t)])) as NavigatorFilters;
    await this.context.workspaceState.update(this.#key(), filters);
    this.refresh();
  }

  #key(): string {
    return `navigatorFilters:${this.current.label}`;
  }

  async #loadFilters(): Promise<void> {
    const saved = this.context.workspaceState.get<NavigatorFilters>(this.#key());
    if (saved) {
      this.#filters = { ...parseFilters(undefined), ...saved };
      return;
    }
    let json: string | undefined;
    if (this.current.bundle) json = (await this.store.snapshot(this.current.bundle).catch(() => null))?.getText("navigatorFilters.json");
    this.#filters = parseFilters(json);
  }
}

async function reveal(uri: vscode.Uri, offset: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
  const pos = doc.positionAt(offset);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
}

// ---------------------------------------------------------------------------------------------
// Bin

interface BinItem {
  bundle: string;
  index: number;
  text: string;
}

const BIN_MIME = "application/vnd.code.tree.highwater.bin";

class BinView implements vscode.TreeDataProvider<BinItem>, vscode.TreeDragAndDropController<BinItem> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly dragMimeTypes = [BIN_MIME, "text/plain"];
  readonly dropMimeTypes = [BIN_MIME, "text/plain"];

  constructor(
    private readonly store: BundleStore,
    private readonly fs: HighlandFileSystem,
    private readonly current: CurrentDocument,
  ) {}

  refresh(): void {
    this.#changed.fire();
  }

  getTreeItem(item: BinItem): vscode.TreeItem {
    const t = new vscode.TreeItem(binLabel(item.text));
    t.tooltip = item.text.length > 600 ? `${item.text.slice(0, 600)}…` : item.text;
    t.contextValue = "binItem";
    t.iconPath = new vscode.ThemeIcon("note");
    t.command = { command: "highwater.bin.open", title: "Open", arguments: [item] };
    return t;
  }

  async getChildren(item?: BinItem): Promise<BinItem[]> {
    const bundle = this.current.bundle;
    if (item || !bundle) return [];
    const snap = await this.store.snapshot(bundle).catch(() => null);
    return (snap?.binItems ?? []).map((text, index) => ({ bundle, index, text }));
  }

  async open(item: BinItem): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(toHighlandUri(item.bundle, `bin/${item.index}.txt`));
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  /** Adds a Bin item at the end (Highland's ⌥⌘C / ⌥⌘X). */
  async add(text: string, bundle = this.current.bundle): Promise<void> {
    if (!bundle) return;
    await this.#change(bundle, (items) => [...items, text]);
  }

  async reorder(from: number, to: number): Promise<void> {
    const bundle = this.current.bundle;
    if (!bundle || to < 0) return;
    await this.#change(bundle, (items) => (to >= items.length ? items : move(items, from, to)));
  }

  async remove(item: BinItem): Promise<void> {
    const ok = await vscode.window.showWarningMessage(`Delete the Bin item “${binLabel(item.text, 40)}”?`, { modal: true }, "Delete");
    if (ok !== "Delete") return;
    await this.#change(item.bundle, (items) => items.filter((_, i) => i !== item.index));
  }

  handleDrag(source: readonly BinItem[], data: vscode.DataTransfer): void {
    const item = source[0];
    if (!item) return;
    data.set(BIN_MIME, new vscode.DataTransferItem(item.index));
    data.set("text/plain", new vscode.DataTransferItem(item.text));
  }

  async handleDrop(target: BinItem | undefined, data: vscode.DataTransfer): Promise<void> {
    const own = data.get(BIN_MIME);
    if (own) {
      const from = Number(own.value);
      const to = target ? target.index : Number.MAX_SAFE_INTEGER;
      await this.reorder(from, to);
      return;
    }
    // Text dragged in from an editor becomes a new item.
    const text = await data.get("text/plain")?.asString();
    if (text) await this.add(text);
  }

  async #change(bundle: string, f: (items: string[]) => string[]): Promise<void> {
    const before = (await this.store.snapshot(bundle)).binItems.length;
    await this.store.update(bundle, (b) => {
      b.setBinItems(f(b.binItems));
      return b.paths.filter((p) => p.startsWith("bin/"));
    });
    const after = (await this.store.snapshot(bundle)).binItems.length;
    // Items are renumbered: let open item tabs reload.
    this.fs.fireChanged(bundle, Array.from({ length: Math.max(before, after) }, (_, i) => `bin/${i}.txt`));
    this.refresh();
  }
}

// ---------------------------------------------------------------------------------------------
// Assets

interface AssetItem {
  bundle: string;
  name: string;
}

const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "heic", "webp", "pdf"];

class AssetsView implements vscode.TreeDataProvider<AssetItem>, vscode.TreeDragAndDropController<AssetItem> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly dragMimeTypes = ["text/plain"];
  readonly dropMimeTypes = ["text/uri-list"];

  constructor(
    private readonly store: BundleStore,
    private readonly current: CurrentDocument,
  ) {}

  refresh(): void {
    this.#changed.fire();
  }

  getTreeItem(item: AssetItem): vscode.TreeItem {
    const t = new vscode.TreeItem(item.name);
    t.contextValue = "asset";
    t.resourceUri = toHighlandUri(item.bundle, `assets/${item.name}`);
    t.tooltip = `${item.name}\nDrag into the text, or right-click to insert.`;
    t.command = { command: "highwater.assets.open", title: "Open", arguments: [item] };
    return t;
  }

  async getChildren(item?: AssetItem): Promise<AssetItem[]> {
    const bundle = this.current.bundle;
    if (item || !bundle) return [];
    const snap = await this.store.snapshot(bundle).catch(() => null);
    const names = (snap?.paths ?? []).filter((p) => p.startsWith("assets/") && !p.endsWith("/")).map((p) => p.slice("assets/".length));
    return names.sort((a, b) => a.localeCompare(b)).map((name) => ({ bundle, name }));
  }

  handleDrag(source: readonly AssetItem[], data: vscode.DataTransfer): void {
    data.set("text/plain", new vscode.DataTransferItem(source.map((a) => assetMarkdown(a.name)).join("\n\n")));
  }

  /** Files dropped from Finder or the Explorer are copied into the bundle. */
  async handleDrop(_target: AssetItem | undefined, data: vscode.DataTransfer): Promise<void> {
    const list = await data.get("text/uri-list")?.asString();
    const uris = (list ?? "")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => vscode.Uri.parse(l))
      .filter((u) => u.scheme === "file");
    await this.#import(uris);
  }

  async add(): Promise<void> {
    if (!this.current.bundle) {
      void vscode.window.showInformationMessage("Assets are kept inside .highland files; open one to add images.");
      return;
    }
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Images: IMAGE_TYPES }, title: "Add to Assets" });
    if (uris) await this.#import(uris);
  }

  async remove(item: AssetItem): Promise<void> {
    const ok = await vscode.window.showWarningMessage(`Delete ${item.name} from this document's assets?`, { modal: true, detail: "Images in the text that use it will no longer print." }, "Delete");
    if (ok !== "Delete") return;
    await this.store.update(item.bundle, (b) => (b.delete(`assets/${item.name}`) ? [`assets/${item.name}`] : []));
    this.refresh();
  }

  async #import(uris: vscode.Uri[]): Promise<void> {
    const bundle = this.current.bundle;
    if (!bundle || !uris.length) return;
    const files = await Promise.all(uris.map(async (u) => ({ name: basename(u.fsPath), data: new Uint8Array(await readFile(u.fsPath)) })));
    await this.store.update(bundle, (b) => {
      const taken = b.paths.filter((p) => p.startsWith("assets/")).map((p) => p.slice(7));
      return files.map((f) => {
        const name = uniqueName(f.name, taken);
        taken.push(name);
        b.set(`assets/${name}`, f.data);
        return `assets/${name}`;
      });
    });
    this.refresh();
  }
}

// ---------------------------------------------------------------------------------------------

async function insertText(current: CurrentDocument, text: string): Promise<void> {
  const doc = current.script;
  if (!doc) return;
  const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc) ?? (await vscode.window.showTextDocument(doc));
  await editor.edit((e) => e.replace(editor.selection, text));
  await vscode.window.showTextDocument(editor.document, editor.viewColumn);
}

async function openScratchpad(store: BundleStore, current: CurrentDocument): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const bundle = (editor?.document.uri.scheme === SCHEME ? splitBundlePath(editor.document.uri.fsPath)?.bundle : undefined) ?? current.bundle;
  if (!bundle) {
    void vscode.window.showInformationMessage("The Scratchpad is kept inside .highland files; open one to use it.");
    return;
  }
  const snap = await store.snapshot(bundle);
  if (snap.scratchpad === undefined) await store.update(bundle, (b) => ((b.scratchpad = ""), ["scratchpad.txt"]));
  const doc = await vscode.workspace.openTextDocument(toHighlandUri(bundle, "scratchpad.txt"));
  await vscode.window.showTextDocument(doc, { preview: false });
}
