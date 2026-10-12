import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import * as vscode from "vscode";
import { HighlandFileSystem, SCHEME, toHighlandUri } from "./fs-provider.ts";
import type { ParseCache } from "./language.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { EXTRAS_SCHEME, plainExtras } from "./extras.ts";
import { blockAt, moveBlock, NAVIGATOR_LABELS, NAVIGATOR_TYPES, navigatorItems, parseFilters, type NavigatorFilters, type NavigatorItem, type NavigatorType } from "./syntax/navigator.ts";
import { assetMarkdown, binLabel, move, uniqueName } from "./syntax/workspace.ts";
import { idNote, noteId } from "./extras-folder.ts";

/**
 * The Highland sidebar (M6): Navigator, Bin and Assets as tree views in a "Highwater Too" view
 * container, the Scratchpad as an editor tab. They follow the last active Highland editor. A
 * .highland file keeps its Bin, Scratchpad and images inside it; a plain .fountain or .md file
 * keeps them with the writing history and in a folder beside it (see PlainExtras).
 */
export function registerPanels(context: vscode.ExtensionContext, store: BundleStore, fs: HighlandFileSystem, cache: ParseCache): void {
  const current = new CurrentDocument();
  const navigator = new NavigatorView(context, store, cache, current);
  const bin = new BinView(store, fs, current);
  const assets = new AssetsView(store, current);

  const binTree = vscode.window.createTreeView("highwater.bin", { treeDataProvider: bin, dragAndDropController: bin, canSelectMany: false });
  const assetTree = vscode.window.createTreeView("highwater.assets", { treeDataProvider: assets, dragAndDropController: assets });
  const navTree = vscode.window.createTreeView("highwater.navigator", { treeDataProvider: navigator, dragAndDropController: navigator, showCollapseAll: true });

  const refreshAll = () => {
    navigator.refresh();
    bin.refresh();
    assets.refresh();
    navTree.description = current.script ? basename(current.label) : "";
  };
  current.onDidChange(refreshAll);
  const extras = plainExtras();

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
    extras.onDidChange((path) => {
      if (path !== current.plain) return;
      bin.refresh();
      assets.refresh();
    }),

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
    vscode.commands.registerCommand("highwater.assets.open", (item: AssetItem) => vscode.commands.executeCommand("vscode.open", assetUri(item))),
    vscode.commands.registerCommand("highwater.assets.insert", (item: AssetItem) => insertText(current, assetMarkdown(item.name, item.folder))),
    vscode.commands.registerCommand("highwater.assets.delete", (item: AssetItem) => assets.remove(item)),

    vscode.commands.registerCommand("highwater.openScratchpad", () => openScratchpad(store, current)),
    vscode.commands.registerCommand("highwater.linkHistoryToFile", () => linkHistoryToFile()),
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
    const bundle = editor && editor.document.uri.scheme === SCHEME ? splitBundlePath(editor.document.uri.fsPath)?.bundle : undefined;
    const plain = editor && extras.isPlain(editor.document) ? editor.document.uri.fsPath : undefined;
    if (!editor || (!bundle && !plain)) {
      void vscode.window.showInformationMessage("Open a document to use the Bin.");
      return;
    }
    const ranges = editor.selections.filter((s) => !s.isEmpty);
    if (!ranges.length) return;
    const text = ranges.map((r) => editor.document.getText(r)).join("\n\n");
    if (!(await bin.add(text, bundle ? { bundle } : { plain: plain! }))) return;
    if (cut) await editor.edit((e) => ranges.forEach((r) => e.delete(r)));
  }

  /** Writes the ID note into a plain file, so its history and extras follow it if it moves. */
  async function linkHistoryToFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const doc = editor?.document;
    if (!editor || !doc || !extras.isPlain(doc)) {
      void vscode.window.showInformationMessage("Open a .fountain or .md file to link it to its writing history. A .highland file is linked already.");
      return;
    }
    if (noteId(doc.getText())) {
      void vscode.window.showInformationMessage(`${basename(doc.uri.fsPath)} is linked to its writing history already.`);
      return;
    }
    const id = await extras.documentId(doc.uri.fsPath);
    if (!id) {
      void vscode.window.showInformationMessage("Turn the writing history on to link a file to it.");
      return;
    }
    const text = doc.getText();
    const end = doc.positionAt(text.length);
    const sep = text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    await editor.edit((e) => e.insert(end, `${sep}${idNote(id)}\n`));
    void vscode.window.showInformationMessage(
      "Added a note at the end of the file naming its writing history, so its history, Bin and Scratchpad stay with it if it is moved or renamed. Notes never print.",
    );
  }
}

/** The Highland script (and its bundle, or its path for a plain file) the panels show. */
class CurrentDocument implements vscode.Disposable {
  script: vscode.TextDocument | undefined;
  bundle: string | undefined;
  /** A plain .fountain or .md file's path. */
  plain: string | undefined;
  readonly #emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#emitter.event;

  get label(): string {
    return this.bundle ?? this.plain ?? this.script?.uri.fsPath ?? "";
  }

