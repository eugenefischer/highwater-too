import * as vscode from "vscode";
import { toHighlandUri } from "../fs-provider.ts";
import { MODES } from "../language.ts";
import { SETTINGS_PREFIX, setTemplateOption, TEMPLATE_INFO, templateOptions } from "../template-options.ts";
import { onDidChangeTemplate, PRINT_OPTIONS, printOptionsOf, renderDocument, setPrintOption, setTemplate, templateOf, TEMPLATES, type PrintOption, type Template } from "../render-document.ts";
import { documentStats } from "../syntax/stats.ts";
import { onDidChangePageCount, pageCountOf } from "../page-count.ts";
import type { BundleStore } from "../store.ts";
import { parse } from "@highwater/parser";
import { paragraphNumbers } from "./line-styles.ts";
import { lineAndCharacter, offsetOf, pageForm } from "./offsets.ts";
import { colorThemeLabel, HIGHLAND_THEMES, pageColors, themeFor } from "./themes.ts";
import { askText } from "../ask.ts";
import { roleOf } from "../focus.ts";
import { activeOffsets, activeView, HIGHLAND_EDITOR, highlandViews, revealOffset, viewOf, type HighlandView } from "../surface.ts";

export { HIGHLAND_EDITOR };

/**
 * The Highland-style editor (M15, experimental): a custom text editor over the same document as
 * VS Code's editor, so saving, the writing history and the panes work as before. Opened with
 * Reopen Editor With… or Open in Highland-Style Editor; the text editor stays one click away.
 */
