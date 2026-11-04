import * as vscode from "vscode";

/**
 * Where the writer is writing: a VS Code text editor or a Highland-Style Editor (M15). The panes,
 * status bar and Preview ask this module, not `vscode.window.activeTextEditor`, so they follow
 * either kind of editor.
 */

/** The view type of the Highland-Style Editor. */
export const HIGHLAND_EDITOR = "highwater.highlandEditor";

/** A Highland-Style Editor showing a document, as its provider reports it. */
export interface HighlandView {
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  /** Selections as offsets in the document. */
  selections: readonly { anchor: number; head: number }[];
  /** The offset at the top of the visible text. */
  top: number;
  /** True once the page's script has started and holds the text. */
  ready: boolean;
  /** Sets the selections (offsets in the document as it is now). */
  select(ranges: readonly { anchor: number; head: number }[]): void;
  /** Scrolls to an offset (at the top, or centred if out of view); with `select`, puts the cursor there and focuses the editor. */
  reveal(offset: number, how: "top" | "center", select: boolean): void;
}

const views = new Set<HighlandView>();
const activeEmitter = new vscode.EventEmitter<void>();
const selectionEmitter = new vscode.EventEmitter<vscode.TextDocument>();
const scrollEmitter = new vscode.EventEmitter<HighlandView>();

/** Fires when the active editor may have changed (text editor or Highland-Style Editor). */
export const onDidChangeActiveSurface = activeEmitter.event;
/** Fires when the selection changes in a Highland-Style Editor. */
export const onDidChangeViewSelection = selectionEmitter.event;
/** Fires when a Highland-Style Editor scrolls. */
export const onDidScrollView = scrollEmitter.event;

/** Called by the Highland-Style Editor's provider. */
export const highlandViews = {
  add(view: HighlandView): vscode.Disposable {
    views.add(view);
    const state = view.panel.onDidChangeViewState(() => activeEmitter.fire());
    activeEmitter.fire();
    return new vscode.Disposable(() => {
      state.dispose();
      views.delete(view);
      activeEmitter.fire();
    });
  },
  selected(view: HighlandView): void {
    selectionEmitter.fire(view.document);
  },
  scrolled(view: HighlandView): void {
    scrollEmitter.fire(view);
  },
};

/** Starts forwarding VS Code's own editor events. */
export function registerSurface(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    activeEmitter,
    selectionEmitter,
    scrollEmitter,
    vscode.window.onDidChangeActiveTextEditor(() => activeEmitter.fire()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => activeEmitter.fire()),
    vscode.window.tabGroups.onDidChangeTabs(() => activeEmitter.fire()),
  );
}

/** The Highland-Style Editor in the active tab of the active editor group, if that is one. */
export function activeView(): HighlandView | undefined {
  const group = vscode.window.tabGroups.activeTabGroup;
  const input = group.activeTab?.input;
  if (!(input instanceof vscode.TabInputCustom) || input.viewType !== HIGHLAND_EDITOR) return undefined;
  const uri = input.uri.toString();
  const matching = [...views].filter((v) => v.document.uri.toString() === uri);
  return matching.find((v) => v.panel.viewColumn === group.viewColumn) ?? matching[0];
}

/** A visible Highland-Style Editor showing the document (the active one first); with `any`, a hidden one too. */
export function viewOf(doc: vscode.TextDocument, any = false): HighlandView | undefined {
  const active = activeView();
  if (active?.document === doc) return active;
  return [...views].find((v) => v.document === doc && v.panel.visible) ?? (any ? [...views].find((v) => v.document === doc) : undefined);
}

/**
 * Shows a document: in its Highland-Style Editor if it has one (one tab per document), else in a
 * text editor.
 */
export async function showDocument(doc: vscode.TextDocument, viewColumn?: vscode.ViewColumn): Promise<void> {
  const view = viewOf(doc, true);
  if (view) {
    view.panel.reveal(view.panel.viewColumn, false);
    return;
  }
  await vscode.window.showTextDocument(doc, { viewColumn: viewColumn ?? vscode.ViewColumn.Active, preview: false });
}

/**
 * The document being written: the active Highland-Style Editor's, else the active text editor's.
 * The view comes first: VS Code keeps `activeTextEditor` set to a text editor in another group
 * while a custom editor has the focus.
 */
