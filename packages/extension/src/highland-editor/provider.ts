import * as vscode from "vscode";
import { toHighlandUri } from "../fs-provider.ts";
import { MODES } from "../language.ts";
import { lineAndCharacter, offsetOf, pageForm } from "./offsets.ts";
import { HIGHLAND_THEMES, pageColors, themeFor } from "./themes.ts";
import { askText } from "../ask.ts";
import { roleOf } from "../focus.ts";
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

    // The text size (highwater.fontSize; 0 follows VS Code's editor size).
    const sendFontSize = () => void panel.webview.postMessage({ type: "fontSize", px: vscode.workspace.getConfiguration("highwater").get<number>("fontSize", 0) || null });
    // A Highland theme for the page (highwater.theme), or VS Code's colours.
    const sendTheme = () => {
      const theme = themeFor(vscode.workspace.getConfiguration("highwater").get<string>("theme"));
      void panel.webview.postMessage({ type: "theme", vars: theme ? pageColors(theme) : null });
    };
    // Show Invisibles follows the text editor's whitespace setting for the document's language.
    const sendInvisibles = () =>
      void panel.webview.postMessage({ type: "invisibles", on: vscode.workspace.getConfiguration("editor", document).get<string>("renderWhitespace", "none") !== "none" });
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
          sendInvisibles();
          sendTheme();
          sendFontSize();
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
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (view.ready && e.affectsConfiguration("editor.renderWhitespace", document)) sendInvisibles();
        if (view.ready && e.affectsConfiguration("highwater.theme")) sendTheme();
        if (view.ready && e.affectsConfiguration("highwater.fontSize")) sendFontSize();
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
:root {
  --column: 63ch; --column-min: 0ch;
  /* The page's colours: VS Code's, unless a Highland theme (highwater.theme) sets these on the page. */
  --hl-bg: var(--vscode-editor-background); --hl-fg: var(--vscode-editor-foreground);
  --hl-scene: var(--vscode-textLink-foreground); --hl-note: var(--vscode-descriptionForeground); --hl-muted: var(--vscode-descriptionForeground);
  --hl-caret: var(--vscode-editorCursor-foreground); --hl-selection: var(--vscode-editor-selectionBackground);
  --hl-match: var(--vscode-editor-findMatchHighlightBackground); --hl-match-current: var(--vscode-editor-findMatchBackground);
  --hl-panel-bg: var(--vscode-editorWidget-background); --hl-panel-fg: var(--vscode-editorWidget-foreground);
  --hl-input-bg: var(--vscode-input-background); --hl-border: var(--vscode-input-border, var(--vscode-editorWidget-border, transparent));
  --hl-accent: var(--vscode-button-background); --hl-accent-fg: var(--vscode-button-foreground);
  --hl-whitespace: var(--vscode-editorWhitespace-foreground);
}
html, body { height: 100%; margin: 0; padding: 0; background: var(--hl-bg); color: var(--hl-fg); }
#editor, .cm-editor { height: 100%; }
/* The text size: highwater.fontSize, or by default VS Code's editor size scaled to Highland 2's (about 1.4 times). */
.cm-editor { font-size: var(--hl-font-size, calc(var(--vscode-editor-font-size, 14px) * 1.4)); }
.cm-editor.cm-focused { outline: none; }
/* !important: CodeMirror's own theme, injected later, sets these with equal specificity. */
/* Line spacing as Highland 2's (measured: 1.3 times the text size). */
.cm-editor .cm-scroller { font-family: "Courier Prime", monospace !important; line-height: 1.3; }
/* The page column: as wide as the printed text, centred in the window. As in Highland, a narrower window
   narrows it down to the right edge of dialogue (--column-min) and no further: past that the page scrolls sideways. */