export class HighlandEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    /** The .highland files' store, for laying out the pages (made after this provider). */
    private readonly store: () => BundleStore,
  ) {}

  resolveCustomTextEditor(opened: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    // The document, kept current: giving a script its Highwater language closes it and opens a new
    // TextDocument for the same file, and the one VS Code passed here would go stale (its text no
    // longer changing), so the panes and the page would stop following the edits.
    let document = opened;
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
      get document() {
        return document;
      },
      panel,
      selections: [{ anchor: 0, head: 0 }],
      top: 0,
      ready: false,
      pagesSent: 0,
      togglePreview: () => void panel.webview.postMessage({ type: "togglePreview" }),
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
    /** Preview mode: the page shows the printed pages, laid out here. */
    let previewing = false;
    let layout = 0;
    const sendPages = async (at: number | null) => {
      const mine = ++layout;
      try {
        const rendered = await renderDocument(this.context, this.store(), document);
        if (mine !== layout || !previewing) return;
        if (!rendered) {
          void panel.webview.postMessage({ type: "previewEmpty", message: "Plain-text documents have no print template to preview." });
          return;
        }
        const print = await printOptionsOf(this.context, this.store(), document);
        // The anchors' offsets are the document's; the page counts "\r\n" as one character.
        const anchors = rendered.anchors.map((v, i) => (i % 3 === 2 ? toPage(v) : v));
        void panel.webview.postMessage({ type: "pdf", data: rendered.pdf, template: rendered.template, templates: TEMPLATES, anchors, problems: rendered.problems, print, at });
        view.pagesSent++;
      } catch (error) {
        if (mine === layout) void panel.webview.postMessage({ type: "previewEmpty", message: `Could not lay out the document: ${(error as Error).message}` });
      }
    };

    // Highland's paragraph numbers in the margin (highwater.paragraphNumbers).
    const sendNumbers = () => void panel.webview.postMessage({ type: "numbers", on: vscode.workspace.getConfiguration("highwater").get<boolean>("paragraphNumbers", false) });
    // The template window's options (settings for every document).
    const sendTemplateValues = () => void panel.webview.postMessage({ type: "templateValues", values: Object.fromEntries(TEMPLATE_INFO.map((t) => [t.name, templateOptions(t.name)])) });
    // The top bar's template menu, shown with the text too.
    const sendTemplate = async () => {
      const template = await templateOf(this.context, this.store(), document);
      void panel.webview.postMessage({ type: "template", template: template ?? "", templates: template ? TEMPLATES : [] });
    };
    // Highland's counts at the foot of the text: characters, words and pages (the print layout's, page-count.ts).
    let countsTimer: ReturnType<typeof setTimeout> | undefined;
    const sendCounts = () => {
      clearTimeout(countsTimer);
      countsTimer = setTimeout(() => {
        const stats = documentStats(parse(document.getText(), { mode: MODES.get(document.languageId) ?? "fountain" }));
        void panel.webview.postMessage({ type: "counts", characters: stats.characters, words: stats.words, pages: pageCountOf(document) ?? null });
      }, 300);
    };
    // Check Spelling While Typing (highwater.spellCheck) and the learned words.
    const sendSpelling = () => {
      const config = vscode.workspace.getConfiguration("highwater");
      void panel.webview.postMessage({ type: "spelling", on: config.get<boolean>("spellCheck", false), words: config.get<string[]>("spellingWords", []) });
    };
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
      panel.webview.onDidReceiveMessage((msg: { type: string; changes?: { from: number; to: number; insert: string }[]; ranges?: { anchor: number; head: number }[]; top?: number; at?: number | null; template?: string; key?: string; value?: boolean | string; kind?: string; word?: string }) => {
        if (msg.type === "ready") {
          pageText = pageForm(document.getText());
          void panel.webview.postMessage({ type: "init", text: pageText, mode: MODES.get(document.languageId) ?? "fountain" });
          view.ready = true;
          previewing = false;
          sendInvisibles();
          sendTheme();
          sendFontSize();
          sendNumbers();
          sendSpelling();
          void sendTemplate();
          sendCounts();
          if (pendingReveal) void panel.webview.postMessage(pendingReveal);
          pendingReveal = undefined;
        } else if (msg.type === "selection" && msg.ranges) {
          view.selections = msg.ranges.map((r) => ({ anchor: toDocument(r.anchor), head: toDocument(r.head) }));
          highlandViews.selected(view);
        } else if (msg.type === "preview") {
          previewing = true;
          void sendPages(typeof msg.at === "number" ? msg.at : null);
        } else if (msg.type === "previewClosed") previewing = false;
        else if (msg.type === "previewTemplate" && TEMPLATES.includes(msg.template as Template)) {
          void setTemplate(this.context, this.store(), document, msg.template as Template).catch((e: unknown) => void vscode.window.showErrorMessage(`Could not save the template: ${(e as Error).message}`));
        } else if (msg.type === "templateWindow") sendTemplateValues();
        else if (msg.type === "templateOption" && typeof msg.template === "string" && typeof msg.key === "string" && (typeof msg.value === "string" || typeof msg.value === "boolean")) {
          void setTemplateOption(msg.template, msg.key, msg.value).catch((e: unknown) => void vscode.window.showErrorMessage(`Could not save the template option: ${(e as Error).message}`));
        } else if (msg.type === "templateThumb" && TEMPLATES.includes(msg.template as Template)) {
          // The template window's page: the text's first page in that template (no title page).
          const template = msg.template as Template;
          void renderDocument(this.context, this.store(), document, template, true, false).then(
            (r) => void panel.webview.postMessage({ type: "templateThumb", template, data: r?.pdf ?? null, message: r ? "" : "No pages to show." }),
            (e: unknown) => void panel.webview.postMessage({ type: "templateThumb", template, data: null, message: `Could not lay out the text: ${(e as Error).message}` }),
          );
        } else if (msg.type === "printOption" && PRINT_OPTIONS.includes(msg.key as PrintOption)) {
          void setPrintOption(this.context, this.store(), document, msg.key as PrintOption, !!msg.value).catch((e: unknown) => void vscode.window.showErrorMessage(`Could not save the print option: ${(e as Error).message}`));
        } else if (msg.type === "previewSave") {
          void vscode.commands.executeCommand(msg.kind === "docx" ? "highwater.exportDocx" : "highwater.exportPdf", document.uri);
        } else if (msg.type === "chooseTheme") {
          void vscode.commands.executeCommand("highwater.chooseTheme");
        } else if (msg.type === "learnWord" && typeof msg.word === "string" && msg.word.trim()) {
          // Learn Spelling: kept in the writer's settings (all documents; Settings Sync carries it).
          const config = vscode.workspace.getConfiguration("highwater");
          const words = config.get<string[]>("spellingWords", []);
          if (!words.includes(msg.word)) void config.update("spellingWords", [...words, msg.word].sort((x, y) => x.localeCompare(y)), vscode.ConfigurationTarget.Global);
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
        if (view.ready && e.affectsConfiguration(SETTINGS_PREFIX)) sendTemplateValues();
        if (view.ready && e.affectsConfiguration("highwater.fontSize")) sendFontSize();
        if (view.ready && e.affectsConfiguration("highwater.paragraphNumbers")) sendNumbers();
        if (view.ready && (e.affectsConfiguration("highwater.spellCheck") || e.affectsConfiguration("highwater.spellingWords"))) sendSpelling();
      }),
      // A template or print option changed (here, or in the status bar): lay the pages out again.
      onDidChangePageCount((d) => {
        if (view.ready && d.uri.toString() === document.uri.toString()) sendCounts();
      }),
      onDidChangeTemplate((d) => {
        if (d.uri.toString() !== document.uri.toString()) return;
        if (view.ready) void sendTemplate();
        if (previewing) void sendPages(null);
      }),
      vscode.workspace.onDidOpenTextDocument((d) => {
        if (d.uri.toString() !== document.uri.toString() || d === document) return;
        const languageChanged = d.languageId !== document.languageId;
        document = d;
        highlandViews.changed(view);
        // A new language (a .md file made Highwater Markdown): the page lays the text out again.
        if (view.ready && languageChanged) {
          pageText = pageForm(document.getText());
          void panel.webview.postMessage({ type: "init", text: pageText, mode: MODES.get(document.languageId) ?? "fountain" });
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
        if (e.document !== document) document = e.document;
        if (changedElsewhere()) send();
        if (view.ready) sendCounts();
      }),
    ];
    panel.onDidDispose(() => {
      clearTimeout(countsTimer);
      subscriptions.forEach((s) => s.dispose());
    });
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "highland-editor.js"));
    const font = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, "fonts", f));
    const pdfjs = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, "pdfjs", f));
    const dict = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, "dictionary-en", f));
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; connect-src ${webview.cspSource}; worker-src blob:;">
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
body { display: flex; flex-direction: column; }
#main { flex: 1; min-height: 0; }
#editor, .cm-editor { height: 100%; }
/* Highland's top bar: Text and Pages at the left; the template and the theme at the right. */
#topbar { display: flex; align-items: center; gap: 12px; padding: 6px 14px 4px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--hl-muted); }
.tb-side { display: flex; align-items: center; gap: 10px; flex: 1; }
.tb-right { justify-content: flex-end; }
.tb-mid { display: none; align-items: center; gap: 14px; }
body.previewing .tb-mid { display: flex; }
.tb-icon { position: relative; width: 34px; height: 34px; padding: 5px; border: 0; border-radius: 5px; background: none; color: var(--hl-muted); cursor: pointer; }
.tb-icon svg { width: 24px; height: 24px; display: block; }
.tb-icon:hover { color: var(--hl-fg); }
.tb-icon .tb-hole { fill: var(--hl-bg); }
body:not(.previewing) #tbtext, body.previewing #tbpages { color: var(--hl-accent); }
/* The dot: halfway between the icon (bottom at 29px in the 34px button) and the bar's foot (4px below the button). */
body:not(.previewing) #tbtext::after, body.previewing #tbpages::after { content: ""; position: absolute; left: 50%; top: 31px; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: var(--hl-accent); }
#topbar select { font: inherit; color: var(--hl-muted); background: transparent; border: 0; padding: 2px 4px; cursor: pointer; }
#topbar select:hover { color: var(--hl-fg); }
#topbar select option { color: var(--hl-panel-fg); background: var(--hl-panel-bg); }
#ptemplate { font: inherit; color: var(--hl-muted); background: transparent; border: 0; padding: 2px 4px; cursor: pointer; }
#ptemplate:hover { color: var(--hl-fg); }
#ptemplate::after { content: " ▾"; font-size: 0.8em; }
/* Highland's Document Template window: a sheet over the editor. */
#tplwin { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding: 24px 16px; background: rgba(0, 0, 0, 0.35); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
#tplwin[hidden] { display: none; }
.tw-sheet { display: flex; flex-direction: column; width: min(720px, 100%); max-height: 100%; background: var(--hl-panel-bg); color: var(--hl-panel-fg); border: 1px solid var(--hl-border); border-radius: 10px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); overflow: hidden; }
.tw-head { position: relative; display: flex; align-items: center; justify-content: center; padding: 14px 16px 10px; }
.tw-head h1 { margin: 0; font-size: 1.6em; font-weight: 600; color: var(--hl-muted); }
.tw-done { position: absolute; right: 14px; font: inherit; padding: 4px 14px; border: 0; border-radius: 5px; background: var(--hl-accent); color: var(--hl-accent-fg); cursor: pointer; }
.tw-body { display: flex; gap: 20px; min-height: 0; padding: 0 20px 20px; }
.tw-list { flex: 0 0 210px; overflow-y: auto; padding-right: 8px; border-right: 1px solid var(--hl-border); }
.tw-group { margin: 12px 0 4px; padding-top: 8px; border-top: 1px solid var(--hl-border); font-size: 0.8em; font-weight: 600; letter-spacing: 0.06em; color: var(--hl-muted); }
.tw-group:first-child { margin-top: 0; }
.tw-item { display: block; width: 100%; text-align: left; font: inherit; font-size: 1.15em; padding: 5px 10px; margin: 1px 0; border: 0; border-radius: 6px; background: none; color: inherit; cursor: pointer; }
.tw-item:hover { background: var(--vscode-list-hoverBackground); }
.tw-item.tw-selected { background: var(--hl-accent); color: var(--hl-accent-fg); }
.tw-item:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.tw-detail { flex: 1; min-width: 0; overflow-y: auto; }
.tw-thumb { position: relative; display: inline-block; background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.3); }
.tw-thumb canvas { display: block; width: 216px; }
.tw-thumb-note { position: absolute; inset: 40% 12px auto; text-align: center; color: #555; }
.tw-name { margin: 14px 0 4px; font-size: 1.9em; }
.tw-description p { margin: 0 0 8px; line-height: 1.4; }
.tw-options { margin-top: 10px; border-top: 1px solid var(--hl-border); padding-top: 10px; }
.tw-options-head { font-size: 0.8em; font-weight: 600; letter-spacing: 0.06em; color: var(--hl-muted); margin-bottom: 8px; }
.tw-option { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
.tw-font span { width: 5em; text-align: right; }
.tw-font select { flex: 1; max-width: 240px; font: inherit; padding: 3px 6px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--hl-border)); border-radius: 4px; }
@media (max-width: 560px) { .tw-body { flex-direction: column; } .tw-list { flex: none; max-height: 30vh; border-right: 0; } }
/* Highland's counts at the foot of the text. */
#counts { display: flex; justify-content: center; gap: 2em; padding: 6px 0 8px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--hl-muted); }
#counts:empty, body.previewing #counts { display: none; }
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
/* Highland's paragraph numbers, in the margin left of the text (highwater.paragraphNumbers). */
.cm-editor .cm-content .cm-line { position: relative; }
.hl-numbers .cm-line[data-n]::before { content: attr(data-n); position: absolute; left: -6.5em; width: 4.5em; text-align: right; font-size: 0.65em; line-height: calc(1.3em / 0.65); color: var(--hl-muted); font-family: var(--vscode-font-family); pointer-events: none; user-select: none; }
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
/* Preview mode (⌘E): the printed pages in the same tab, with Highland's bars above and below. */
#preview { display: none; height: 100%; flex-direction: column; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--hl-panel-fg); }
body.previewing #editor { display: none; }
body.previewing #preview { display: flex; }
#pbottom { display: flex; align-items: center; gap: 14px; padding: 6px 12px; background: var(--hl-panel-bg); }
#pbottom { border-top: 1px solid var(--hl-border); justify-content: flex-end; flex-wrap: wrap; }
#pstatus { text-align: center; color: var(--hl-muted); }
#pboxes { display: flex; gap: 16px; flex-wrap: wrap; margin-right: auto; }
#pboxes label { display: inline-flex; align-items: center; gap: 5px; }
#pboxes label:has(input:disabled) { color: var(--hl-muted); }
#pboxes input { accent-color: var(--hl-accent); }
#pbottom button { font: inherit; border: 1px solid var(--hl-border); border-radius: 4px; padding: 4px 14px; cursor: pointer; color: var(--hl-panel-fg); background: none; }
#pbottom button#psave { background: var(--hl-accent); color: var(--hl-accent-fg); border-color: transparent; }
#pbottom button[hidden] { display: none; }
#pages { flex: 1; overflow: auto; padding: 16px 0; outline: none; background: color-mix(in srgb, var(--hl-bg) 85%, #808080); }
.page { margin: 0 auto 16px; background: white; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
.page canvas { display: block; width: 100%; height: 100%; }
.pmessage { padding: 24px; color: var(--hl-muted); }
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
/* Spelling (highwater.spellCheck): red dots under a misspelling, as macOS draws them in Highland 2. */
.hl-misspelled { text-decoration: underline dotted #ff3b30; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-skip-ink: none; }
.hl-spellmenu { position: fixed; z-index: 100; min-width: 12em; padding: 4px 0; background: var(--vscode-menu-background, var(--vscode-editorWidget-background, Canvas)); color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground, CanvasText)); border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent)); border-radius: 5px; box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,.3)); font: 13px var(--vscode-font-family); }
.hl-spellmenu button { display: block; width: 100%; padding: 3px 14px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: default; }
.hl-spellmenu button:not(:disabled):hover { background: var(--vscode-menu-selectionBackground, var(--hl-accent)); color: var(--vscode-menu-selectionForeground, var(--hl-accent-fg)); }
.hl-spellmenu button:disabled { opacity: .6; }
.hl-spellmenu hr { border: 0; border-top: 1px solid var(--vscode-menu-separatorBackground, var(--hl-muted)); margin: 4px 0; }
</style></head>
<body data-pdfjs="${pdfjs("pdf.min.mjs")}" data-worker="${pdfjs("pdf.worker.min.mjs")}" data-spell-worker="${webview.asWebviewUri(vscode.Uri.joinPath(dist, "spell-worker.js"))}" data-dict-aff="${dict("index.aff")}" data-dict-dic="${dict("index.dic")}">
<div id="topbar">
  <div class="tb-side">
    <button id="tbtext" class="tb-icon" title="Text (⌘E)" aria-label="Text"><svg viewBox="0 0 24 24"><path d="M4 5h16M4 9.5h12M4 14h16M4 18.5h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    <button id="tbpages" class="tb-icon" title="Pages (⌘E)" aria-label="Pages"><svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.1" class="tb-hole"/><circle cx="8.5" cy="12" r="1.1" class="tb-hole"/><circle cx="8.5" cy="16.5" r="1.1" class="tb-hole"/></svg></button>
  </div>
  <div class="tb-mid">
    <select id="pzoom" aria-label="Page size"><option value="fit">Fit width</option><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select>
    <span id="pstatus"></span>
  </div>
  <div class="tb-side tb-right">
    <button id="ptemplate" title="Document Template…" aria-haspopup="dialog" hidden></button>
    <button id="tbtheme" class="tb-icon" title="Choose Theme…" aria-label="Choose Theme"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="3.3 2.6"/></svg></button>
  </div>
