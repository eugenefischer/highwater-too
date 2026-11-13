import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
import { HighlandFileSystem, SCHEME, toHighlandUri } from "./fs-provider.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { plainExtras } from "./extras.ts";
import { binLabel, byteSize, imageSize, move, uniqueName } from "./syntax/workspace.ts";
import { idNote, noteId } from "./extras-folder.ts";
import { focusedDocument, type FocusedDocument } from "./focus.ts";
import { activeDocument, activeSelections, activeView } from "./surface.ts";
import { postTo } from "./highland-editor/messages.ts";

/**
 * The Bin and Assets of the focused document: their items and images, read and changed here for
 * the Highwater Editor's sidebar (sidebar-host.ts), plus the Bin keys (⌥⌘C, ⌥⌘X), the Scratchpad
 * as a tab in the text editor, and Link Writing History to This File. A .highland file keeps its
 * Bin, Scratchpad and images inside it; a plain .fountain or .md file keeps them with the writing
 * history and in a folder beside it (see PlainExtras).
 */
export function registerBinAndAssets(context: vscode.ExtensionContext, store: BundleStore, fs: HighlandFileSystem): void {
  const current = focusedDocument(context);
  const bin = new BinView(store, fs, current);
  const assets = new AssetsView(store, current);
  extrasApi = { bin, assets };
  const extras = plainExtras();

  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.copyToBin", () => toBin(false)),
    vscode.commands.registerCommand("highwater.cutToBin", () => toBin(true)),
    vscode.commands.registerCommand("highwater.assets.open", (item: AssetItem) => vscode.commands.executeCommand("vscode.open", assetUri(item))),
    vscode.commands.registerCommand("highwater.openScratchpad", () => openScratchpad(store, current)),
    vscode.commands.registerCommand("highwater.linkHistoryToFile", () => linkHistoryToFile()),
  );

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

/** The Bin and Assets, for the Highwater Editor's sidebar (sidebar-host.ts). */
export let extrasApi: { bin: BinView; assets: AssetsView } | undefined;

// ---------------------------------------------------------------------------------------------
// Bin

/** Whose Bin: a .highland file's, or a plain file's. */
export type Owner = { bundle: string; plain?: undefined } | { plain: string; bundle?: undefined };

export type BinItem = Owner & {
  index: number;
  text: string;
};

/** A document's Bin items: read, added, reordered, edited and removed. */
export class BinView {

  constructor(
    private readonly store: BundleStore,
    private readonly fs: HighlandFileSystem,
    private readonly current: FocusedDocument,
  ) {}

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

const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "heic", "webp", "pdf"];

/** A document's images: listed with their sizes, read, added and removed. */
export class AssetsView {

  constructor(
    private readonly store: BundleStore,
    private readonly current: FocusedDocument,
  ) {}

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
  }

  /** Copies images into a document's assets (a .highland file's assets/, or a plain file's images folder). */
  async importFiles(owner: Owner, files: { name: string; data: Uint8Array }[]): Promise<void> {
    const { bundle, plain } = owner;
    if (!files.length) return;
    if (plain) {
      if (!(await plainExtras().confirm(plain))) return;
      await plainExtras().addAssets(plain, files, uniqueName);
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
  }
}

// ---------------------------------------------------------------------------------------------

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
