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
import { affectsSettings, currentGeneral, handleSettingsMessage, registerSettings, settingsMessage } from "./settings-host.ts";
import { editorFocused, registerSidebarNote } from "./sidebar-note.ts";
import { sidebarHost } from "./sidebar-host.ts";
import { pageHtml } from "./page-html.ts";
import { postTo, type FromPage, type PanelName, type ToPage } from "./messages.ts";
import { askText } from "../ask.ts";
import { roleOf } from "../focus.ts";
import { activeOffsets, activeView, editorDefaults, HIGHLAND_EDITOR, highlandViews, highwaterOpener, revealOffset, viewOf, type HighlandView } from "../surface.ts";
import { debounce } from "../debounce.ts";

export { HIGHLAND_EDITOR };

/**
 * The Highwater Editor: a custom text editor over the same document as
 * VS Code's editor, so saving, the writing history and the panes work as before. Opened with
 * Reopen Editor With… or Open in Highwater Editor; the text editor stays one click away.
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
      select: (ranges) => {
        // The page must hold the edited text before it can select in it.
        if (changedElsewhere()) send();
        if (view.ready) postTo(panel, { type: "select", ranges: ranges.map((r) => ({ anchor: toPage(r.anchor), head: toPage(r.head) })) });
      },
      reveal: (offset, how, select) => {
        const msg: ToPage = { type: "reveal", offset: toPage(offset), how, select };
        // The page drops messages sent before its script has started: hold the latest until it has.
        if (view.ready) postTo(panel, msg);
        else pendingReveal = msg;
      },
      showPanel: (name) => whenReady(() => postTo(panel, { type: "showPanel", panel: name })),
      compareWith: (hash, at) => whenReady(() => sidebar.compare(hash, at)),
    };
    let pendingReveal: ToPage | undefined;
    /** What waits for the page's script to start (it drops messages sent before). */
    const waiting: (() => void)[] = [];
    const whenReady = (run: () => void) => (view.ready ? run() : waiting.push(run));
    /** Preview mode: the page shows the printed pages, laid out here. */
    let previewing = false;
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
          postTo(panel, { type: "init", text: pageText, mode: MODES.get(document.languageId) ?? "fountain" });
          view.ready = true;
          previewing = false;
          sendInvisibles();
          sendTheme();
          sendFontSize();
          sendNumbers();
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
        if (view.ready && (e.affectsConfiguration("highwater.theme") || e.affectsConfiguration("highwater.customThemes") || e.affectsConfiguration("highwater.darkPages"))) sendTheme();
        if (view.ready && e.affectsConfiguration(SETTINGS_PREFIX)) sendTemplateValues();
        if (view.ready && e.affectsConfiguration("highwater.fontSize")) sendFontSize();
        if (view.ready && affectsSettings(e)) postTo(panel, settingsMessage());
        if (view.ready && e.affectsConfiguration("highwater.excludeNotesFromWordCount")) sendCounts();
        if (view.ready && e.affectsConfiguration("highwater.paragraphNumbers")) sendNumbers();
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
        if (changedElsewhere()) send();
        if (view.ready) sendCounts();
      }),
    ];
    panel.onDidDispose(() => {
      log(`panel disposed ${document.uri.path.split("/").pop()}`);
      sendCounts.cancel();
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

/**
 * Switches the active tab between the text editor and the Highwater Editor in place, as
 * Reopen Editor With… does: one tab per document, and no save-or-discard question for unsaved
 * changes (two tabs of a document in different editors would each ask on closing).
 */
/** True while a swap is under way: its new tab must not be taken for a second one. */
let swapping = false;
/** What the switching between editors decided and why, for the end-to-end tests (highwater.test.swapLog). */
export const swapLog: string[] = [];
function log(what: string): void {
  // The clock's last six digits in ms, to line up with the test's own record.
  swapLog.push(`${Date.now() % 1_000_000} ${what}`);
  if (swapLog.length > 400) swapLog.splice(0, 100);
}
/** Documents the writer switched to the text editor (Reopen Editor With…): left as text until closed. */
const wantsText = new Set<string>();

/**
 * The tab in front, and the one before it with when it stopped being in front: VS Code's Reopen
 * Editor With… swaps a Highwater tab for a text tab of the same document (sometimes before the
 * Highwater panel reports its closing), and that is how it is told from a text tab opened anew.
 */
let front: { uri: string; highwater: boolean } | null = null;
let before: { uri: string; highwater: boolean; until: number } | null = null;
function noteFront(): void {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const now =
    input instanceof vscode.TabInputCustom && input.viewType === HIGHLAND_EDITOR
      ? { uri: input.uri.toString(), highwater: true }
      : input instanceof vscode.TabInputText
        ? { uri: input.uri.toString(), highwater: false }
        : null;
  if (now?.uri === front?.uri && now?.highwater === front?.highwater) return;
  if (front) before = { ...front, until: Date.now() };
  front = now;
  log(`front ${now ? `${now.highwater ? "highwater" : "text"} ${now.uri.split("/").pop()}` : "none"}`);
  // From a Highwater tab straight to a text tab of the same document: the writer chose the text
  // editor (Reopen Editor With…, or the breadcrumbs bar's editor menu), if the Highwater tab is gone.
  // Not gated on \`swapping\`: that stays on for half a second after our own swap to the Highwater
  // Editor, and a choice made in that time was missed (CI's log, 0.6.28).
  // (A Search result opened as text beside a Highwater tab keeps that tab: it goes back there.)
  if (now && !now.highwater && before?.highwater && before.uri === now.uri && Date.now() - before.until < 2000) {
    reopenedAsText.set(now.uri, Date.now());
    log("reopened as text");
  }
}
const reopenedAsText = new Map<string, number>();

/** A Highwater tab of this document is open (in any group). */
function hasHighwaterTab(uri: string): boolean {
  return vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === HIGHLAND_EDITOR && t.input.uri.toString() === uri));
}