.cm-editor .cm-content { flex: 0 1 var(--column) !important; width: var(--column); max-width: calc(100% - 2ch); min-width: var(--column-min); margin: 0 auto; box-sizing: content-box; padding: 3em 1ch; caret-color: var(--hl-caret); }
/* More specific than CodeMirror's own line padding; each line's indent is set inline. */
.cm-editor .cm-content .cm-line { padding: 0; }
.cm-editor .cm-searchMatch { background: var(--hl-match); outline: 1px solid var(--vscode-editor-findMatchHighlightBorder, transparent); }
.cm-editor .cm-searchMatch-selected, .cm-editor .cm-searchMatch-selected * { background: var(--hl-match-current); outline: 1px solid var(--vscode-editor-findMatchBorder, transparent); }
.cm-selectionBackground, .cm-content ::selection { background: var(--hl-selection) !important; }
.hl-scene { font-weight: bold; color: var(--hl-scene); }
.hl-right { text-align: right; }
.hl-center { text-align: center; }
.hl-lyric { font-style: italic; }
.hl-section, .hl-synopsis, .hl-directive, .hl-pageBreak, .hl-boneyard, .hl-title { color: var(--hl-muted); }
.hl-heading { font-weight: bold; }
.hl-quote { font-style: italic; }
/* Emphasis, notes and omitted text where they stand. */
.hl-bold { font-weight: bold; }
.hl-italic { font-style: italic; }
.hl-boldItalic { font-weight: bold; font-style: italic; }
.hl-underline { text-decoration: underline; }
.hl-strike { text-decoration: line-through; }
.hl-highlight { background: rgba(252, 255, 38, 0.35); }
.hl-note { color: var(--hl-note); font-style: italic; }
.hl-omitted { color: var(--hl-muted); }
/* Show Invisibles. */
.hl-eol { color: var(--hl-whitespace); }
.cm-editor .cm-highlightSpace { background-image: radial-gradient(circle at 50% 55%, var(--hl-whitespace) 15%, transparent 5%); }
.cm-editor .cm-highlightTab { background-image: none; position: relative; }
.cm-editor .cm-highlightTab::before { content: "→"; position: absolute; left: 0; color: var(--hl-whitespace); }
/* Completion. */
.cm-editor .cm-tooltip { background: var(--hl-panel-bg); color: var(--hl-panel-fg); border: 1px solid var(--hl-border); }
.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul { font-family: "Courier Prime", monospace; max-height: 14em; }
.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li { padding: 1px 6px; }
.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] { background: var(--hl-selection) !important; color: inherit !important; }
.cm-editor .cm-completionMatchedText { text-decoration: none; font-weight: bold; color: var(--hl-scene); }
.cm-editor .cm-completionDetail { margin-left: 1.5em; font-style: normal; color: var(--hl-muted); }
/* The Find bar, in the page's colours rather than CodeMirror's grey. */
.cm-editor .cm-panels { background: var(--hl-panel-bg); color: var(--hl-panel-fg); border-color: var(--hl-border); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
.cm-editor .cm-panels.cm-panels-top { border-bottom: 1px solid var(--hl-border); }
.cm-editor .cm-panel.cm-search { padding: 6px 28px 6px 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cm-editor .cm-panel.cm-search br { display: none; }
.cm-editor .cm-panel.cm-search label { font-size: inherit; display: inline-flex; align-items: center; gap: 3px; color: var(--hl-panel-fg); }
.cm-editor .cm-textfield { font: inherit; color: var(--hl-fg); background: var(--hl-input-bg); border: 1px solid var(--hl-border); border-radius: 3px; padding: 3px 6px; margin: 0; }
.cm-editor .cm-textfield:focus { outline: 1px solid var(--hl-accent); outline-offset: -1px; }
.cm-editor .cm-button { font: inherit; color: var(--hl-panel-fg); background: none; background-image: none; border: 1px solid var(--hl-border); border-radius: 3px; padding: 2px 8px; margin: 0; }
.cm-editor .cm-button:hover { background: var(--hl-selection); }
.cm-editor .cm-button[name="next"] { background: var(--hl-accent); color: var(--hl-accent-fg); border-color: transparent; }
.cm-editor .cm-panel.cm-search [name="close"] { color: var(--hl-panel-fg); font-size: 1.3em; top: 4px; right: 6px; }
.cm-editor .cm-panel.cm-search input[type="checkbox"] { accent-color: var(--hl-accent); }
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
/** Documents the writer switched to the text editor with the code button: left as text until closed. */
const wantsText = new Set<string>();

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

/** One step of text size, from the size shown now (VS Code's editor size × 1.4 when not set). */
async function zoom(step: number): Promise<void> {
  const config = vscode.workspace.getConfiguration("highwater");
  const now = config.get<number>("fontSize", 0) || Math.round(vscode.workspace.getConfiguration("editor").get<number>("fontSize", 14) * DEFAULT_SCALE);
  const next = Math.max(MIN_FONT, Math.min(MAX_FONT, now + step));
  await config.update("fontSize", next, vscode.ConfigurationTarget.Global);
  vscode.window.setStatusBarMessage(`Highland-Style Editor text: ${next} px (⌥⌘0 resets)`, 2500);
}
const DEFAULT_SCALE = 1.4;
const MIN_FONT = 8;
const MAX_FONT = 48;

/**
 * Turns a script's text tab into the Highland-Style Editor (the default) once things settle, if it
 * is still the active tab: a .md file is given its Highwater language just after it opens.
 */
function swapSoon(uri: vscode.Uri): void {
  setTimeout(() => {
    if (swapping || wantsText.has(uri.toString())) return;
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!(active?.input instanceof vscode.TabInputText) || active.input.uri.toString() !== uri.toString()) return;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (!doc || !doc.languageId.startsWith("highland-") || roleOf(doc).kind !== "script" || viewOf(doc, true)) return;
    void swapActive(uri, HIGHLAND_EDITOR);
  }, 300);
}

/** Opens the active document in the Highland-style editor, or back in the text editor. */
export function registerHighlandEditor(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HIGHLAND_EDITOR, new HighlandEditorProvider(context), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("highwater.openHighlandEditor", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await swapActive(target, HIGHLAND_EDITOR);
    }),
    // Highland's themes, tried out as you move through the list (Escape puts the old one back).
    vscode.commands.registerCommand("highwater.chooseTheme", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      const before = config.get<string>("theme", "vscode");
      const items = [
        { label: "Match VS Code", description: "your VS Code colour theme", id: "vscode" },
        ...Object.entries(HIGHLAND_THEMES).map(([id, t]) => ({ label: t.name, description: t.mode, id })),
      ];
      const quick = vscode.window.createQuickPick<(typeof items)[number]>();
      quick.title = "Theme for the Highland-Style Editor and the Navigator";
      quick.items = items;
      quick.activeItems = items.filter((i) => i.id === before);
      let chosen = false;
      quick.onDidChangeActive((active) => {
        const id = active[0]?.id;
        if (id) void config.update("theme", id, vscode.ConfigurationTarget.Global);
      });
      quick.onDidAccept(() => {
        chosen = true;
        quick.hide();
      });
      quick.onDidHide(() => {
        if (!chosen) void config.update("theme", before, vscode.ConfigurationTarget.Global);
        quick.dispose();
      });
      quick.show();
    }),
    // ⌘+ and ⌘−: the text size, as Highland's zoom (the page column grows with it); ⌥⌘0 goes back.
    vscode.commands.registerCommand("highwater.zoomIn", () => zoom(+1)),
    vscode.commands.registerCommand("highwater.zoomOut", () => zoom(-1)),
    vscode.commands.registerCommand("highwater.zoomReset", () => vscode.workspace.getConfiguration("highwater").update("fontSize", 0, vscode.ConfigurationTarget.Global)),
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
      if (!target) return;
      wantsText.add(target.toString()); // not switched back by the default below
      await swapActive(target, "default");
    }),
    // The Highland-Style Editor is the default (highwater.highlandEditor): a script opened as text
    // becomes a Highland-Style tab, unless the writer chose the text editor for it with the code button.
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const closed of e.closed) {
        const input = closed.input;
        if (!(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)) continue;
        const uri = input.uri.toString();
        const still = vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => (t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputCustom) && t.input.uri.toString() === uri);
        if (!still) wantsText.delete(uri);
      }
      if (swapping || !vscode.workspace.getConfiguration("highwater").get<boolean>("highlandEditor", true)) return;
      for (const opened of e.opened) {
        // Not opened.isActive: a tab is usually reported active only in a later event. Checked below.
        if (!(opened.input instanceof vscode.TabInputText)) continue;
        swapSoon(opened.input.uri);
      }
    }),
    // Also when a script's text tab comes to the front: the tab events don't always say it is active.
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e && vscode.workspace.getConfiguration("highwater").get<boolean>("highlandEditor", true)) swapSoon(e.document.uri);
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