</div>
<div id="main">
<div id="editor"></div>
<div id="preview">
  <div id="pages" tabindex="-1"></div>
  <div id="pbottom"><div id="pboxes"></div><button id="psaveword" hidden>Save As Word</button><button id="psave">Save As PDF</button></div>
</div>
</div>
<div id="counts"></div>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
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
  // Where the cursor is, to put it back in the other editor (a Search result's line, say).
  const here = activeOffsets();
  const at = here && here.document.uri.toString() === target.toString() ? here.selections[0]?.head : undefined;
  let swapped = false;
  if (active === target.toString()) {
    try {
      await vscode.commands.executeCommand("reopenActiveEditorWith", viewType);
      swapped = true;
    } catch {
      // An older VS Code without the command: open beside instead.
    }
  }
  if (!swapped) await vscode.commands.executeCommand("vscode.openWith", target, viewType);
  if (at === undefined || at === 0) return;
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target.toString());
  if (!doc) return;
  if (viewType === HIGHLAND_EDITOR) viewOf(doc, true)?.reveal(at, "center", true); // held until the page has started
  else {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (!editor) return;
    const pos = doc.positionAt(at);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

/** VS Code's colour theme now. */
function windowTheme(): string | undefined {
  return vscode.workspace.getConfiguration("workbench").get<string>("colorTheme");
}

async function setWindowTheme(label: string | undefined): Promise<void> {
  if (label && label !== windowTheme()) await vscode.workspace.getConfiguration("workbench").update("colorTheme", label, vscode.ConfigurationTarget.Global);
}

/**
 * Uses a theme for the page and the Navigator and, with highwater.themeWindow on, for the whole
 * window (its "Highwater …" colour theme). The writer's own colour theme is remembered the first
 * time it is replaced, and put back for "Match VS Code".
 */
async function useTheme(context: vscode.ExtensionContext, id: string): Promise<void> {
  await vscode.workspace.getConfiguration("highwater").update("theme", id, vscode.ConfigurationTarget.Global);
  if (!vscode.workspace.getConfiguration("highwater").get<boolean>("themeWindow", true)) return;
  const ours = new Set(Object.values(HIGHLAND_THEMES).map(colorThemeLabel));
  const current = windowTheme();
  if (current && !ours.has(current)) await context.globalState.update(OWN_THEME, current);
  const theme = HIGHLAND_THEMES[id];
  if (theme) await setWindowTheme(colorThemeLabel(theme));
  else if (current && ours.has(current)) await setWindowTheme(context.globalState.get<string>(OWN_THEME) ?? (vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? "Default Light Modern" : "Default Dark Modern"));
}
const OWN_THEME = "highwater.ownColorTheme";

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
const swapsPending = new Set<string>();
function swapSoon(uri: vscode.Uri): void {
  const key = uri.toString();
  if (swapsPending.has(key)) return;
  swapsPending.add(key);
  // VS Code reports a new tab, its activation and the document's language in separate steps, and
  // on a slow machine (CI's macOS) not within 300 ms: keep looking for up to 3 s while the tab is open.
  const end = Date.now() + 3000;
  const attempt = (): void => {
    const again = (): void => {
      if (Date.now() < end) setTimeout(attempt, 150);
      else swapsPending.delete(key);
    };
    if (wantsText.has(key)) {
      swapsPending.delete(key);
      return;
    }
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    if (!tabs.some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key)) return again();
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (swapping || !(active?.input instanceof vscode.TabInputText) || active.input.uri.toString() !== key || !doc || !doc.languageId.startsWith("highland-")) return again();
    swapsPending.delete(key);
    if (roleOf(doc).kind !== "script" || viewOf(doc, true)) return;
    void swapActive(uri, HIGHLAND_EDITOR);
  };
  setTimeout(attempt, 300);
}

