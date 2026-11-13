import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
import { HighlandFileSystem, SCHEME, toHighlandUri } from "./fs-provider.ts";
import type { ParseCache } from "./language.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { plainExtras } from "./extras.ts";
import { NAVIGATOR_VIEW, NavigatorPane } from "./navigator-pane/pane.ts";
import { assetMarkdown, binDetail, binLabel, byteSize, imageSize, move, uniqueName } from "./syntax/workspace.ts";
import { idNote, noteId } from "./extras-folder.ts";
import { focusedDocument, roleOf, type FocusedDocument } from "./focus.ts";
import { LANGUAGES } from "./language.ts";
import { activeColumn, activeDocument, activeSelections, activeView, insertAtSelection, onDidChangeActiveSurface, revealOffset, viewOf } from "./surface.ts";
import { postTo } from "./highland-editor/messages.ts";

/**
 * The Highland sidebar (M6): Navigator, Bin and Assets as tree views in a "Highwater Too" view
 * container, the Scratchpad as an editor tab. They follow the last active Highland editor. A
 * .highland file keeps its Bin, Scratchpad and images inside it; a plain .fountain or .md file
 * keeps them with the writing history and in a folder beside it (see PlainExtras).
 */
export function registerPanels(context: vscode.ExtensionContext, store: BundleStore, fs: HighlandFileSystem, cache: ParseCache): void {
  const current = focusedDocument(context);
  const navigator = new NavigatorPane(context, store, cache, current);
  const bin = new BinView(store, fs, current);
  const assets = new AssetsView(store, current);
  extrasApi = { bin, assets };

  const binTree = vscode.window.createTreeView("highwater.bin", { treeDataProvider: bin, dragAndDropController: bin, canSelectMany: false });
  const assetTree = vscode.window.createTreeView("highwater.assets", { treeDataProvider: assets, dragAndDropController: assets });
  // Highland's look: a webview list rather than a tree, so it can show where a drag will land.
  const navPane = vscode.window.registerWebviewViewProvider(NAVIGATOR_VIEW, navigator, { webviewOptions: { retainContextWhenHidden: true } });

  const refreshAll = () => {
    navigator.refresh();
    bin.refresh();
    assets.refresh();
  };
  current.onDidChange(refreshAll);
  const extras = plainExtras();

  let timer: NodeJS.Timeout | undefined;
  /** Scripts the sidebar has been shown for since they were opened. */
  const shown = new Set<string>();
  context.subscriptions.push(
    binTree,
    assetTree,
    navPane,
    onDidChangeActiveSurface(() => void showSidebar()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document !== current.script) return;
      clearTimeout(timer);
      timer = setTimeout(() => navigator.refresh(), 250);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => shown.delete(d.uri.toString())),
    { dispose: store.onExternalChange((path) => (path === current.bundle ? refreshAll() : undefined)) },
    // This extension's own writes too: a Bin item saved in its tab, a Revert, an image added.
    {
      dispose: store.onDidWrite((path, entries) => {
        if (path !== current.bundle) return;
        if (entries.some((e) => e.startsWith("bin/"))) bin.refresh();
        if (entries.some((e) => e.startsWith("assets/"))) assets.refresh();
      }),
    },
    extras.onDidChange((path) => {
      if (path !== current.plain) return;
      bin.refresh();
      assets.refresh();
    }),

    // An image dragged from the Assets panel into the text becomes an image reference. The panel's
    // items carry their file's address (for their icons), and without this VS Code inserts that
    // address instead; the setting highwater.asset in configurationDefaults makes this the choice.
    vscode.languages.registerDocumentDropEditProvider(
      Object.values(LANGUAGES).map((language) => ({ language })),
      {
        provideDocumentDropEdits: async (doc, _position, data) => {
          const list = await data.get("text/uri-list")?.asString();
          const text = list ? await assetReferences(doc, list) : null;
          return text ? new vscode.DocumentDropEdit(text, "Insert Image", ASSET_DROP) : undefined;
        },
      },
      { dropMimeTypes: ["text/uri-list"], providedDropEditKinds: [ASSET_DROP] },
    ),
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
    vscode.commands.registerCommand("highwater.panels.refresh", () => refreshAll()),
    vscode.commands.registerCommand("highwater.linkHistoryToFile", () => linkHistoryToFile()),
  );
  void showSidebar();

  /**
   * Opening a Highland script switches the sidebar to Highwater Too, once per opening, then hands
   * the keyboard back to the editor. Setting highwater.showSidebarOnOpen turns this off.
   */
  async function showSidebar(): Promise<void> {
    const doc = activeDocument();
    const column = activeColumn();
    if (!doc || !doc.languageId.startsWith("highland-")) return;
    const parts = doc.uri.scheme === SCHEME ? splitBundlePath(doc.uri.fsPath) : null;
    if (parts && parts.entry !== "") return; // Bin items and the Scratchpad
    const key = doc.uri.toString();
    if (shown.has(key)) return;
    shown.add(key);
    if (!vscode.workspace.getConfiguration("highwater").get<boolean>("showSidebarOnOpen", true)) return;
    // The Highwater Editor has these panels in its own sidebar (and VS Code's are hidden there).
    if (viewOf(doc)) return;
    await vscode.commands.executeCommand("workbench.view.extension.highwater");
    await vscode.window.showTextDocument(doc, { ...(column ? { viewColumn: column } : {}), preserveFocus: false });
  }

  async function toBin(cut: boolean): Promise<void> {
    // In the Highwater Editor the page does it, so ⌘Z there puts the text back and takes the item out.
    const view = activeView();
    if (view) {
      postTo(view.panel, { type: "toBin", cut });
      return;
    }
    const active = activeSelections();
    const document = active?.document;
    const bundle = document && document.uri.scheme === SCHEME ? splitBundlePath(document.uri.fsPath)?.bundle : undefined;
    const plain = document && extras.isPlain(document) ? document.uri.fsPath : undefined;
    if (!active || !document || (!bundle && !plain)) {
      void vscode.window.showInformationMessage("Open a document to use the Bin.");
      return;
    }
    const ranges = active.ranges.filter((s) => !s.isEmpty);
    if (!ranges.length) return;
    const text = ranges.map((r) => document.getText(r)).join("\n\n");
    if (!(await bin.add(text, bundle ? { bundle } : { plain: plain! }))) return;
    if (!cut) return;
    const edit = new vscode.WorkspaceEdit();
    for (const r of ranges) edit.delete(document.uri, r);
    await vscode.workspace.applyEdit(edit);
  }

  /** Writes the ID note into a plain file, so its history and extras follow it if it moves. */
  async function linkHistoryToFile(): Promise<void> {
    const doc = activeDocument();
    if (!doc || !extras.isPlain(doc)) {
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
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, end, `${sep}${idNote(id)}\n`);
    await vscode.workspace.applyEdit(edit);
    void vscode.window.showInformationMessage(
      "Added a note at the end of the file naming its writing history, so its history, Bin and Scratchpad stay with it if it is moved or renamed. Notes never print.",
    );
  }
}

