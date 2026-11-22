import * as vscode from "vscode";
import { toHighlandUri } from "../fs-provider.ts";
import { MODES, type ParseCache } from "../language.ts";
import { SETTINGS_PREFIX, setTemplateOption, TEMPLATE_INFO, templateOptions } from "../template-options.ts";
import { onDidChangeTemplate, PRINT_OPTIONS, printOptionsOf, renderDocument, setPrintOption, setTemplate, templateOf, TEMPLATES, type PrintOption, type Template } from "../render-document.ts";
import { documentStats } from "../syntax/stats.ts";
import { onDidChangePageCount, pageCountOf, pageStartsOf } from "../page-count.ts";
import type { BundleStore } from "../store.ts";
import { parse, type Document } from "@highwater/parser";
import { paragraphNumbers } from "./line-styles.ts";
import { lineAndCharacter, offsetOf, pageForm } from "./offsets.ts";
import { handleThemeMessage, registerThemes, themesMessage, themeVars } from "./theme-host.ts";
import { affectsSettings, backupInfoMessage, currentGeneral, handleSettingsMessage, registerSettings, settingsMessage } from "./settings-host.ts";
import { historyApi } from "../history.ts";
import { editorFocused, registerSidebarNote } from "./sidebar-note.ts";
import { sidebarHost } from "./sidebar-host.ts";
import { pageHtml } from "./page-html.ts";
import { postTo, type FromPage, type PanelName, type ToPage } from "./messages.ts";
import { askText } from "../ask.ts";
import { activeView, HIGHLAND_EDITOR, highlandViews, highwaterOpener, revealOffset, viewOf, type HighlandView } from "../surface.ts";
import { debounce } from "../debounce.ts";

export { HIGHLAND_EDITOR };

/**
 * The Highwater Editor: a custom text editor over the same document as
 * VS Code's editor, so saving, the writing history and the panes work as before. Opened with
 * Reopen Editor With… or Open in Highwater Editor; the text editor stays one click away.
 *
 * Who owns the text (architecture review, 2026-11-22): the page does all editing. Typing, undo
 * and redo happen in the page, and so do Highwater's commands (⌘B, markers, inserts, the Title
 * Page Builder): the extension works out the change and sends it with "apply" (HighlandView.apply);
 * the page makes it as its own edit, so its rules and its undo history cover it. Every edit the
 * page makes comes back as "edit" and is applied to the document, which is the copy VS Code saves
 * and the writing history records. A change that replaces the text from elsewhere (Revert, VS
 * Code's Edit ▸ Undo, the file changed on disk, another editor) reaches the page as "update",
 * marked as coming from outside.
 */