  follow(doc: vscode.TextDocument | undefined): void {
    if (!doc) return;
    // A plain file's Bin item or Scratchpad keeps the file in view.
    if (doc.uri.scheme === EXTRAS_SCHEME) {
      const owner = plainExtras().ownerOf(doc.uri);
      if (!owner || owner === this.plain) return;
      this.set(vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && d.uri.fsPath === owner), undefined, owner);
      return;
    }
    if (!doc.languageId.startsWith("highland-")) return;
    const parts = doc.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
    // A Bin item or the Scratchpad keeps its bundle's script in view.
    if (parts && parts.entry !== "") {
      if (parts.bundle === this.bundle) return;
      const script = vscode.workspace.textDocuments.find((d) => d.uri.toString() === toHighlandUri(parts.bundle).toString());
      this.set(script, parts.bundle);
      return;
    }
    if (doc === this.script) return;
    const plain = parts ? undefined : doc.uri.scheme === "file" ? doc.uri.fsPath : undefined;
    this.set(doc, parts?.bundle, plain);
    // Bin and Scratchpad saved on another computer.
    if (plain) void plainExtras().bringIn(plain).catch(() => false);
  }

  closed(doc: vscode.TextDocument): void {
    if (doc === this.script) this.set(undefined, this.bundle, this.plain);
  }

  private set(script: vscode.TextDocument | undefined, bundle: string | undefined, plain?: string): void {
    this.script = script;
    this.bundle = bundle;
    this.plain = bundle ? undefined : plain;
    void vscode.commands.executeCommand("setContext", "highwater.inBundle", bundle !== undefined);
    void vscode.commands.executeCommand("setContext", "highwater.hasExtras", bundle !== undefined || this.plain !== undefined);
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

const NAV_MIME = "application/vnd.code.tree.highwater.navigator";

class NavigatorView implements vscode.TreeDataProvider<NavigatorItem>, vscode.TreeDragAndDropController<NavigatorItem> {
  readonly dragMimeTypes = [NAV_MIME];
  readonly dropMimeTypes = [NAV_MIME];
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

  /** Scenes, sections and headings drag to a new place: dropped on another, they move before it. */
  handleDrag(items: readonly NavigatorItem[], data: vscode.DataTransfer): void {
    const item = items.find((i) => i.type === "sceneHeaders" || i.type === "sectionHeaders");
    if (item) data.set(NAV_MIME, new vscode.DataTransferItem(item.span.start));
  }

  async handleDrop(target: NavigatorItem | undefined, data: vscode.DataTransfer): Promise<void> {
    const doc = this.current.script;
    const from = data.get(NAV_MIME)?.value as number | undefined;
    if (!doc || from === undefined) return;
    if (target && target.type !== "sceneHeaders" && target.type !== "sectionHeaders") return;
    const parsed = this.cache.get(doc);
    const block = blockAt(parsed, from);
    const move = block && moveBlock(parsed.source, block, target ? target.span.start : null);
    if (!move) return;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.positionAt(move.insert.at), move.insert.text);
    edit.delete(doc.uri, new vscode.Range(doc.positionAt(move.delete.start), doc.positionAt(move.delete.end)));
    await vscode.workspace.applyEdit(edit);
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

/** Whose Bin: a .highland file's, or a plain file's. */
type Owner = { bundle: string; plain?: undefined } | { plain: string; bundle?: undefined };

type BinItem = Owner & {
  index: number;
  text: string;
};

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
    if (item) return [];
    const { bundle, plain } = this.current;
    if (bundle) {
      const snap = await this.store.snapshot(bundle).catch(() => null);
      return (snap?.binItems ?? []).map((text, index) => ({ bundle, index, text }));
    }
    if (plain) {
      const folder = await plainExtras().folder(plain).catch(() => null);
      return ((await folder?.binItems()) ?? []).map((text, index) => ({ plain, index, text }));
    }
    return [];
  }

  async open(item: BinItem): Promise<void> {
    let uri: vscode.Uri;
    if (item.bundle !== undefined) uri = toHighlandUri(item.bundle, `bin/${item.index}.txt`);
    else {
      const folder = await plainExtras().folder(item.plain);
      if (!folder) return;
      uri = plainExtras().uri(folder.binPath(item.index));
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  #owner(): Owner | null {
    if (this.current.bundle) return { bundle: this.current.bundle };
    if (this.current.plain) return { plain: this.current.plain };
    return null;
  }

  /** Adds a Bin item at the end (Highland's ⌥⌘C / ⌥⌘X). False if nothing was added. */
  async add(text: string, owner = this.#owner()): Promise<boolean> {
    if (!owner) return false;
    if (owner.plain !== undefined && !(await plainExtras().confirm(owner.plain))) return false;
    await this.#change(owner, (items) => [...items, text]);
    return true;
  }

  async reorder(from: number, to: number): Promise<void> {
    const owner = this.#owner();
    if (!owner || to < 0) return;
    await this.#change(owner, (items) => (to >= items.length ? items : move(items, from, to)));
  }

  async remove(item: BinItem): Promise<void> {
    const ok = await vscode.window.showWarningMessage(`Delete the Bin item “${binLabel(item.text, 40)}”?`, { modal: true }, "Delete");
    if (ok !== "Delete") return;
    await this.#change(item, (items) => items.filter((_, i) => i !== item.index));
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

  async #change(owner: Owner, f: (items: string[]) => string[]): Promise<void> {
    if (owner.plain !== undefined) {
      const extras = plainExtras();
      const folder = await extras.folder(owner.plain, true);
      if (!folder) return;
      const items = f(await folder.binItems());
      const before = await folder.setBinItems(items);
      extras.fireChanged(Array.from({ length: Math.max(before, items.length) }, (_, i) => folder.binPath(i)));
      extras.changed(owner.plain);
      return;
    }
    const bundle = owner.bundle;
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

type AssetItem = Owner & {
  name: string;
  /** The folder the text refers to it in: "assets", or a plain file's "<name> assets". */
  folder: string;
  /** A plain file's image, on disk. */
  file?: string;
};

function assetUri(item: AssetItem): vscode.Uri {
  return item.file ? vscode.Uri.file(item.file) : toHighlandUri(item.bundle!, `assets/${item.name}`);
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
    t.resourceUri = assetUri(item);
    t.tooltip = `${item.name}\nDrag into the text, or right-click to insert.`;
    t.command = { command: "highwater.assets.open", title: "Open", arguments: [item] };
    return t;
  }

  async getChildren(item?: AssetItem): Promise<AssetItem[]> {
    if (item) return [];
    const { bundle, plain } = this.current;
    if (bundle) {
      const snap = await this.store.snapshot(bundle).catch(() => null);
      const names = (snap?.paths ?? []).filter((p) => p.startsWith("assets/") && !p.endsWith("/")).map((p) => p.slice("assets/".length));
      return names.sort((a, b) => a.localeCompare(b)).map((name) => ({ bundle, name, folder: "assets" }));
    }
    if (plain) {
      const extras = plainExtras();
      const { name: folder, dir } = await extras.assetsFolder(plain);
      return (await extras.assets(plain)).map((name) => ({ plain, name, folder, file: join(dir, name) }));
    }
    return [];
  }

  handleDrag(source: readonly AssetItem[], data: vscode.DataTransfer): void {
    data.set("text/plain", new vscode.DataTransferItem(source.map((a) => assetMarkdown(a.name, a.folder)).join("\n\n")));
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
    if (!this.current.bundle && !this.current.plain) {
      void vscode.window.showInformationMessage("Open a document to add images to it.");
      return;
    }
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Images: IMAGE_TYPES }, title: "Add to Assets" });
    if (uris) await this.#import(uris);
  }

  async remove(item: AssetItem): Promise<void> {
    const detail = item.file ? `It is moved to the Trash from the “${item.folder}” folder. Images in the text that use it will no longer print.` : "Images in the text that use it will no longer print.";
    const ok = await vscode.window.showWarningMessage(`Delete ${item.name} from this document's assets?`, { modal: true, detail }, "Delete");
    if (ok !== "Delete") return;
    if (item.file) await vscode.workspace.fs.delete(vscode.Uri.file(item.file), { useTrash: true });
    else await this.store.update(item.bundle!, (b) => (b.delete(`assets/${item.name}`) ? [`assets/${item.name}`] : []));
    this.refresh();
  }

  async #import(uris: vscode.Uri[]): Promise<void> {
    const { bundle, plain } = this.current;
    if ((!bundle && !plain) || !uris.length) return;
    const files = await Promise.all(uris.map(async (u) => ({ name: basename(u.fsPath), data: new Uint8Array(await readFile(u.fsPath)) })));
    if (plain) {
      if (!(await plainExtras().confirm(plain))) return;
      await plainExtras().addAssets(plain, files, uniqueName);
      this.refresh();
      return;
    }
    await this.store.update(bundle!, (b) => {
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
    const extras = plainExtras();
    const plain = editor && extras.isPlain(editor.document) ? editor.document.uri.fsPath : current.plain;
    if (!plain) {
      void vscode.window.showInformationMessage("Open a document to use its Scratchpad.");
      return;
    }
    const existing = await extras.folder(plain);
    if ((await existing?.scratchpad()) === undefined && !(await extras.confirm(plain))) return;
    const folder = await extras.folder(plain, true);
    if (!folder) return;
    const doc = await vscode.workspace.openTextDocument(extras.uri(await folder.ensureScratchpad()));
    await vscode.window.showTextDocument(doc, { preview: false });
    return;
  }
  const snap = await store.snapshot(bundle);
  if (snap.scratchpad === undefined) await store.update(bundle, (b) => ((b.scratchpad = ""), ["scratchpad.txt"]));
  const doc = await vscode.workspace.openTextDocument(toHighlandUri(bundle, "scratchpad.txt"));
  await vscode.window.showTextDocument(doc, { preview: false });
}
