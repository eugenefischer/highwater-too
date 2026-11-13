import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import * as vscode from "vscode";
import { ask } from "./ask.ts";
import { HighlandFileSystem, SCHEME } from "./fs-provider.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { plainExtras } from "./extras.ts";
import { documentExtras, type AssetItem, type DocumentExtras, type Owner } from "./document-extras.ts";
import { binLabel, byteSize, imageSize, move } from "./syntax/workspace.ts";
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
  const of = (owner: Owner) => documentExtras(owner, store, fs);
  const bin = new BinView(of, current);
  const assets = new AssetsView(of, current);
  extrasApi = { bin, assets, of };
  const extras = plainExtras();

  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.copyToBin", () => toBin(false)),
    vscode.commands.registerCommand("highwater.cutToBin", () => toBin(true)),
    vscode.commands.registerCommand("highwater.assets.open", (item: AssetItem) => vscode.commands.executeCommand("vscode.open", of(item).assetUri(item))),
    vscode.commands.registerCommand("highwater.openScratchpad", () => openScratchpad(of, current)),
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
export let extrasApi: { bin: BinView; assets: AssetsView; of(owner: Owner): DocumentExtras } | undefined;

// ---------------------------------------------------------------------------------------------
// Bin

export type { AssetItem, Owner };

export type BinItem = Owner & {
  index: number;
  text: string;
};

/** A document's Bin items: read, added, reordered, edited and removed. */
export class BinView {
  constructor(
    private readonly of: (owner: Owner) => DocumentExtras,
    private readonly current: FocusedDocument,
  ) {}

  /** A document's Bin items. */
  async items(owner: Owner): Promise<BinItem[]> {
    return (await this.of(owner).binItems()).map((text, index) => ({ ...owner, index, text }));
  }

  #owner(): Owner | null {
    if (this.current.bundle) return { bundle: this.current.bundle };
    if (this.current.plain) return { plain: this.current.plain };
    return null;
  }

  /** Adds a Bin item at the end (Highland's ⌥⌘C / ⌥⌘X). False if nothing was added. */
  async add(text: string, owner = this.#owner()): Promise<boolean> {
    if (!owner) return false;
    if (!(await this.of(owner).confirm())) return false;
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

  change(owner: Owner, f: (items: string[]) => string[]): Promise<void> {
    return this.of(owner).changeBin(f);
  }
}

// ---------------------------------------------------------------------------------------------
// Assets

const IMAGE_TYPES = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "heic", "webp", "pdf"];

/** A document's images: listed with their sizes, read, added and removed. */
export class AssetsView {

  constructor(
    private readonly of: (owner: Owner) => DocumentExtras,
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

  #read(item: AssetItem): Promise<Uint8Array | null> {
    return this.of(item).readAsset(item);
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
    return owner ? this.#measure(await this.of(owner).assets()) : [];
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
    await this.of(item).removeAsset(item);
  }

  /** Copies images into a document's assets (a .highland file's assets/, or a plain file's images folder). */
  async importFiles(owner: Owner, files: { name: string; data: Uint8Array }[]): Promise<void> {
    if (!files.length) return;
    await this.of(owner).addAssets(files);
  }

}

// ---------------------------------------------------------------------------------------------

async function openScratchpad(of: (owner: Owner) => DocumentExtras, current: FocusedDocument): Promise<void> {
  // In the Highwater Editor, the Scratchpad is a panel of its sidebar.
  const view = activeView();
  if (view) {
    postTo(view.panel, { type: "showPanel", panel: "scratchpad" });
    return;
  }
  const active = activeDocument();
  const bundle = (active?.uri.scheme === SCHEME ? splitBundlePath(active.uri.fsPath)?.bundle : undefined) ?? current.bundle;
  const plain = bundle ? undefined : active && plainExtras().isPlain(active) ? active.uri.fsPath : current.plain;
  if (!bundle && !plain) {
    void vscode.window.showInformationMessage("Open a document to use its Scratchpad.");
    return;
  }
  const uri = await of(bundle ? { bundle } : { plain: plain! }).scratchpadUri();
  if (!uri) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}