export function activeDocument(): vscode.TextDocument | undefined {
  return activeView()?.document ?? vscode.window.activeTextEditor?.document;
}

/** The view column of whichever editor shows the active document. */
export function activeColumn(): vscode.ViewColumn | undefined {
  return activeView()?.panel.viewColumn ?? vscode.window.activeTextEditor?.viewColumn;
}

/** The active editor's selections as ranges (non-empty ones only with `nonEmpty`). */
export function activeSelections(): { document: vscode.TextDocument; ranges: vscode.Range[] } | undefined {
  const view = activeView();
  if (!view) {
    const editor = vscode.window.activeTextEditor;
    return editor ? { document: editor.document, ranges: [...editor.selections] } : undefined;
  }
  const doc = view.document;
  return { document: doc, ranges: view.selections.map((s) => new vscode.Range(doc.positionAt(Math.min(s.anchor, s.head)), doc.positionAt(Math.max(s.anchor, s.head)))) };
}

/** The offset at the top of whichever editor shows the document, if one is visible. */
export function visibleTop(doc: vscode.TextDocument): number | undefined {
  const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
  const top = editor?.visibleRanges[0];
  if (top) return doc.offsetAt(top.start);
  return viewOf(doc)?.top;
}

/**
 * Shows an offset of a document: in its Highland-Style Editor if one is visible, else in a visible
 * text editor. With `select`, puts the cursor there and focuses that editor (opening a text editor if
 * none shows the document).
 */
export async function revealOffset(doc: vscode.TextDocument, offset: number, how: "top" | "center", select: boolean): Promise<void> {
  const view = viewOf(doc);
  if (view) {
    if (select) view.panel.reveal(view.panel.viewColumn, false);
    view.reveal(offset, how, select);
    return;
  }
  let editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
  if (select) editor = await vscode.window.showTextDocument(doc, { ...(editor?.viewColumn ? { viewColumn: editor.viewColumn } : {}), preserveFocus: false });
  if (!editor) return; // only scrolling, and nothing shows the document
  const pos = doc.positionAt(offset);
  if (select) editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), how === "top" ? vscode.TextEditorRevealType.AtTop : vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** Replaces the selection in whichever editor shows the document (a text editor is opened if none is). */
export async function insertAtSelection(doc: vscode.TextDocument, text: string): Promise<void> {
  const view = viewOf(doc);
  if (view) {
    const s = view.selections[0] ?? { anchor: 0, head: 0 };
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(Math.min(s.anchor, s.head)), doc.positionAt(Math.max(s.anchor, s.head))), text);
    await vscode.workspace.applyEdit(edit);
    view.panel.reveal(view.panel.viewColumn, false);
    return;
  }
  const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc) ?? (await vscode.window.showTextDocument(doc));
  await editor.edit((e) => e.replace(editor.selection, text));
  await vscode.window.showTextDocument(editor.document, editor.viewColumn);
}

/** A replacement in a document, by offsets. */
export interface OffsetEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Applies non-overlapping edits to the document in the active editor (text or Highland-Style),
 * then sets its selections, given as offsets in the edited text.
 */
export async function editActive(doc: vscode.TextDocument, edits: readonly OffsetEdit[], selections?: readonly { anchor: number; head: number }[]): Promise<boolean> {
  const view = activeView();
  if (view && view.document === doc) {
    const edit = new vscode.WorkspaceEdit();
    for (const e of edits) edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
    if (!(await vscode.workspace.applyEdit(edit))) return false;
    if (selections) view.select(selections);
    return true;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== doc) return false;
  const ok = await editor.edit((b) => {
    for (const e of edits) b.replace(new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
  });
  if (ok && selections) editor.selections = selections.map((r) => new vscode.Selection(doc.positionAt(r.anchor), doc.positionAt(r.head)));
  return ok;
}

/** The active editor's selections as offsets, with the document. */
export function activeOffsets(): { document: vscode.TextDocument; selections: { anchor: number; head: number }[] } | undefined {
  const view = activeView();
  if (view) return { document: view.document, selections: [...view.selections] };
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  const doc = editor.document;
  return { document: doc, selections: editor.selections.map((s) => ({ anchor: doc.offsetAt(s.anchor), head: doc.offsetAt(s.active) })) };
}
