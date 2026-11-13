import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as vscode from "vscode";
import { toHighlandUri, type HighlandFileSystem } from "./fs-provider.ts";
import type { BundleStore } from "./store.ts";
import { plainExtras } from "./extras.ts";
import { uniqueName } from "./syntax/workspace.ts";

/** Whose Bin, Scratchpad and images: a .highland file's, or a plain file's. */
export type Owner = { bundle: string; plain?: undefined } | { plain: string; bundle?: undefined };

export type AssetItem = Owner & {
  name: string;
  /** The folder the text refers to it in: "assets", or a plain file's "<name> assets". */
  folder: string;
  /** A plain file's image, on disk. */
  file?: string;
};

/**
 * A document's Bin, Scratchpad and images, wherever they are kept: inside a .highland file, or
 * for a plain .fountain or .md file in the writing history's extras folder and a folder of images
 * beside the file (see PlainExtras). Everything that reads or changes them goes through here.
 */
export interface DocumentExtras {
  readonly owner: Owner;
  /**
   * Before a plain file's first Bin item, Scratchpad or image: the one-time note that these are not
   * part of the file. False to stop. Always true for a .highland file.
   */
  confirm(): Promise<boolean>;
  /** The Bin's items, in order (none if they can't be read). */
  binItems(): Promise<string[]>;
  /** Changes the Bin's items, telling open item tabs (items are renumbered). */
  changeBin(f: (items: string[]) => string[]): Promise<void>;
  /** The Scratchpad, or undefined if there is none yet. */
  scratchpad(): Promise<string | undefined>;
  /** Saves the Scratchpad (a plain file's first one after confirm()); false if that was declined. */
  saveScratchpad(text: string): Promise<boolean>;
  /** The Scratchpad as a file to open in a tab, made if need be; null if confirm() was declined. */
  scratchpadUri(): Promise<vscode.Uri | null>;
  /** The images, by name. */
  assets(): Promise<AssetItem[]>;
  readAsset(item: AssetItem): Promise<Uint8Array | null>;
  /** Copies images in under names not already taken (a plain file's first after confirm()). */
  addAssets(files: { name: string; data: Uint8Array }[]): Promise<void>;
  /** Removes an image (a plain file's goes to the Trash). */
  removeAsset(item: AssetItem): Promise<void>;
  assetUri(item: AssetItem): vscode.Uri;
}

export function documentExtras(owner: Owner, store: BundleStore, fs: Pick<HighlandFileSystem, "fireChanged">): DocumentExtras {
  return owner.bundle !== undefined ? new BundleExtras(owner.bundle, store, fs) : new PlainFileExtras(owner.plain);
}

/** Kept inside the .highland file: bin/<n>.txt, scratchpad.txt and assets/. */
class BundleExtras implements DocumentExtras {
  readonly owner: Owner;

  constructor(
    private readonly bundle: string,
    private readonly store: BundleStore,
    private readonly fs: Pick<HighlandFileSystem, "fireChanged">,
  ) {
    this.owner = { bundle };
  }

  async confirm(): Promise<boolean> {
    return true;
  }

  async binItems(): Promise<string[]> {
    return (await this.store.snapshot(this.bundle).catch(() => null))?.binItems ?? [];
  }

  async changeBin(f: (items: string[]) => string[]): Promise<void> {
    const bundle = this.bundle;
    const before = (await this.store.snapshot(bundle)).binItems.length;
    await this.store.update(bundle, (b) => {
      b.setBinItems(f(b.binItems));
      return b.paths.filter((p) => p.startsWith("bin/"));
    });
    const after = (await this.store.snapshot(bundle)).binItems.length;
    // Items are renumbered: let open item tabs reload.
    this.fs.fireChanged(bundle, Array.from({ length: Math.max(before, after) }, (_, i) => `bin/${i}.txt`));
  }

  async scratchpad(): Promise<string | undefined> {
    return (await this.store.snapshot(this.bundle)).scratchpad;
  }

  async saveScratchpad(text: string): Promise<boolean> {
    await this.store.update(this.bundle, (x) => ((x.scratchpad = text), ["scratchpad.txt"]));
    return true;
  }

