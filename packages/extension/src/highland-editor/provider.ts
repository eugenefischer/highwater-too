import * as vscode from "vscode";
import { toHighlandUri } from "../fs-provider.ts";
import { MODES } from "../language.ts";
import { lineAndCharacter, offsetOf, pageForm } from "./offsets.ts";
import { askText } from "../ask.ts";
import { activeView, HIGHLAND_EDITOR, highlandViews, revealOffset, viewOf, type HighlandView } from "../surface.ts";

export { HIGHLAND_EDITOR };

/**
 * The Highland-style editor (M15, experimental): a custom text editor over the same document as
 * VS Code's editor, so saving, the writing history and the panes work as before. Opened with
 * Reopen Editor With… or Open in Highland-Style Editor; the text editor stays one click away.
 */
export class HighlandEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    // A .highland file itself is a zip: edit its script through the highland: file system instead.
    if (document.uri.scheme === "file" && /\.highland$/i.test(document.uri.fsPath)) {
      const column = panel.viewColumn;
      panel.dispose();
      void vscode.commands.executeCommand("vscode.openWith", toHighlandUri(document.uri.fsPath), HIGHLAND_EDITOR, column);
      return;
    }
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    panel.webview.html = this.html(panel.webview, dist);

    /** The text the page holds ("\n" line breaks), to tell its own edits from changes made elsewhere. */
    let pageText = pageForm(document.getText());
    let queue: Promise<unknown> = Promise.resolve();
    const changedElsewhere = () => pageForm(document.getText()) !== pageText;
    // Offsets in the page's text and in the document differ in a file with "\r\n" line breaks.
    const crlf = () => document.eol === vscode.EndOfLine.CRLF;
    const positionIn = (text: string, offset: number) => {
      const p = lineAndCharacter(text, offset);
      return new vscode.Position(p.line, p.character);
    };
    const toDocument = (offset: number) => (crlf() ? document.offsetAt(positionIn(pageText, offset)) : offset);
    const toPage = (offset: number) => {
      if (!crlf()) return offset;
      const p = document.positionAt(offset);
      return offsetOf(pageText, p.line, p.character);
    };

    const view: HighlandView = {
      document,
      panel,
      selections: [{ anchor: 0, head: 0 }],
      top: 0,
      ready: false,
      select: (ranges) => {
        // The page must hold the edited text before it can select in it.
        if (changedElsewhere()) send();
        if (view.ready) void panel.webview.postMessage({ type: "select", ranges: ranges.map((r) => ({ anchor: toPage(r.anchor), head: toPage(r.head) })) });
      },
      reveal: (offset, how, select) => {
        const msg = { type: "reveal", offset: toPage(offset), how, select };
        // The page drops messages sent before its script has started: hold the latest until it has.
        if (view.ready) void panel.webview.postMessage(msg);
        else pendingReveal = msg;
      },
    };
    let pendingReveal: object | undefined;

    const send = () => {
      pageText = pageForm(document.getText());
      void panel.webview.postMessage({ type: "update", text: pageText });
    };
    const subscriptions = [
      highlandViews.add(view),
      panel.webview.onDidReceiveMessage((msg: { type: string; changes?: { from: number; to: number; insert: string }[]; ranges?: { anchor: number; head: number }[]; top?: number }) => {
        if (msg.type === "ready") {
          pageText = pageForm(document.getText());
          void panel.webview.postMessage({ type: "init", text: pageText, mode: MODES.get(document.languageId) ?? "fountain" });
          view.ready = true;
          if (pendingReveal) void panel.webview.postMessage(pendingReveal);
          pendingReveal = undefined;
        } else if (msg.type === "selection" && msg.ranges) {
          view.selections = msg.ranges.map((r) => ({ anchor: toDocument(r.anchor), head: toDocument(r.head) }));
          highlandViews.selected(view);
        } else if (msg.type === "scroll" && typeof msg.top === "number") {
          view.top = toDocument(msg.top);
          highlandViews.scrolled(view);
        } else if (msg.type === "edit" && msg.changes) {
          const changes = msg.changes;
          // Where each change goes, by line and character in the text before it (the document's
          // line breaks don't matter then; VS Code gives inserted "\n" the document's own).
          const before = pageText;
          const ranges = changes.map((c) => new vscode.Range(positionIn(before, c.from), positionIn(before, c.to)));
          // The page's text after its edit; the document should match once the edit is applied.
          for (const c of [...changes].reverse()) pageText = pageText.slice(0, c.from) + c.insert + pageText.slice(c.to);
          queue = queue.then(async () => {
            const edit = new vscode.WorkspaceEdit();
            changes.forEach((c, i) => edit.replace(document.uri, ranges[i]!, c.insert));
            await vscode.workspace.applyEdit(edit);
            if (changedElsewhere()) send();
          });
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document !== document || e.contentChanges.length === 0) return;
        if (changedElsewhere()) send();
      }),
    ];
    panel.onDidDispose(() => subscriptions.forEach((s) => s.dispose()));
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "highland-editor.js"));
    const font = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, "fonts", f));
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
@font-face { font-family: "Courier Prime"; src: url("${font("CourierPrime-Regular.ttf")}"); }
@font-face { font-family: "Courier Prime"; font-weight: bold; src: url("${font("CourierPrime-Bold.ttf")}"); }
@font-face { font-family: "Courier Prime"; font-style: italic; src: url("${font("CourierPrime-Italic.ttf")}"); }
@font-face { font-family: "Courier Prime"; font-weight: bold; font-style: italic; src: url("${font("CourierPrime-BoldItalic.ttf")}"); }
:root { --column: 63ch; --column-min: 0ch; }
html, body { height: 100%; margin: 0; padding: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
#editor, .cm-editor { height: 100%; }
.cm-editor { font-size: calc(var(--vscode-editor-font-size, 14px) * 1.1); }
.cm-editor.cm-focused { outline: none; }
/* !important: CodeMirror's own theme, injected later, sets these with equal specificity. */
.cm-editor .cm-scroller { font-family: "Courier Prime", monospace !important; line-height: 1.5; }
/* The page column: as wide as the printed text, centred in the window. As in Highland, a narrower window
   narrows it down to the right edge of dialogue (--column-min) and no further: past that the page scrolls sideways. */
.cm-editor .cm-content { flex: 0 1 var(--column) !important; width: var(--column); max-width: calc(100% - 2ch); min-width: var(--column-min); margin: 0 auto; box-sizing: content-box; padding: 3em 1ch; caret-color: var(--vscode-editorCursor-foreground); }
/* More specific than CodeMirror's own line padding; each line's indent is set inline. */
.cm-editor .cm-content .cm-line { padding: 0; }
.cm-editor .cm-searchMatch { background: var(--vscode-editor-findMatchHighlightBackground); outline: 1px solid var(--vscode-editor-findMatchHighlightBorder, transparent); }
.cm-editor .cm-searchMatch-selected, .cm-editor .cm-searchMatch-selected * { background: var(--vscode-editor-findMatchBackground); outline: 1px solid var(--vscode-editor-findMatchBorder, transparent); }
.cm-selectionBackground, .cm-content ::selection { background: var(--vscode-editor-selectionBackground) !important; }
.hl-scene { font-weight: bold; color: var(--vscode-textLink-foreground); }
.hl-cue { }
.hl-right { text-align: right; }
.hl-center { text-align: center; }
.hl-lyric { font-style: italic; }
.hl-section, .hl-synopsis, .hl-directive, .hl-pageBreak, .hl-boneyard { color: var(--vscode-descriptionForeground); }
.hl-title { color: var(--vscode-descriptionForeground); }
.hl-heading { font-weight: bold; }
.hl-quote { font-style: italic; }
/* Emphasis, notes and omitted text where they stand. */
.hl-bold { font-weight: bold; }
.hl-italic { font-style: italic; }
.hl-boldItalic { font-weight: bold; font-style: italic; }
.hl-underline { text-decoration: underline; }
.hl-strike { text-decoration: line-through; }
.hl-highlight { background: rgba(252, 255, 38, 0.35); }
.hl-note, .hl-omitted { color: var(--vscode-descriptionForeground); }
.hl-note { font-style: italic; }
/* Completion, in VS Code's suggestion colours. */
.cm-editor .cm-tooltip { background: var(--vscode-editorSuggestWidget-background); color: var(--vscode-editorSuggestWidget-foreground); border: 1px solid var(--vscode-editorSuggestWidget-border, transparent); }
.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul { font-family: "Courier Prime", monospace; max-height: 14em; }
.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li { padding: 1px 6px; }
.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] { background: var(--vscode-editorSuggestWidget-selectedBackground) !important; color: var(--vscode-editorSuggestWidget-selectedForeground, inherit) !important; }
.cm-editor .cm-completionMatchedText { text-decoration: none; font-weight: bold; color: var(--vscode-editorSuggestWidget-highlightForeground); }
.cm-editor .cm-completionDetail { margin-left: 1.5em; font-style: normal; color: var(--vscode-descriptionForeground); }
.cm-panels { background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground); }
</style></head>
<body><div id="editor"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

