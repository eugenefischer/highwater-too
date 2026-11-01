import * as vscode from "vscode";
import { toHighlandUri } from "../fs-provider.ts";
import { MODES } from "../language.ts";
import { HIGHLAND_EDITOR, highlandViews, type HighlandView } from "../surface.ts";

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

    /** The text the page holds, to tell its own edits from changes made elsewhere. */
    let pageText = document.getText();
    let queue: Promise<unknown> = Promise.resolve();

    const view: HighlandView = {
      document,
      panel,
      selections: [{ anchor: 0, head: 0 }],
      top: 0,
      ready: false,
      reveal: (offset, how, select) => {
        const msg = { type: "reveal", offset, how, select };
        // The page drops messages sent before its script has started: hold the latest until it has.
        if (view.ready) void panel.webview.postMessage(msg);
        else pendingReveal = msg;
      },
    };
    let pendingReveal: object | undefined;

    const send = () => {
      pageText = document.getText();
      void panel.webview.postMessage({ type: "update", text: pageText });
    };
    const subscriptions = [
      highlandViews.add(view),
      panel.webview.onDidReceiveMessage((msg: { type: string; changes?: { from: number; to: number; insert: string }[]; ranges?: { anchor: number; head: number }[]; top?: number }) => {
        if (msg.type === "ready") {
          pageText = document.getText();
          void panel.webview.postMessage({ type: "init", text: pageText, mode: MODES.get(document.languageId) ?? "fountain" });
          view.ready = true;
          if (pendingReveal) void panel.webview.postMessage(pendingReveal);
          pendingReveal = undefined;
        } else if (msg.type === "selection" && msg.ranges) {
          view.selections = msg.ranges;
          highlandViews.selected(view);
        } else if (msg.type === "scroll" && typeof msg.top === "number") {
          view.top = msg.top;
          highlandViews.scrolled(view);
        } else if (msg.type === "edit" && msg.changes) {
          const changes = msg.changes;
          // The page's text after its edit; the document should match once the edit is applied.
          for (const c of [...changes].reverse()) pageText = pageText.slice(0, c.from) + c.insert + pageText.slice(c.to);
          queue = queue.then(async () => {
            const edit = new vscode.WorkspaceEdit();
            for (const c of changes) edit.replace(document.uri, new vscode.Range(document.positionAt(c.from), document.positionAt(c.to)), c.insert);
            await vscode.workspace.applyEdit(edit);
            if (document.getText() !== pageText) send();
          });
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document !== document || e.contentChanges.length === 0) return;
        if (document.getText() !== pageText) send();
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
.cm-panels { background: var(--vscode-editorWidget-background); color: var(--vscode-editorWidget-foreground); }
</style></head>
<body><div id="editor"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

/** Opens the active document in the Highland-style editor, or back in the text editor. */
export function registerHighlandEditor(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HIGHLAND_EDITOR, new HighlandEditorProvider(context), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("highwater.openHighlandEditor", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await vscode.commands.executeCommand("vscode.openWith", target, HIGHLAND_EDITOR);
    }),
    vscode.commands.registerCommand("highwater.openTextEditor", async (uri?: vscode.Uri) => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const target = uri ?? (tab?.input instanceof vscode.TabInputCustom ? tab.input.uri : undefined);
      if (target) await vscode.commands.executeCommand("vscode.openWith", target, "default");
    }),
  );
}
