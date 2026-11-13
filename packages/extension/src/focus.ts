import * as vscode from "vscode";
import { SCHEME, toHighlandUri } from "./fs-provider.ts";
import { EXTRAS_SCHEME, plainExtras } from "./extras.ts";
import { splitBundlePath } from "./store.ts";
import { activeDocument, onDidChangeActiveSurface } from "./surface.ts";

/**
 * Editors that look at a document without being another document: a save from the writing history,
 * the file on disk beside unsaved edits, output, source-control views. Moving to one keeps the
 * focused document.
 */
const NEUTRAL_SCHEMES = new Set(["highwater-history", "highland-disk", "output", "git", "comment", "vscode-scm", "debug"]);

/** What a text document is to Highwater Too. */
export type DocumentRole =
  | { kind: "script"; key: string; bundle?: string; plain?: string }
  | { kind: "companion"; key: string; bundle?: string; plain?: string }
  | { kind: "other" }
  | { kind: "neutral" };

/** A .highland file's script, a plain .fountain/.md file, one of their Bin items or Scratchpads, or none of these. */
export function roleOf(doc: vscode.TextDocument): DocumentRole {
  const uri = doc.uri;
  if (uri.scheme === EXTRAS_SCHEME) {
    const owner = plainExtras().ownerOf(uri);
    return owner ? { kind: "companion", key: owner, plain: owner } : { kind: "neutral" };
  }
  if (uri.scheme === SCHEME) {
    const parts = splitBundlePath(uri.fsPath);
    if (!parts) return { kind: "neutral" };
    return { kind: parts.entry === "" ? "script" : "companion", key: parts.bundle, bundle: parts.bundle };
  }
  if (uri.scheme === "file" || uri.scheme === "untitled") {
    if (doc.languageId.startsWith("highland-") && uri.scheme === "file") return { kind: "script", key: uri.fsPath, plain: uri.fsPath };
    return { kind: "other" };
  }
  return { kind: NEUTRAL_SCHEMES.has(uri.scheme) ? "neutral" : "other" };
}

function tabUris(tab: vscode.Tab): vscode.Uri[] {
  const i = tab.input;
  if (i instanceof vscode.TabInputText) return [i.uri];
  if (i instanceof vscode.TabInputTextDiff) return [i.modified];
  if (i instanceof vscode.TabInputCustom) return [i.uri]; // the Highwater Editor
  return [];
}

/** True if a tab shows a document's script (a .highland file's text, or the plain file). */
function isScriptUri(uri: vscode.Uri, key: string): boolean {
  if (uri.scheme === SCHEME) {
    const p = splitBundlePath(uri.fsPath);
    return !!p && p.bundle === key && p.entry === "";
  }
  return uri.scheme === "file" && uri.fsPath === key;
}

/** True if a uri is one of a document's Bin items or its Scratchpad. */
export function isCompanionUri(uri: vscode.Uri, key: string): boolean {
  if (uri.scheme === SCHEME) {
    const p = splitBundlePath(uri.fsPath);
    return !!p && p.bundle === key && (p.entry === "scratchpad.txt" || /^bin\/\d+\.txt$/.test(p.entry));
  }
  return uri.scheme === EXTRAS_SCHEME && plainExtras().ownerOf(uri) === key;
}

function allTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((g) => g.tabs);
}

/** True while some tab shows the document's script. */
export function scriptIsOpen(key: string): boolean {
  return allTabs().some((t) => tabUris(t).some((u) => isScriptUri(u, key)));
}