/** The writer turned this document's Highwater tab into a text tab just now: leave it as text. */
function choseText(uri: string): boolean {
  const recent = (at: number | undefined) => at !== undefined && Date.now() - at < 2000;
  if (recent(reopenedAsText.get(uri)) && !hasHighwaterTab(uri)) wantsText.add(uri);
  log(`choseText ${uri.split("/").pop()}: reopened=${recent(reopenedAsText.get(uri))} tab=${hasHighwaterTab(uri)} → ${wantsText.has(uri)}`);
  return wantsText.has(uri);
}

/**
 * Swaps run one at a time. Two at once (a second swap asked for while the switch into the
 * Highwater Editor was still finishing) left VS Code with both tabs open (CI's log on Linux, 0.6.28).
 */
let swapQueue: Promise<void> = Promise.resolve();
let swapDepth = 0;

function swapActive(target: vscode.Uri, viewType: string): Promise<void> {
  const name = target.path.split("/").pop();
  const to = viewType === HIGHLAND_EDITOR ? "highwater" : viewType;
  log(`swapActive ${name} → ${to} asked`);
  const run = swapQueue.then(async () => {
    swapDepth++;
    swapping = true;
    log(`swapActive ${name} → ${to} starts`);
    try {
      await swapInPlace(target, viewType);
    } finally {
      log(`swapActive ${name} → ${to} done`);
      // The old tab closes just after the command returns. (Counted, so an earlier swap's timer
      // doesn't end a later one's.)
      setTimeout(() => (swapping = --swapDepth > 0), 500);
    }
  });
  swapQueue = run.catch(() => undefined);
  return run;
}

