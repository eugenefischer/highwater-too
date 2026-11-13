import * as vscode from "vscode";
import { postTo } from "./highland-editor/messages.ts";

/**
 * Where the writer is writing: a VS Code text editor or a Highwater Editor. The panes,
 * status bar and Preview ask this module, not `vscode.window.activeTextEditor`, so they follow
 * either kind of editor.
 */

/** The view type of the Highwater Editor. */
export const HIGHLAND_EDITOR = "highwater.highlandEditor";

/**
 * Scripts open in the Highwater Editor. The end-to-end tests that drive VS Code's text editor turn
 * this off (highwater.test.textEditorDefault); nothing else does.
 */
export const editorDefaults = { highwater: true };

/**
 * Opens a document in the Highwater Editor (in place of its text tab, if that is in front), or
 * brings its Highwater Editor to the front; resolves to the view once it exists. Set by the provider.
 */
export const highwaterOpener: { open(doc: vscode.TextDocument): Promise<HighlandView | undefined> } = { open: async () => undefined };

/** A Highwater Editor showing a document, as its provider reports it. */
export interface HighlandView {
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  /** Selections as offsets in the document. */
  selections: readonly { anchor: number; head: number }[];
  /** The offset at the top of the visible text. */
  top: number;
  /** True once the page's script has started and holds the text. */
  ready: boolean;
  /** Comparing with a save: the text can't be changed meanwhile. */
  comparing: boolean;
  /** Preview mode: how many times the pages were laid out and sent (for the tests). */
  pagesSent: number;
  /** Flips between the text and the printed pages (⌘E). */
  togglePreview(): void;
  /** Sets the selections (offsets in the document as it is now). */
  select(ranges: readonly { anchor: number; head: number }[]): void;
  /** Scrolls to an offset (at the top, or centred if out of view); with `select`, puts the cursor there and focuses the editor. */
  reveal(offset: number, how: "top" | "center", select: boolean): void;
  /** Opens a sidebar panel (held until the page has started). */
  showPanel(name: "history"): void;
  /** Compares the text with a save, as the Writing History's Compare does (held until the page has started). */
  compareWith(hash: string, at: Date): void;
}

const views = new Set<HighlandView>();
const activeEmitter = new vscode.EventEmitter<void>();
const selectionEmitter = new vscode.EventEmitter<vscode.TextDocument>();
const scrollEmitter = new vscode.EventEmitter<HighlandView>();

/** Fires when the active editor may have changed (text editor or Highwater Editor). */
export const onDidChangeActiveSurface = activeEmitter.event;
/** Fires when the selection changes in a Highwater Editor. */
export const onDidChangeViewSelection = selectionEmitter.event;
/** Fires when a Highwater Editor scrolls. */
export const onDidScrollView = scrollEmitter.event;

/** Called by the Highwater Editor's provider. */
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
  /** The view's document was reopened (a new language): what follows it should look again. */
  changed(_view: HighlandView): void {
    activeEmitter.fire();
  },
};

/** Starts forwarding VS Code's own editor events. */
export function registerSurface(context: vscode.ExtensionContext): void {
  // highwater.docLang: the language of the document being written, in either editor, for menus
  // (editorLangId is empty while a custom editor has the focus).
  let lang: string | undefined;
  const setLang = () => {
    const now = activeDocument()?.languageId ?? "";
    if (now === lang) return;
    lang = now;
    void vscode.commands.executeCommand("setContext", "highwater.docLang", now);
  };
  setLang();
  context.subscriptions.push(
    activeEmitter.event(setLang),
    vscode.workspace.onDidOpenTextDocument(setLang), // a language change reopens the document
    activeEmitter,
    selectionEmitter,
    scrollEmitter,
    vscode.window.onDidChangeActiveTextEditor(() => activeEmitter.fire()),
    vscode.window.tabGroups.onDidChangeTabGroups(() => activeEmitter.fire()),
    vscode.window.tabGroups.onDidChangeTabs(() => activeEmitter.fire()),
  );
}

/** The Highwater Editor in the active tab of the active editor group, if that is one. */
export function activeView(): HighlandView | undefined {
  const group = vscode.window.tabGroups.activeTabGroup;
  const input = group.activeTab?.input;
  if (!(input instanceof vscode.TabInputCustom) || input.viewType !== HIGHLAND_EDITOR) return undefined;
  const uri = input.uri.toString();
  const matching = [...views].filter((v) => v.document.uri.toString() === uri);
  return matching.find((v) => v.panel.viewColumn === group.viewColumn) ?? matching[0];
}

/** A visible Highwater Editor showing the document (the active one first); with `any`, a hidden one too. */
export function viewOf(doc: vscode.TextDocument, any = false): HighlandView | undefined {
  const active = activeView();
  if (active?.document === doc) return active;
  return [...views].find((v) => v.document === doc && v.panel.visible) ?? (any ? [...views].find((v) => v.document === doc) : undefined);
}

/**
 * Shows a document in the tab it's already open in (Highwater Editor or text; one tab per document),
 * else in a new Highwater Editor if that is the default, else in a text editor.
 */
export async function showDocument(doc: vscode.TextDocument, viewColumn?: vscode.ViewColumn): Promise<void> {
  const view = viewOf(doc, true);
  if (view) {
    view.panel.reveal(view.panel.viewColumn, false);
    return;
  }
  // Already open as text (the writer chose the text editor): go to that tab rather than open another.
  const uri = doc.uri.toString();
  const textTab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri);
  if (textTab) {
    await vscode.window.showTextDocument(doc, { viewColumn: textTab.group.viewColumn, preview: false });
    return;
  }
  // A script opens in the Highwater Editor (unless the end-to-end tests turned that off).
  // A .highland file's script counts even before VS Code has given it its language (it does so a
  // moment after opening): otherwise it would show as text first, then switch.
  const script = doc.languageId.startsWith("highland-") || (doc.uri.scheme === "highland" && /\.highland$/i.test(doc.uri.path));
  if (script && editorDefaults.highwater) {
    await vscode.commands.executeCommand("vscode.openWith", doc.uri, HIGHLAND_EDITOR, { viewColumn: viewColumn ?? vscode.ViewColumn.Active, preview: false });
    return;
  }
  await vscode.window.showTextDocument(doc, { viewColumn: viewColumn ?? vscode.ViewColumn.Active, preview: false });
}

/**
 * The document being written: the active Highwater Editor's, else the active text editor's.
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
 * Shows an offset of a document: in its Highwater Editor if one is visible, else in a visible
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
  if (view?.comparing) return void postTo(view.panel, { type: "compareRefused" });
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
 * Applies non-overlapping edits to the document in the active editor (text or Highwater Editor),
 * then sets its selections, given as offsets in the edited text.
 */
export async function editActive(doc: vscode.TextDocument, edits: readonly OffsetEdit[], selections?: readonly { anchor: number; head: number }[]): Promise<boolean> {
  const view = activeView();
  if (view && view.document === doc) {
    if (view.comparing) {
      postTo(view.panel, { type: "compareRefused" });
      return false;
    }
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
