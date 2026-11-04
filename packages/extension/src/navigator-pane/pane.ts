import * as vscode from "vscode";
import { pick } from "../ask.ts";
import type { FocusedDocument } from "../focus.ts";
import type { ParseCache } from "../language.ts";
import type { BundleStore } from "../store.ts";
import { activeOffsets, onDidChangeActiveSurface, onDidChangeViewSelection, revealOffset } from "../surface.ts";
import { blockAt, currentRow, moveBlock, NAVIGATOR_LABELS, NAVIGATOR_TYPES, navigatorItems, navigatorRows, parseFilters, type NavigatorFilters, type NavigatorRow } from "../syntax/navigator.ts";

export const NAVIGATOR_VIEW = "highwater.navigator";

/**
 * The Navigator (M15: Highland's look): a webview list of the focused document's scenes, sections
 * and the rest. Click to go there; drag a scene or section, with a line showing where it lands;
 * filter by words at the foot, or by kind with the eye (Highland's per-document toggles).
 */
export class NavigatorPane implements vscode.WebviewViewProvider {
  #view: vscode.WebviewView | undefined;
  #ready = false;
  #rows: NavigatorRow[] = [];
  #current = -1;
  #filters: NavigatorFilters = parseFilters(undefined);

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: BundleStore,
    private readonly cache: ParseCache,
    private readonly focused: FocusedDocument,
  ) {
    context.subscriptions.push(
      onDidChangeActiveSurface(() => this.#follow()),
      onDidChangeViewSelection(() => this.#follow()),
      vscode.window.onDidChangeTextEditorSelection(() => this.#follow()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    this.#ready = false;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.#html(view.webview, dist);
    view.webview.onDidReceiveMessage((msg: { type: string; start?: number; from?: number; to?: number | null }) => {
      if (msg.type === "ready") {
        this.#ready = true;
        this.refresh();
      } else if (msg.type === "reveal" && typeof msg.start === "number") void this.#reveal(msg.start);
      else if (msg.type === "move" && typeof msg.from === "number") void this.#move(msg.from, msg.to ?? null);
      else if (msg.type === "chooseTypes") void this.chooseFilters();
    });
    view.onDidChangeVisibility(() => view.visible && this.refresh());
    view.onDidDispose(() => (this.#view = undefined));
  }

  /** The document or its text changed: list it again. */
  refresh(): void {
    void this.#loadFilters().then(() => this.#post());
  }

  #post(): void {
    const view = this.#view;
    if (!view || !this.#ready) return;
    view.description = this.focused.key ? (this.focused.label.split(/[\\/]/).pop() ?? "") : "";
    const doc = this.focused.script;
    if (!doc) {
      this.#rows = [];
      void view.webview.postMessage({ type: "rows", rows: [], length: 0, current: -1, empty: "Open a screenplay or manuscript to see its scenes and sections here." });
      return;
    }
    const parsed = this.cache.get(doc);
    this.#rows = navigatorRows(parsed, navigatorItems(parsed, this.#filters));
    this.#current = this.#currentFor(doc);
    void view.webview.postMessage({ type: "rows", rows: this.#rows, length: parsed.source.length, current: this.#current, empty: "Nothing to list yet: scenes, sections, synopses, notes and markers appear here." });
  }

  #currentFor(doc: vscode.TextDocument): number {
    const active = activeOffsets();
    if (!active || active.document !== doc) return this.#current;
    return currentRow(this.#rows, active.selections[0]?.head ?? 0);
  }

  /** The cursor moved, or another editor came forward: highlight the row it's in. */
  #follow(): void {
    const doc = this.focused.script;
    if (!doc || !this.#view || !this.#ready) return;
    const now = this.#currentFor(doc);
    if (now === this.#current) return;
    this.#current = now;
    void this.#view.webview.postMessage({ type: "current", current: now });
  }

  async #reveal(start: number): Promise<void> {
    const doc = this.focused.script;
    if (doc) await revealOffset(doc, start, "top", true);
  }

  /** A scene, section or heading dropped before another one (or at the end, `to` null). */
  async #move(from: number, to: number | null): Promise<void> {
    const doc = this.focused.script;
    if (!doc) return;
    const parsed = this.cache.get(doc);
    const block = blockAt(parsed, from);
    const move = block && moveBlock(parsed.source, block, to);
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
    const chosen = await pick(picks, { canPickMany: true, title: "Show in the Navigator" });
    if (!chosen) return;
    const filters = Object.fromEntries(NAVIGATOR_TYPES.map((t) => [t, chosen.some((c) => c.type === t)])) as NavigatorFilters;
    await this.context.workspaceState.update(this.#key(), filters);
    this.refresh();
  }

  #key(): string {
    return `navigatorFilters:${this.focused.label}`;
  }

  async #loadFilters(): Promise<void> {
    const saved = this.context.workspaceState.get<NavigatorFilters>(this.#key());
    if (saved) {
      this.#filters = { ...parseFilters(undefined), ...saved };
      return;
    }
    let json: string | undefined;
    if (this.focused.bundle) json = (await this.store.snapshot(this.focused.bundle).catch(() => null))?.getText("navigatorFilters.json");
    this.#filters = parseFilters(json);
  }

  #html(webview: vscode.Webview, dist: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "navigator.js"));
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
html, body { height: 100%; margin: 0; padding: 0; }
body { display: flex; flex-direction: column; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-sideBar-foreground, var(--vscode-foreground)); }
#wrap { position: relative; flex: 1; min-height: 0; display: flex; }
#list { flex: 1; overflow-y: auto; padding: 4px 0; outline: none; }
.row { padding: 4px 10px; line-height: 1.35; cursor: pointer; border-radius: 3px; margin: 0 6px; overflow-wrap: anywhere; user-select: none; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.current { background: var(--vscode-list-inactiveSelectionBackground); color: var(--vscode-list-inactiveSelectionForeground, inherit); }
.row.dragging { opacity: 0.4; }
body.dragging, body.dragging .row { cursor: grabbing; }
.row[data-draggable="true"] { touch-action: none; }
/* As in Highland: scene headings in bold capitals, sections bold, the rest quieter. */
.sceneHeaders { font-weight: 600; font-size: 0.92em; letter-spacing: 0.02em; }
.sectionHeaders { font-weight: 700; color: var(--vscode-textLink-foreground); }
.synopses, .notes, .images, .links, .referenceLinks, .includedFiles { color: var(--vscode-descriptionForeground); font-size: 0.92em; }
.synopses, .notes { font-style: italic; }
.markers { color: var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground)); font-size: 0.92em; }
.markers::before { content: "◆ "; font-size: 0.8em; }
#drop { position: absolute; right: 6px; height: 2px; background: var(--vscode-focusBorder); pointer-events: none; }
#drop::before { content: ""; position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-focusBorder); }
#empty { position: absolute; top: 0; left: 0; right: 0; padding: 8px 16px; color: var(--vscode-descriptionForeground); }
#foot { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
#filter { flex: 1; min-width: 0; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 3px 6px; }
#filter:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
#types { display: flex; padding: 3px; border: none; border-radius: 3px; background: none; color: var(--vscode-icon-foreground, inherit); cursor: pointer; }
#types:hover { background: var(--vscode-toolbar-hoverBackground); }
</style></head>
<body>
<div id="wrap"><div id="list" tabindex="0"></div><div id="empty" hidden></div><div id="drop" hidden></div></div>
<div id="foot">
<input id="filter" type="search" placeholder="Filter" aria-label="Filter the Navigator">
<button id="types" title="Show in the Navigator…" aria-label="Show in the Navigator…"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.4 3 1.6 5.4.5 8c1.1 2.6 3.9 5 7.5 5s6.4-2.4 7.5-5C14.4 5.4 11.6 3 8 3zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button>
</div>
<script nonce="${nonce}" src="${script}"></script>
</body></html>`;
  }
}