/** Opens the active document in the Highland-style editor, or back in the text editor. */
export function registerHighlandEditor(context: vscode.ExtensionContext, store: () => BundleStore): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HIGHLAND_EDITOR, new HighlandEditorProvider(context, store), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand("highwater.openHighlandEditor", async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) await swapActive(target, HIGHLAND_EDITOR);
    }),
    // Highland's themes, tried out as you move through the list (Escape puts the old one back).
    vscode.commands.registerCommand("highwater.chooseTheme", async () => {
      const before = { theme: vscode.workspace.getConfiguration("highwater").get<string>("theme", "vscode"), window: windowTheme() };
      const items = [
        { label: "Match VS Code", description: "your VS Code colour theme", id: "vscode" },
        ...Object.entries(HIGHLAND_THEMES).map(([id, t]) => ({ label: t.name, description: t.mode, id })),
      ];
      const quick = vscode.window.createQuickPick<(typeof items)[number]>();
      quick.title = "Theme for the Highland-Style Editor and the Navigator";
      quick.items = items;
      quick.activeItems = items.filter((i) => i.id === before.theme);
      let chosen = false;
      // One change at a time: moving quickly through the list queues them.
      let applying: Promise<void> = Promise.resolve();
      quick.onDidChangeActive((active) => {
        const id = active[0]?.id;
        if (id) applying = applying.then(() => useTheme(context, id));
      });
      quick.onDidAccept(() => {
        chosen = true;
        quick.hide();
      });
      quick.onDidHide(() => {
        if (!chosen)
          applying = applying.then(async () => {
            await vscode.workspace.getConfiguration("highwater").update("theme", before.theme, vscode.ConfigurationTarget.Global);
            if (vscode.workspace.getConfiguration("highwater").get<boolean>("themeWindow", true)) await setWindowTheme(before.window);
          });
        quick.dispose();
      });
      quick.show();
    }),
    // ⌘+ and ⌘−: the text size, as Highland's zoom (the page column grows with it); ⌥⌘0 goes back.
    vscode.commands.registerCommand("highwater.zoomIn", () => zoom(+1)),
    vscode.commands.registerCommand("highwater.zoomOut", () => zoom(-1)),
    vscode.commands.registerCommand("highwater.zoomReset", () => vscode.workspace.getConfiguration("highwater").update("fontSize", 0, vscode.ConfigurationTarget.Global)),
    // ⌃G: VS Code's Go to Line only reaches text editors.
    // ⌃G: Go to Paragraph, by Highland's paragraph numbers (VS Code's Go to Line only reaches text editors).
    vscode.commands.registerCommand("highwater.goToLine", async () => {
      const view = activeView();
      if (!view) return;
      const doc = view.document;
      const numbers = paragraphNumbers(parse(doc.getText(), { mode: MODES.get(doc.languageId) ?? "fountain" }));
      const starts = [...numbers.keys()];
      const count = starts.length;
      if (!count) return;
      const head = view.selections[0]?.head ?? 0;
      let current = 0;
      for (const [at, n] of numbers) if (at <= head) current = n;
      const answer = await askText({
        title: "Go to Paragraph",
        prompt: `${current ? `Now at paragraph ${current}. ` : ""}Type a paragraph number between 1 and ${count}.`,
        validateInput: (v) => (/^\s*\d+\s*$/.test(v) && +v >= 1 && +v <= count ? null : `A paragraph number between 1 and ${count}`),
      });
      if (!answer) return;
      await revealOffset(doc, starts[+answer - 1]!, "center", true);
    }),
    vscode.commands.registerCommand("highwater.toggleSpelling", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("spellCheck", !config.get<boolean>("spellCheck", false), vscode.ConfigurationTarget.Global);
    }),
    // ⌘; is handled in the page itself; this is the same for the Command Palette.
    vscode.commands.registerCommand("highwater.nextMisspelling", () => void activeView()?.panel.webview.postMessage({ type: "nextMisspelling" })),
    vscode.commands.registerCommand("highwater.toggleParagraphNumbers", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("paragraphNumbers", !config.get<boolean>("paragraphNumbers", false), vscode.ConfigurationTarget.Global);
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