/** The Bin and Assets, for the Highwater Editor's sidebar (sidebar-host.ts) as well as VS Code's views. */
export let extrasApi: { bin: BinView; assets: AssetsView } | undefined;

/** The Highland script (and its bundle, or its path for a plain file) the panels show. */
// ---------------------------------------------------------------------------------------------
// Navigator: see navigator-pane/pane.ts.

async function reveal(uri: vscode.Uri, offset: number): Promise<void> {
  // In the Highwater Editor if one shows the document, else in a text editor.
  await revealOffset(await vscode.workspace.openTextDocument(uri), offset, "top", true);
}

// ---------------------------------------------------------------------------------------------
// Bin

/** Whose Bin: a .highland file's, or a plain file's. */
export type Owner = { bundle: string; plain?: undefined } | { plain: string; bundle?: undefined };

export type BinItem = Owner & {
  index: number;
  text: string;
};

const BIN_MIME = "application/vnd.code.tree.highwater.bin";

export class BinView implements vscode.TreeDataProvider<BinItem>, vscode.TreeDragAndDropController<BinItem> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly dragMimeTypes = [BIN_MIME, "text/plain"];
  readonly dropMimeTypes = [BIN_MIME, "text/plain"];

  constructor(
    private readonly store: BundleStore,
    private readonly fs: HighlandFileSystem,
    private readonly current: FocusedDocument,
  ) {}

  refresh(): void {
    this.#changed.fire();
  }

  getTreeItem(item: BinItem): vscode.TreeItem {
    const t = new vscode.TreeItem(binLabel(item.text, 80));
    // How long it is and how it goes on, as Highland's cards show more than the first line.
    t.description = binDetail(item.text);
    const tip = new vscode.MarkdownString();
    tip.appendText(item.text.length > 1200 ? `${item.text.slice(0, 1200)}…` : item.text || "(empty)");
    tip.appendMarkdown("\n\n---\n\nClick to open · the arrow inserts it at the cursor");
    t.tooltip = tip;
    t.contextValue = "binItem";
    t.iconPath = new vscode.ThemeIcon("note");
    t.command = { command: "highwater.bin.open", title: "Open", arguments: [item] };
    return t;
  }

  async getChildren(item?: BinItem): Promise<BinItem[]> {
    if (item) return [];
    const owner = this.#owner();
    return owner ? this.items(owner) : [];
  }

  /** A document's Bin items. */
  async items(owner: Owner): Promise<BinItem[]> {
    const { bundle, plain } = owner;
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
    await this.change(owner, (items) => [...items, text]);
    return true;
  }

  async reorder(from: number, to: number, owner = this.#owner()): Promise<void> {
    if (!owner || to < 0) return;
    await this.change(owner, (items) => (to >= items.length ? items : move(items, from, to)));
  }

  /** Replaces one item's text (edited in the Highwater Editor's sidebar). */
  async edit(owner: Owner, index: number, text: string): Promise<void> {
    await this.change(owner, (items) => items.map((t, i) => (i === index ? text : t)));
  }

  async remove(item: BinItem): Promise<void> {
    const ok = await ask("warning", `Delete the Bin item “${binLabel(item.text, 40)}”?`, { modal: true }, "Delete");
    if (ok !== "Delete") return;
    await this.change(item, (items) => items.filter((_, i) => i !== item.index));
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

  async change(owner: Owner, f: (items: string[]) => string[]): Promise<void> {
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

export type AssetItem = Owner & {
  name: string;
  /** The folder the text refers to it in: "assets", or a plain file's "<name> assets". */
  folder: string;
  /** A plain file's image, on disk. */
  file?: string;
};

function assetUri(item: AssetItem): vscode.Uri {
  return item.file ? vscode.Uri.file(item.file) : toHighlandUri(item.bundle!, `assets/${item.name}`);
}

const ASSET_DROP = vscode.DocumentDropOrPasteEditKind.Empty.append("highwater", "asset");

/**
 * The image references for files dropped on a document, when every one is in that document's
 * assets (its .highland file's assets/, or a plain file's images folder); null otherwise.
 */
async function assetReferences(doc: vscode.TextDocument, uriList: string): Promise<string | null> {
  const role = roleOf(doc);
  if (role.kind !== "script") return null;
  const uris = uriList
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => vscode.Uri.parse(l));
  if (!uris.length) return null;
  const plainFolder = role.plain ? await plainExtras().assetsFolder(role.plain) : null;
  const refs: string[] = [];
  for (const uri of uris) {
    if (role.bundle && uri.scheme === SCHEME) {
      const parts = splitBundlePath(uri.fsPath);
      if (parts?.bundle !== role.bundle || !/^assets\/[^/]+$/.test(parts.entry)) return null;
      refs.push(assetMarkdown(parts.entry.slice("assets/".length), "assets"));
    } else if (plainFolder && uri.scheme === "file" && dirname(uri.fsPath) === plainFolder.dir) {
      refs.push(assetMarkdown(basename(uri.fsPath), plainFolder.name));
    } else return null;
  }
  return refs.join("\n\n");
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "heic", "webp", "pdf"];

export class AssetsView implements vscode.TreeDataProvider<AssetItem>, vscode.TreeDragAndDropController<AssetItem> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly dragMimeTypes = ["text/plain"];
  readonly dropMimeTypes = ["text/uri-list"];

  constructor(
    private readonly store: BundleStore,
    private readonly current: FocusedDocument,
  ) {}

  refresh(): void {
    this.#changed.fire();
  }

  getTreeItem(item: AssetItem): vscode.TreeItem {
    // As in Highland: the name without its extension, then the kind (and here its size).
    const dot = item.name.lastIndexOf(".");
    const ext = dot > 0 ? item.name.slice(dot + 1).toLowerCase() : "";
    const t = new vscode.TreeItem(dot > 0 ? item.name.slice(0, dot) : item.name);
    const info = this.#info.get(this.#key(item));
    t.description = [ext, info?.dimensions, info?.size].filter(Boolean).join(" · ");
    t.contextValue = "asset";
    t.iconPath = new vscode.ThemeIcon(ext === "pdf" ? "file-pdf" : "file-media");
    t.command = { command: "highwater.assets.open", title: "Open", arguments: [item] };
    return t;
  }

  /** On hover: a preview of the image. */
  async resolveTreeItem(t: vscode.TreeItem, item: AssetItem): Promise<vscode.TreeItem> {
    const tip = new vscode.MarkdownString(undefined, true);
    tip.supportHtml = true;
    const bytes = await this.#read(item);
    const mime = MIME[item.name.slice(item.name.lastIndexOf(".") + 1).toLowerCase()];
    // Small enough to show inline (a hover holds the whole image).
    if (bytes && mime && bytes.length <= 3 * 1024 * 1024) tip.appendMarkdown(`<img src="data:${mime};base64,${Buffer.from(bytes).toString("base64")}" width="240">\n\n`);
    tip.appendText(item.name);
    tip.appendMarkdown("\n\nDrag into the text, or use the arrow to insert it at the cursor.");
    t.tooltip = tip;
    return t;
  }

  /** Size and dimensions, found when the list is made. */
  readonly #info = new Map<string, { size: string; dimensions: string | undefined }>();

  /** Size and pixel dimensions of a listed image. */
  info(item: AssetItem): { size: string; dimensions: string | undefined } | undefined {
    return this.#info.get(this.#key(item));
  }

  read(item: AssetItem): Promise<Uint8Array | null> {
    return this.#read(item);
  }

  #key(item: AssetItem): string {
    return `${item.bundle ?? item.plain}\n${item.name}`;
  }

  async #read(item: AssetItem): Promise<Uint8Array | null> {
    if (item.file) return readFile(item.file).catch(() => null);
    return this.store.read(item.bundle!, `assets/${item.name}`).catch(() => null);
  }

  async #measure(items: AssetItem[]): Promise<AssetItem[]> {
    await Promise.all(
      items.map(async (item) => {
        const bytes = await this.#read(item);
        if (!bytes) return;
        const d = imageSize(bytes);
        this.#info.set(this.#key(item), { size: byteSize(bytes.length), dimensions: d ? `${d.width}×${d.height}` : undefined });
      }),
    );
    return items;
  }

  async getChildren(item?: AssetItem): Promise<AssetItem[]> {
    if (item) return [];
    const { bundle, plain } = this.current;
    return this.list(bundle ? { bundle } : plain ? { plain } : null);
  }

  /** A document's images, with their sizes measured (see info). */
  async list(owner: Owner | null): Promise<AssetItem[]> {
    const bundle = owner?.bundle;
    const plain = owner?.plain;
    if (bundle) {
      const snap = await this.store.snapshot(bundle).catch(() => null);
      const names = (snap?.paths ?? []).filter((p) => p.startsWith("assets/") && !p.endsWith("/")).map((p) => p.slice("assets/".length));
      return this.#measure(names.sort((a, b) => a.localeCompare(b)).map((name) => ({ bundle, name, folder: "assets" })));
    }
    if (plain) {
      const extras = plainExtras();
      const { name: folder, dir } = await extras.assetsFolder(plain);
      return this.#measure((await extras.assets(plain)).map((name) => ({ plain, name, folder, file: join(dir, name) })));
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

  async add(owner: Owner | null = this.#ownerOf()): Promise<void> {
    if (!owner) {
      void vscode.window.showInformationMessage("Open a document to add images to it.");
      return;
    }
    const uris = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Images: IMAGE_TYPES }, title: "Add to Assets" });
    if (uris) await this.importFiles(owner, await Promise.all(uris.map(async (u) => ({ name: basename(u.fsPath), data: new Uint8Array(await readFile(u.fsPath)) }))));
  }

  #ownerOf(): Owner | null {
    return this.current.bundle ? { bundle: this.current.bundle } : this.current.plain ? { plain: this.current.plain } : null;
  }

  async remove(item: AssetItem): Promise<void> {
    const detail = item.file ? `It is moved to the Trash from the “${item.folder}” folder. Images in the text that use it will no longer print.` : "Images in the text that use it will no longer print.";
    const ok = await ask("warning", `Delete ${item.name} from this document's assets?`, { modal: true, detail }, "Delete");
    if (ok !== "Delete") return;
    if (item.file) await vscode.workspace.fs.delete(vscode.Uri.file(item.file), { useTrash: true });
    else await this.store.update(item.bundle!, (b) => (b.delete(`assets/${item.name}`) ? [`assets/${item.name}`] : []));
    this.refresh();
  }

  async #import(uris: vscode.Uri[]): Promise<void> {
    const owner = this.#ownerOf();
    if (!owner || !uris.length) return;
    await this.importFiles(owner, await Promise.all(uris.map(async (u) => ({ name: basename(u.fsPath), data: new Uint8Array(await readFile(u.fsPath)) }))));
  }

  /** Copies images into a document's assets (a .highland file's assets/, or a plain file's images folder). */
  async importFiles(owner: Owner, files: { name: string; data: Uint8Array }[]): Promise<void> {
    const { bundle, plain } = owner;
    if (!files.length) return;
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

async function insertText(current: FocusedDocument, text: string): Promise<void> {
  const doc = current.script;
  if (!doc) return;
  await insertAtSelection(doc, text);
}

async function openScratchpad(store: BundleStore, current: FocusedDocument): Promise<void> {
  // In the Highwater Editor, the Scratchpad is a panel of its sidebar.
  const view = activeView();
  if (view) {
    postTo(view.panel, { type: "showPanel", panel: "scratchpad" });
    return;
  }
  const active = activeDocument();
  const bundle = (active?.uri.scheme === SCHEME ? splitBundlePath(active.uri.fsPath)?.bundle : undefined) ?? current.bundle;
  if (!bundle) {
    const extras = plainExtras();
    const plain = active && extras.isPlain(active) ? active.uri.fsPath : current.plain;
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