/**
 * Switches the active tab between the text editor and the Highland-Style Editor in place, as
 * Reopen Editor With… does: one tab per document, and no save-or-discard question for unsaved
 * changes (two tabs of a document in different editors would each ask on closing).
 */
/** True while a swap is under way: its new tab must not be taken for a second one. */
let swapping = false;

async function swapActive(target: vscode.Uri, viewType: string): Promise<void> {
  swapping = true;
  try {
    await swapInPlace(target, viewType);
  } finally {
    // The old tab closes just after the command returns.
    setTimeout(() => (swapping = false), 500);
  }
}

async function swapInPlace(target: vscode.Uri, viewType: string): Promise<void> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  const active = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri.toString() : undefined;
  if (active === target.toString()) {
    try {
      await vscode.commands.executeCommand("reopenActiveEditorWith", viewType);
      return;
    } catch {
      // An older VS Code without the command: open beside instead.
    }
  }
  await vscode.commands.executeCommand("vscode.openWith", target, viewType);
}

/** Opens the active document in the Highland-style editor, or back in the text editor. */
export function registerHighlandEditor(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HIGHLAND_EDITOR, new HighlandEditorProvider(context), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("highwater.openHighlandEditor", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await swapActive(target, HIGHLAND_EDITOR);
    }),
    // ⌃G: VS Code's Go to Line only reaches text editors.
    vscode.commands.registerCommand("highwater.goToLine", async () => {
      const view = activeView();
      if (!view) return;
      const doc = view.document;
      const current = doc.positionAt(view.selections[0]?.head ?? 0).line + 1;
      const answer = await askText({
        title: "Go to Line",
        prompt: `Current line ${current}. Type a line number between 1 and ${doc.lineCount}.`,
        validateInput: (v) => (/^\s*\d+\s*$/.test(v) && +v >= 1 && +v <= doc.lineCount ? null : `A line number between 1 and ${doc.lineCount}`),
      });
      if (!answer) return;
      await revealOffset(doc, doc.offsetAt(new vscode.Position(+answer - 1, 0)), "center", true);
    }),
    vscode.commands.registerCommand("highwater.openTextEditor", async (uri?: vscode.Uri) => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const target = uri ?? (tab?.input instanceof vscode.TabInputCustom ? tab.input.uri : undefined);
      if (target) await swapActive(target, "default");
    }),
    // A script opened in the text editor (from Search, say) while it is open in the Highland-Style
    // Editor: show it there instead, at the same place, so there is one tab per document. Only when it has no unsaved
    // changes, as closing a tab of a changed document asks to save or discard.
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      if (swapping) return;
      for (const opened of e.opened) {
        if (!(opened.input instanceof vscode.TabInputText)) continue;
        const uri = opened.input.uri.toString();
        // Look again once things settle: a swap or a closing tab may be under way.
        setTimeout(() => {
          if (swapping) return;
          const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri);
          if (!tab || tab.isDirty) return;
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
          const view = doc && viewOf(doc, true);
          if (!view) return;
          // Where the text editor was opened to (a search result's line), to show the same place.
          const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
          const at = editor ? doc.offsetAt(editor.selection.active) : undefined;
          void vscode.window.tabGroups.close(tab).then(() => {
            view.panel.reveal(view.panel.viewColumn, false);
            if (at !== undefined) view.reveal(at, "center", true);
          });
        }, 300);
      }
    }),
  );
}