export class HighlandEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    /** The .highland files' store, for laying out the pages (made after this provider). */
    private readonly store: () => BundleStore,
    /** The parse every other feature shares (made after this provider). */
    private readonly cache: () => ParseCache,
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
      comparing: false,
      togglePreview: () => postTo(panel, { type: "togglePreview" }),
      reveal: (offset, how, select) => {
        const msg: ToPage = { type: "reveal", offset: toPage(offset), how, select };
        // The page drops messages sent before its script has started: hold the latest until it has.
        if (view.ready) postTo(panel, msg);
        else pendingReveal = msg;
      },
      apply: async (edits, selections) => {
        if (!view.ready) return false;
        // The page must hold the document's text (and the edits it already sent must be in the
        // document) before offsets in the document mean the same place in the page.
        await queue;
        if (changedElsewhere()) send();
        const before = document.getText();
        const changes = edits.map((e) => ({ from: toPage(e.start), to: toPage(e.end), insert: pageForm(e.text) }));
        // Selections are offsets in the edited document: in a "\r\n" file, find the same line and character in the edited page text.
        let after = before;
        for (const e of [...edits].sort((a, b) => b.start - a.start)) after = after.slice(0, e.start) + e.text + after.slice(e.end);
        const afterPage = pageForm(after);
        const inPage = (o: number) => {
          if (!crlf()) return o;
          const p = lineAndCharacter(after, o);
          return offsetOf(afterPage, p.line, p.character);
        };
        const id = ++applyId;
        const done = new Promise<boolean>((resolve) => {
          applying.set(id, resolve);
          // A page that never answers (closed meanwhile) doesn't leave the command waiting.
          setTimeout(() => applying.delete(id) && resolve(false), 5000);
        });
        postTo(panel, { type: "apply", id, changes, ...(selections ? { selections: selections.map((r) => ({ anchor: inPage(r.anchor), head: inPage(r.head) })) } : {}) });
        return done;
      },
      showPanel: (name) => whenReady(() => postTo(panel, { type: "showPanel", panel: name })),
      compareWith: (hash, at) => whenReady(() => sidebar.compare(hash, at)),
    };
    let pendingReveal: ToPage | undefined;
    /**
     * Undo and redo belong to the page (its steps: a burst of typing, a ⌘B), but VS Code keeps its
     * own list, a step per edit, which Edit ▸ Undo, Redo and the unsaved dot go by. So when the page
     * undoes or redoes, VS Code's own undo or redo is stepped until the document matches; when
     * VS Code's Edit ▸ Undo or Redo moves the document, the page takes its step and VS Code is
     * stepped the rest of the way. Nothing new is added to VS Code's list, so its Redo still works
     * and the dot goes when the text is back to the saved one. If the steps can't reach the page's
     * text (a change from elsewhere in between), the document is simply set to it.
     */
    let walking = false;
    /** When a step last brought no change in time: one that still arrives is the stepping's, not an Edit ▸ Undo. */
    let stepTimedOut = 0;
    const walk = async (dir: "undo" | "redo", target: string) => {
      log(`walk ${dir} to ${JSON.stringify(target.slice(-40))}`);
      walking = true;
      try {
        for (let i = 0; i < WALK_LIMIT && pageForm(document.getText()) !== target; i++) {
          // VS Code's Undo and Redo act on the active editor: only while this one is it.
          if (!panel.active) break;
          const version = document.version;
          await vscode.commands.executeCommand(dir);
          // The change reaches the extension host as an event of its own: give it a moment.
          for (let waited = 0; document.version === version && waited < 200; waited += 10) await new Promise((r) => setTimeout(r, 10));
          if (document.version === version) {
            stepTimedOut = Date.now(); // nothing left to step (or a change slower than this)
            break;
          }
        }
      } finally {
        walking = false;
      }
      const now = pageForm(document.getText());
      if (now === target) return;
      log(`walk ${dir}: VS Code's steps didn't reach the page's text; setting it`);
      let a = 0;
      while (a < now.length && a < target.length && now[a] === target[a]) a++;
      let b = 0;
      while (b < now.length - a && b < target.length - a && now[now.length - 1 - b] === target[target.length - 1 - b]) b++;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(positionIn(now, a), positionIn(now, now.length - b)), target.slice(a, target.length - b));
      await vscode.workspace.applyEdit(edit);
    };
    /** Changes sent to the page to make ("apply"), waiting for its answer. */
    let applyId = 0;
    const applying = new Map<number, (ok: boolean) => void>();
    /** What waits for the page's script to start (it drops messages sent before). */
    const waiting: (() => void)[] = [];
    const whenReady = (run: () => void) => (view.ready ? run() : waiting.push(run));
    /** Preview mode: the page shows the printed pages, laid out here. */
    let previewing = false;
    /** Settings → Backup's folder and mirror, sent again when the history or the mirror changes. */
    let backupWatch: vscode.Disposable | undefined;
    let layout = 0;
    const sendPages = async (at: number | null) => {
      const mine = ++layout;
      try {
        const rendered = await renderDocument(this.context, this.store(), document);
        if (mine !== layout || !previewing) return;
        if (!rendered) {
          postTo(panel, { type: "previewEmpty", message: "Plain-text documents have no print template to preview." });
          return;
        }
        const print = await printOptionsOf(this.context, this.store(), document);
        // The anchors' offsets are the document's; the page counts "\r\n" as one character.
        const anchors = rendered.anchors.map((v, i) => (i % 3 === 2 ? toPage(v) : v));
        postTo(panel, { type: "pdf", data: rendered.pdf, template: rendered.template, templates: TEMPLATES, anchors, problems: rendered.problems, print, at });
        view.pagesSent++;
      } catch (error) {
        if (mine === layout) postTo(panel, { type: "previewEmpty", message: `Could not lay out the document: ${(error as Error).message}` });
      }
    };

    // Highland's paragraph numbers in the margin (highwater.paragraphNumbers).
    const sendNumbers = () => postTo(panel, { type: "numbers", on: vscode.workspace.getConfiguration("highwater").get<boolean>("paragraphNumbers", false) });
    // Typewriter Scrolling (highwater.typewriterScrolling): on or off for every document.
    const sendTypewriter = () => postTo(panel, { type: "typewriter", on: vscode.workspace.getConfiguration("highwater").get<boolean>("typewriterScrolling", false) });
    // Show Page Breaks (highwater.pageBreaks): where each page starts, from the page count's layout.
    const sendPageBreaks = () => {
      const on = vscode.workspace.getConfiguration("highwater").get<boolean>("pageBreaks", false);
      const starts = on ? pageStartsOf(document) : [];
      postTo(panel, { type: "pageBreaks", starts: starts.map((v, i) => (i % 2 === 0 ? toPage(v) : v)) });
    };
    // The template window's options (settings for every document).
    const sendTemplateValues = () => postTo(panel, { type: "templateValues", values: Object.fromEntries(TEMPLATE_INFO.map((t) => [t.name, templateOptions(t.name)])) });
    // The top bar's template menu, shown with the text too.
    const sendTemplate = async () => {
      const template = await templateOf(this.context, this.store(), document);
      postTo(panel, { type: "template", template: template ?? "", templates: template ? TEMPLATES : [] });
    };
    // Highland's counts at the foot of the text: characters, words and pages (the print layout's, page-count.ts).
    const sendCounts = debounce(300, () => {
      const stats = documentStats(parsed(this.cache(), document), { notes: !currentGeneral().excludeNotesFromWordCount });
      postTo(panel, { type: "counts", characters: stats.characters, words: stats.words, pages: pageCountOf(document) ?? null });
    });
    // Check Spelling While Typing (highwater.spellCheck) and the learned words.
    const sendSpelling = () => {
      const config = vscode.workspace.getConfiguration("highwater");
      postTo(panel, { type: "spelling", on: config.get<boolean>("spellCheck", false), words: config.get<string[]>("spellingWords", []) });
    };
    // The text size (highwater.fontSize; 0 follows VS Code's editor size).
    const sendFontSize = () => postTo(panel, { type: "fontSize", px: vscode.workspace.getConfiguration("highwater").get<number>("fontSize", 0) || null });
    // A Highland theme for the page (highwater.theme), or VS Code's colours.
    const sendTheme = () => {
      postTo(panel, { type: "theme", vars: themeVars() });
      postTo(panel, themesMessage());
    };
    // Show Invisibles follows the text editor's whitespace setting for the document's language.
    const sendInvisibles = () =>
      postTo(panel, { type: "invisibles", on: vscode.workspace.getConfiguration("editor", document).get<string>("renderWhitespace", "none") !== "none" });
    // Save cursor position in document: the cursor's place, kept for this workspace by document.
    const cursorKey = () => `cursor:${document.uri.toString()}`;
    let cursorAt = 0;
    const storeCursor = debounce(500, () => void this.context.workspaceState.update(cursorKey(), cursorAt));
    const saveCursor = (offset: number) => {
      cursorAt = offset;
      storeCursor();
    };
    const send = () => {
      pageText = pageForm(document.getText());
      postTo(panel, { type: "update", text: pageText });
    };
    // Highland's sidebar: the Navigator, the Scratchpad and the rest (sidebar-host.ts).
    const sidebar = sidebarHost(this.context, this.store, panel, () => document);
    const subscriptions = [
      highlandViews.add(view),
      sidebar,
      panel.webview.onDidReceiveMessage((msg: FromPage) => {
        if (sidebar.handle(msg)) return;
        if (msg.type === "pageFocus") return editorFocused();
        if (msg.type === "comparing") {
          view.comparing = msg.on;
          return;
        }
        if (msg.type === "ready") {
          view.comparing = false;
          sidebar.ready();
          pageText = pageForm(document.getText());
          // The General settings first: the column width shapes the text's first layout.
          postTo(panel, settingsMessage());
          postTo(panel, backupInfoMessage());
          backupWatch ??= historyApi?.onDidChange(() => view.ready && postTo(panel, backupInfoMessage()));
          postTo(panel, { type: "init", text: pageText, mode: MODES.get(document.languageId) ?? "fountain" });
          view.ready = true;
          previewing = false;
          sendInvisibles();
          sendTheme();
          sendFontSize();
          sendNumbers();
          sendTypewriter();
          sendPageBreaks();
          sendSpelling();
          void sendTemplate();
          sendCounts();
          // Save cursor position in document (General settings): back where it was, unless opened at a place.
          const saved = this.context.workspaceState.get<number>(cursorKey());
          if (pendingReveal) postTo(panel, pendingReveal);
          else if (currentGeneral().saveCursorPosition && typeof saved === "number" && saved <= document.getText().length)
            postTo(panel, { type: "reveal", offset: toPage(saved), how: "center", select: true });
          pendingReveal = undefined;
          for (const run of waiting.splice(0)) run();
        } else if (msg.type === "selection" && msg.ranges) {
          view.selections = msg.ranges.map((r) => ({ anchor: toDocument(r.anchor), head: toDocument(r.head) }));
          highlandViews.selected(view);
          const head = view.selections[0]?.head;
          if (head !== undefined && currentGeneral().saveCursorPosition) saveCursor(head);
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
            (r) => postTo(panel, { type: "templateThumb", template, data: r?.pdf ?? null, message: r ? "" : "No pages to show." }),
            (e: unknown) => postTo(panel, { type: "templateThumb", template, data: null, message: `Could not lay out the text: ${(e as Error).message}` }),
          );
        } else if (msg.type === "printOption" && PRINT_OPTIONS.includes(msg.key as PrintOption)) {
          void setPrintOption(this.context, this.store(), document, msg.key as PrintOption, !!msg.value).catch((e: unknown) => void vscode.window.showErrorMessage(`Could not save the print option: ${(e as Error).message}`));
        } else if (msg.type === "previewSave") {
          void vscode.commands.executeCommand(msg.kind === "docx" ? "highwater.exportDocx" : "highwater.exportPdf", document.uri);
        } else if (handleThemeMessage(this.context, msg)) {
          // (theme-host.ts)
        } else if (handleSettingsMessage(msg)) {
          // (settings-host.ts)
        } else if (msg.type === "learnWord" && typeof msg.word === "string" && msg.word.trim()) {
          // Learn Spelling: kept in the writer's settings (all documents; Settings Sync carries it).
          const config = vscode.workspace.getConfiguration("highwater");
          const words = config.get<string[]>("spellingWords", []);
          if (!words.includes(msg.word)) void config.update("spellingWords", [...words, msg.word].sort((x, y) => x.localeCompare(y)), vscode.ConfigurationTarget.Global);
        } else if (msg.type === "scroll" && typeof msg.top === "number") {
          view.top = toDocument(msg.top);
          highlandViews.scrolled(view);
        } else if (msg.type === "applied") {
          const resolve = applying.get(msg.id);
          applying.delete(msg.id);
          // Its edit came first, as an "edit" message: answer once that is in the document.
          if (resolve) queue = queue.then(() => resolve(msg.ok));
        } else if (msg.type === "testTyped") {
          log(`testTyped ${msg.typed} letters${msg.error ? `, error: ${msg.error}` : ""}; page text ${JSON.stringify(msg.text.slice(-60))}; document ${JSON.stringify(pageForm(document.getText()).slice(-60))}`);
        } else if (msg.type === "historyStepDone") {
          // The page's step didn't change its text (nothing to undo, a Bin-only step, comparing):
          // VS Code's own step is taken back.
          const opposite = msg.dir === "undo" ? "redo" : "undo";
          queue = queue.then(() => (pageForm(document.getText()) !== pageText ? walk(msg.changed ? msg.dir : opposite, pageText) : undefined));
        } else if (msg.type === "edit" && msg.changes && msg.history) {
          // The page's undo or redo: VS Code's own steps bring the document to the same text.
          const history = msg.history;
          for (const c of [...msg.changes].reverse()) pageText = pageText.slice(0, c.from) + c.insert + pageText.slice(c.to);
          const target = pageText;
          queue = queue.then(() => walk(history, target));
        } else if (msg.type === "edit" && msg.changes) {
          const changes = msg.changes;
          log(`edit from the page: ${changes.map((c) => `${c.from}-${c.to}+${JSON.stringify(c.insert)}`).join(" ")}`);
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
        if (view.ready && (e.affectsConfiguration("highwater.theme") || e.affectsConfiguration("highwater.customThemes") || e.affectsConfiguration("highwater.darkPages"))) sendTheme();
        if (view.ready && e.affectsConfiguration(SETTINGS_PREFIX)) sendTemplateValues();
        if (view.ready && e.affectsConfiguration("highwater.fontSize")) sendFontSize();
        if (view.ready && affectsSettings(e)) postTo(panel, settingsMessage());
        if (view.ready && (e.affectsConfiguration("highwater.historyFolder") || e.affectsConfiguration("highwater.historyRemote"))) postTo(panel, backupInfoMessage());
        if (view.ready && e.affectsConfiguration("highwater.excludeNotesFromWordCount")) sendCounts();
        if (view.ready && e.affectsConfiguration("highwater.paragraphNumbers")) sendNumbers();
        if (view.ready && e.affectsConfiguration("highwater.typewriterScrolling")) sendTypewriter();
        if (view.ready && e.affectsConfiguration("highwater.pageBreaks")) sendPageBreaks();
        if (view.ready && (e.affectsConfiguration("highwater.spellCheck") || e.affectsConfiguration("highwater.spellingWords"))) sendSpelling();
      }),
      // A template or print option changed (here, or in the status bar): lay the pages out again.
      onDidChangePageCount((d) => {
        if (view.ready && d.uri.toString() === document.uri.toString()) {
          sendCounts();
          sendPageBreaks();
        }
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
          postTo(panel, { type: "init", text: pageText, mode: MODES.get(document.languageId) ?? "fountain" });
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
        if (e.document !== document) document = e.document;
        log(`document changed (${e.reason === undefined ? "edit" : vscode.TextDocumentChangeReason[e.reason]}${walking ? ", stepping" : ""}${panel.active ? "" : ", panel not active"})`);
        if (walking) {
          // VS Code's own undo being stepped to the page's text: the page has it already.
        } else if ((e.reason === vscode.TextDocumentChangeReason.Undo || e.reason === vscode.TextDocumentChangeReason.Redo) && panel.active && view.ready && Date.now() - stepTimedOut > 1000) {
          // VS Code's Edit ▸ Undo or Redo in this editor: the page takes its own step (see walk).
          postTo(panel, { type: "historyStep", dir: e.reason === vscode.TextDocumentChangeReason.Undo ? "undo" : "redo" });
        } else if (changedElsewhere()) send();
        if (view.ready) sendCounts();
      }),
    ];
    panel.onDidDispose(() => {
      log(`panel disposed ${document.uri.path.split("/").pop()}`);
      sendCounts.cancel();
      backupWatch?.dispose();
      subscriptions.forEach((s) => s.dispose());
    });
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, "highland-editor.js"));
    const font = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, "fonts", f));
    const pdfjs = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, "pdfjs", f));
    const dict = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, "dictionary-en", f));
    const nonce = Math.random().toString(36).slice(2);
    return pageHtml({
      cspSource: webview.cspSource,
      nonce,
      script: String(script),
      spellWorker: String(webview.asWebviewUri(vscode.Uri.joinPath(dist, "spell-worker.js"))),
      font: (f) => String(font(f)),
      pdfjs: (f) => String(pdfjs(f)),
      dict: (f) => String(dict(f)),
    });
  }
}