async function swapInPlace(target: vscode.Uri, viewType: string): Promise<void> {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  const active = input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri.toString() : undefined;
  // Where the cursor is, to put it back in the other editor (a Search result's line, say).
  const here = activeOffsets();
  const at = here && here.document.uri.toString() === target.toString() ? here.selections[0]?.head : undefined;
  log(`swapInPlace ${target.path.split("/").pop()}: cursor ${at ?? "unknown"} (active editor ${vscode.window.activeTextEditor?.document.uri.path.split("/").pop() ?? "none"})`);
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
  if (viewType === HIGHLAND_EDITOR) {
    // The new Highwater Editor can register a moment after the command returns: wait for it, then
    // put the cursor there (held until its page has started).
    let view = viewOf(doc, true);
    for (let waited = 0; !view && waited < 5000; waited += 100) {
      await new Promise((r) => setTimeout(r, 100));
      view = viewOf(doc, true);
    }
    log(`swapInPlace ${target.path.split("/").pop()}: ${view ? `cursor put at ${at}` : "no Highwater Editor after 5 s"}`);
    view?.reveal(at, "center", true);
  } else {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (!editor) return;
    const pos = doc.positionAt(at);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
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
 * Turns a script's text tab into the Highwater Editor (the default) once things settle, if it
 * is still the active tab: a .md file is given its Highwater language just after it opens.
 */
const swapsPending = new Set<string>();
function swapSoon(uri: vscode.Uri): void {
  const key = uri.toString();
  if (swapsPending.has(key)) return log(`swapSoon ${key.split("/").pop()} (already pending)`);
  swapsPending.add(key);
  log(`swapSoon ${key.split("/").pop()}`);
  // VS Code reports a new tab, its activation and the document's language in separate steps, and
  // on a slow machine (CI's macOS) not at once: keep looking for up to 3 s while the tab is open.
  const end = Date.now() + 3000;
  const attempt = (): void => {
    const again = (): void => {
      if (Date.now() < end) setTimeout(attempt, 150);
      else swapsPending.delete(key);
    };
    noteFront();
    // Already in the Highwater Editor (our own swap, say): this loop's work is done. Left running,
    // it swapped the document back after the writer chose the text editor (CI's log, 0.6.28).
    const inFront = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (inFront instanceof vscode.TabInputCustom && inFront.viewType === HIGHLAND_EDITOR && inFront.uri.toString() === key) {
      swapsPending.delete(key);
      return log(`swapSoon ${key.split("/").pop()}: already in the Highwater Editor`);
    }
    // Reopen Editor With… under way: wait for its Highwater tab to go, then leave the text be.
    if (Date.now() - (reopenedAsText.get(key) ?? 0) < 2000 && hasHighwaterTab(key)) return again();
    if (choseText(key)) {
      swapsPending.delete(key);
      return;
    }
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    if (!tabs.some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key)) return again();
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    if (swapping || !(active?.input instanceof vscode.TabInputText) || active.input.uri.toString() !== key || !doc || !doc.languageId.startsWith("highland-")) return again();
    // The text editor itself, not only its tab: it holds the line it was opened at (a Search
    // result's), which the swap carries over. Its tab can be in front before it exists.
    if (vscode.window.activeTextEditor?.document.uri.toString() !== key) return again();
    swapsPending.delete(key);
    if (roleOf(doc).kind !== "script" || viewOf(doc, true)) return log(`swapSoon: not swapping (view open=${!!viewOf(doc, true)})`);
    log(`swapSoon: swapping ${key.split("/").pop()} to the Highwater Editor`);
    void swapActive(uri, HIGHLAND_EDITOR);
  };
  // Straight away (a script that already has its language swaps at once), then every 150 ms.
  setTimeout(attempt, 0);
}

/**
 * The document's parse: the shared one, except for a moment after opening, before VS Code has
 * given the script its language, when the page treats it as Fountain (as the cache would not).
 */
function parsed(cache: ParseCache, doc: vscode.TextDocument): Document {
  return MODES.has(doc.languageId) ? cache.get(doc) : parse(doc.getText(), { mode: "fountain" });
}

/** A document in the Highwater Editor, asked for by the extension (the writing history's choices). */
async function openInHighwater(doc: vscode.TextDocument): Promise<HighlandView | undefined> {
  const uri = doc.uri.toString();
  wantsText.delete(uri); // asked for here, so no longer the writer's text-editor choice
  const open = viewOf(doc, true);
  if (open) {
    open.panel.reveal(open.panel.viewColumn, false);
    return open;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab?.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri) await swapActive(doc.uri, HIGHLAND_EDITOR);
  else await vscode.commands.executeCommand("vscode.openWith", doc.uri, HIGHLAND_EDITOR, { preview: false });
  for (let waited = 0; waited < 10_000; waited += 100) {
    const view = viewOf(doc, true);
    if (view) return view;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}

/** The Highwater Editor, its commands, and turning scripts opened as text into Highwater Editor tabs. */
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
    vscode.commands.registerCommand("highwater.toggleParagraphNumbers", async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("paragraphNumbers", !config.get<boolean>("paragraphNumbers", false), vscode.ConfigurationTarget.Global);
    }),
    // A script opened as text (from Search, the Explorer's Open With, a link) becomes a Highwater
    // Editor tab, unless the writer chose the text editor for it (Reopen Editor With… → Text Editor).
    vscode.window.tabGroups.onDidChangeTabGroups(() => noteFront()),
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      noteFront();
      for (const closed of e.closed) {
        const input = closed.input;
        if (!(input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)) continue;
        const uri = input.uri.toString();
        const still = vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => (t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputCustom) && t.input.uri.toString() === uri);
        if (!still && wantsText.delete(uri)) log(`wantsText cleared for ${uri.split("/").pop()} (its last tab closed)`);
      }
      if (swapping || !editorDefaults.highwater) return;
      for (const opened of e.opened) {
        // Not opened.isActive: a tab is usually reported active only in a later event. Checked below.
        if (!(opened.input instanceof vscode.TabInputText)) continue;
        swapSoon(opened.input.uri);
      }
    }),
    // Also when a script's text tab comes to the front: the tab events don't always say it is active.
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e && editorDefaults.highwater) swapSoon(e.document.uri);
    }),
    // A script opened in the text editor (from Search, say) while it is open in the Highwater
    // Editor: show it there instead, at the same place, so there is one tab per document. Only when it has no unsaved
    // changes, as closing a tab of a changed document asks to save or discard.
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      if (swapping) return;
      for (const opened of e.opened) {
        if (!(opened.input instanceof vscode.TabInputText)) continue;
        const uri = opened.input.uri.toString();
        // Look again once things settle: a swap or a closing tab may be under way.
        setTimeout(() => {
          if (swapping || choseText(uri) || !hasHighwaterTab(uri)) return;
          const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri);
          if (!tab || tab.isDirty) return;
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
          const view = doc && viewOf(doc, true);
          if (!view) return;
          // Where the text editor was opened to (a search result's line), to show the same place.
          const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
          const at = editor ? doc.offsetAt(editor.selection.active) : undefined;
          log(`search handler: closing the text tab of ${uri.split("/").pop()}`);
          void vscode.window.tabGroups.close(tab).then(() => {
            view.panel.reveal(view.panel.viewColumn, false);
            if (at !== undefined) view.reveal(at, "center", true);
          });
        }, 300);
      }
    }),
  );
}