/** Closes the tabs of a document's Bin items and Scratchpad (unsaved ones ask, as VS Code does). */
export async function closeCompanions(key: string): Promise<void> {
  const tabs = allTabs().filter((t) => t.input instanceof vscode.TabInputText && isCompanionUri(t.input.uri, key));
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

/**
 * The document the Navigator, Bin, Assets and Writing History panes show: the focused Highwater
 * document, or none. A Bin item or Scratchpad stands for its document; another file clears it;
 * the panes themselves, the Preview, a save from the history and the like keep it. Closing the
 * document's last tab clears it, and closes its Bin items and Scratchpad.
 */
export class FocusedDocument implements vscode.Disposable {
  script: vscode.TextDocument | undefined;
  bundle: string | undefined;
  /** A plain .fountain or .md file's path. */
  plain: string | undefined;
  readonly #emitter = new vscode.EventEmitter<void>();
  /** Fires when the focused document changes, or its script is opened again (in another language, say). */
  readonly onDidChange = this.#emitter.event;
  readonly #subscriptions: vscode.Disposable[] = [];

  constructor() {
    this.#subscriptions.push(
      this.#emitter,
      // The active text editor or Highwater Editor.
      onDidChangeActiveSurface(() => this.follow(activeDocument())),
      // A file whose language changed (a .md file switched to Highwater Markdown) is a new document.
      vscode.workspace.onDidOpenTextDocument((d) => {
        if (activeDocument()?.uri.toString() === d.uri.toString()) this.follow(d);
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (d === this.script) this.script = undefined;
      }),
      vscode.window.tabGroups.onDidChangeTabs((e) => void this.#tabsClosed(e.closed).catch(() => undefined)),
    );
    this.follow(activeDocument());
  }

  /** The file the document is: the .highland file or the plain file. */
  get key(): string | undefined {
    return this.bundle ?? this.plain;
  }

  get label(): string {
    return this.key ?? "";
  }

  follow(doc: vscode.TextDocument | undefined): void {
    if (!doc) {
      // The Preview, a pane, nothing: keep the document while its script is open.
      if (this.key && !scriptIsOpen(this.key)) this.set(undefined);
      return;
    }
    const role = roleOf(doc);
    if (role.kind === "neutral") return;
    if (role.kind === "other") return this.set(undefined);
    if (role.kind === "companion") {
      // A Bin item or the Scratchpad stands for its document while the document is open.
      if (role.key === this.key || !scriptIsOpen(role.key)) return;
      const script = vscode.workspace.textDocuments.find((d) => {
        const r = roleOf(d);
        return r.kind === "script" && r.key === role.key;
      });
      return this.set(role, script);
    }
    if (doc === this.script) return;
    const fresh = role.key !== this.key;
    this.set(role, doc);
    if (!fresh) return;
    // Bin and Scratchpad saved on another computer.
    if (role.plain) void plainExtras().bringIn(role.plain).catch(() => false);
  }

  async #tabsClosed(closed: readonly vscode.Tab[]): Promise<void> {
    const keys = new Set<string>();
    for (const t of closed) {
      for (const u of tabUris(t)) {
        if (u.scheme === SCHEME) {
          const p = splitBundlePath(u.fsPath);
          if (p?.entry === "") keys.add(p.bundle);
        } else if (u.scheme === "file") keys.add(u.fsPath);
      }
    }
    for (const key of keys) {
      if (scriptIsOpen(key)) continue;
      if (key === this.key) this.set(undefined);
      await closeCompanions(key);
    }
  }

  private set(role: { bundle?: string; plain?: string } | undefined, script?: vscode.TextDocument): void {
    const bundle = role?.bundle;
    const plain = bundle ? undefined : role?.plain;
    const changed = bundle !== this.bundle || plain !== this.plain || script !== this.script;
    this.script = script;
    this.bundle = bundle;
    this.plain = plain;
    if (!changed) return;
    void vscode.commands.executeCommand("setContext", "highwater.inBundle", bundle !== undefined);
    void vscode.commands.executeCommand("setContext", "highwater.hasExtras", bundle !== undefined || plain !== undefined);
    void vscode.commands.executeCommand("setContext", "highwater.hasDocument", bundle !== undefined || plain !== undefined);
    this.#emitter.fire();
  }

  /** The script's document, opening it if needed (for comparing with a save). */
  async document(): Promise<vscode.TextDocument | undefined> {
    if (this.script && !this.script.isClosed) return this.script;
    if (this.bundle) return vscode.workspace.openTextDocument(toHighlandUri(this.bundle));
    if (this.plain) return vscode.workspace.openTextDocument(vscode.Uri.file(this.plain));
    return undefined;
  }

  dispose(): void {
    for (const d of this.#subscriptions) d.dispose();
  }
}

let focused: FocusedDocument | undefined;

/** The one focused-document tracker (made on first use, disposed with the extension). */
export function focusedDocument(context?: vscode.ExtensionContext): FocusedDocument {
  if (!focused) {
    focused = new FocusedDocument();
    context?.subscriptions.push(focused, { dispose: () => (focused = undefined) });
  }
  return focused;
}