/** VS Code steps taken at most to match one undo or redo of the page's (a burst of typing is a step per letter). */
const WALK_LIMIT = 400;

/** Notes for the end-to-end tests' log (highwater.test.swapLog): which editor opened what, and the cursor's moves. */
export const swapLog: string[] = [];
function log(what: string): void {
  // The clock's last six digits in ms, to line up with the test's own record.
  swapLog.push(`${Date.now() % 1_000_000} ${what}`);
  if (swapLog.length > 400) swapLog.splice(0, 100);
}

/** One step of text size, from the size shown now (VS Code's editor size × 1.4 when not set). */
async function zoom(step: number): Promise<void> {
  const config = vscode.workspace.getConfiguration("highwater");
  const now = config.get<number>("fontSize", 0) || Math.round(vscode.workspace.getConfiguration("editor").get<number>("fontSize", 14) * DEFAULT_SCALE);
  const next = Math.max(MIN_FONT, Math.min(MAX_FONT, now + step));
  await config.update("fontSize", next, vscode.ConfigurationTarget.Global);
  vscode.window.setStatusBarMessage(`Highwater Editor text: ${next} px (⌥⌘0 resets)`, 2500);
}
const DEFAULT_SCALE = 1.4;
const MIN_FONT = 8;
const MAX_FONT = 48;