  async scratchpadUri(): Promise<vscode.Uri | null> {
    const snap = await this.store.snapshot(this.bundle);
    if (snap.scratchpad === undefined) await this.store.update(this.bundle, (b) => ((b.scratchpad = ""), ["scratchpad.txt"]));
    return toHighlandUri(this.bundle, "scratchpad.txt");
  }

  async assets(): Promise<AssetItem[]> {
    const bundle = this.bundle;
    const snap = await this.store.snapshot(bundle).catch(() => null);
    const names = (snap?.paths ?? []).filter((p) => p.startsWith("assets/") && !p.endsWith("/")).map((p) => p.slice("assets/".length));
    return names.sort((a, b) => a.localeCompare(b)).map((name) => ({ bundle, name, folder: "assets" }));
  }

  readAsset(item: AssetItem): Promise<Uint8Array | null> {
    return this.store.read(this.bundle, `assets/${item.name}`).catch(() => null);
  }

  async addAssets(files: { name: string; data: Uint8Array }[]): Promise<void> {
    await this.store.update(this.bundle, (b) => {
      const taken = b.paths.filter((p) => p.startsWith("assets/")).map((p) => p.slice(7));
      return files.map((f) => {
        const name = uniqueName(f.name, taken);
        taken.push(name);
        b.set(`assets/${name}`, f.data);
        return `assets/${name}`;
      });
    });
  }

  async removeAsset(item: AssetItem): Promise<void> {
    await this.store.update(this.bundle, (b) => (b.delete(`assets/${item.name}`) ? [`assets/${item.name}`] : []));
  }

  assetUri(item: AssetItem): vscode.Uri {
    return toHighlandUri(this.bundle, `assets/${item.name}`);
  }
}

/** A plain file's: its Bin and Scratchpad in its extras folder, its images in a folder beside it. */
class PlainFileExtras implements DocumentExtras {
  readonly owner: Owner;

  constructor(private readonly path: string) {
    this.owner = { plain: path };
  }

  confirm(): Promise<boolean> {
    return plainExtras().confirm(this.path);
  }

  async binItems(): Promise<string[]> {
    const folder = await plainExtras().folder(this.path).catch(() => null);
    return (await folder?.binItems()) ?? [];
  }

  async changeBin(f: (items: string[]) => string[]): Promise<void> {
    const extras = plainExtras();
    const folder = await extras.folder(this.path, true);
    if (!folder) return;
    const items = f(await folder.binItems());
    const before = await folder.setBinItems(items);
    extras.fireChanged(Array.from({ length: Math.max(before, items.length) }, (_, i) => folder.binPath(i)));
    extras.changed(this.path);
  }

  async scratchpad(): Promise<string | undefined> {
    return (await plainExtras().folder(this.path))?.scratchpad();
  }

  async saveScratchpad(text: string): Promise<boolean> {
    const extras = plainExtras();
    let folder = await extras.folder(this.path);
    if (!folder || (await folder.scratchpad()) === undefined) {
      if (!(await extras.confirm(this.path))) return false;
      folder = await extras.folder(this.path, true);
      if (!folder) return false;
    }
    await writeFile(await folder.ensureScratchpad(), text, "utf8");
    extras.fireChanged([folder.scratchpadPath]);
    return true;
  }

  async scratchpadUri(): Promise<vscode.Uri | null> {
    const extras = plainExtras();
    const existing = await extras.folder(this.path);
    if ((await existing?.scratchpad()) === undefined && !(await extras.confirm(this.path))) return null;
    const folder = await extras.folder(this.path, true);
    if (!folder) return null;
    return extras.uri(await folder.ensureScratchpad());
  }

  async assets(): Promise<AssetItem[]> {
    const extras = plainExtras();
    const plain = this.path;
    const { name: folder, dir } = await extras.assetsFolder(plain);
    return (await extras.assets(plain)).map((name) => ({ plain, name, folder, file: join(dir, name) }));
  }

  readAsset(item: AssetItem): Promise<Uint8Array | null> {
    return readFile(item.file!).catch(() => null);
  }

  async addAssets(files: { name: string; data: Uint8Array }[]): Promise<void> {
    if (!(await plainExtras().confirm(this.path))) return;
    await plainExtras().addAssets(this.path, files, uniqueName);
  }

  async removeAsset(item: AssetItem): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(item.file!), { useTrash: true });
  }

  assetUri(item: AssetItem): vscode.Uri {
    return vscode.Uri.file(item.file!);
  }
}