/**
 * The document's parse: the shared one, except for a moment after opening, before VS Code has
 * given the script its language, when the page treats it as Fountain (as the cache would not).
 */
function parsed(cache: ParseCache, doc: vscode.TextDocument): Document {
  return MODES.has(doc.languageId) ? cache.get(doc) : parse(doc.getText(), { mode: "fountain" });
}

/** A document in the Highwater Editor, asked for by the extension (the writing history's choices). */
async function openInHighwater(doc: vscode.TextDocument): Promise<HighlandView | undefined> {
  const open = viewOf(doc, true);
  if (open) {
    open.panel.reveal(open.panel.viewColumn, false);
    return open;
  }
  // From the text editor (the writer reopened the script as text): that tab becomes the Highwater Editor.
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab?.input instanceof vscode.TabInputText && tab.input.uri.toString() === doc.uri.toString()) await vscode.commands.executeCommand("reopenActiveEditorWith", HIGHLAND_EDITOR);
  else await vscode.commands.executeCommand("vscode.openWith", doc.uri, HIGHLAND_EDITOR, { preview: false });
  for (let waited = 0; waited < 10_000; waited += 100) {
    const view = viewOf(doc, true);
    if (view) return view;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

/**
 * The Highwater Editor and its commands. VS Code opens scripts in it itself: it is the default
 * editor for .fountain files and the scripts inside .highland files (package.json, priority
 * "default"), and for .md files once the writer chooses Highwater for them (commands.ts sets
 * workbench.editorAssociations). Reopen Editor With… → Text Editor is VS Code's own and stays.
 * A Search result opens at the top: a custom editor isn't given the line it was opened at.
 */
export function registerHighlandEditor(context: vscode.ExtensionContext, store: () => BundleStore, cache: () => ParseCache): void {
  registerSidebarNote(context);
  registerThemes(context);
  registerSettings(context);
  highwaterOpener.open = openInHighwater;
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(HIGHLAND_EDITOR, new HighlandEditorProvider(context, store, cache), { webviewOptions: { retainContextWhenHidden: true } }),
    // Highland's sidebar keys (⌘0 shows or hides it, ⌘1… a panel) in the Highwater Editor.
    vscode.commands.registerCommand("highwater.toggleEditorSidebar", () => {
      const v = activeView();
      if (v) postTo(v.panel, { type: "toggleSidebar" });
    }),
    vscode.commands.registerCommand("highwater.showSidebarPanel", (panel: unknown) => {
      const v = activeView();
      if (typeof panel === "string" && v) postTo(v.panel, { type: "showPanel", panel: panel as PanelName });
    }),
    // ⌘E: the printed pages in place of the text, as in Highland 2.
    vscode.commands.registerCommand("highwater.preview", () => activeView()?.togglePreview()),
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
      const numbers = paragraphNumbers(parsed(cache(), doc));
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
    // The editor's ⋯ menu shows whichever of each pair applies (EJ): Show/Hide, Enable/Disable.
    ...([
      ["ParagraphNumbers", "paragraphNumbers", "show", "hide"],
      ["TypewriterScrolling", "typewriterScrolling", "enable", "disable"],
      ["PageBreaks", "pageBreaks", "show", "hide"],
      ["SpellingChecks", "spellCheck", "show", "hide"],
    ] as const).flatMap(([name, key, on, off]) =>
      [true, false].map((value) =>
        vscode.commands.registerCommand(`highwater.${value ? on : off}${name}`, () => vscode.workspace.getConfiguration("highwater").update(key, value, vscode.ConfigurationTarget.Global)),
      ),
    ),
    vscode.commands.registerCommand("highwater.toggleSpelling", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("spellCheck", !config.get<boolean>("spellCheck", false), vscode.ConfigurationTarget.Global);
    }),
    // ⌘; is handled in the page itself; this is the same for the Command Palette.
    vscode.commands.registerCommand("highwater.nextMisspelling", () => {
      const v = activeView();
      if (v) postTo(v.panel, { type: "nextMisspelling" });
    }),
    vscode.commands.registerCommand("highwater.togglePageBreaks", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("pageBreaks", !config.get<boolean>("pageBreaks", false), vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("highwater.toggleTypewriterScrolling", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("typewriterScrolling", !config.get<boolean>("typewriterScrolling", false), vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("highwater.toggleParagraphNumbers", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("paragraphNumbers", !config.get<boolean>("paragraphNumbers", false), vscode.ConfigurationTarget.Global);
    }),
    // For the end-to-end tests' log: when a script's text editor gets its cursor (a Search result's
    // line arrives a moment after the editor itself; CI's Ubuntu run, 0.6.63).
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!e.textEditor.document.languageId.startsWith("highland-")) return;
      log(`selection ${e.textEditor.document.uri.path.split("/").pop()}: ${e.textEditor.document.offsetAt(e.selections[0]!.active)} (${e.kind === undefined ? "api" : vscode.TextEditorSelectionChangeKind[e.kind]})`);
    }),
  );
}
