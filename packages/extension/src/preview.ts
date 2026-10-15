import { basename } from "node:path";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { bundleOf, onDidChangeTemplate, renderDocument, setTemplate, TEMPLATES, type Template } from "./render-document.ts";
import { BundleStore, splitBundlePath } from "./store.ts";

/**
 * The PDF preview (M6): the export engine's real output in a pdf.js viewer beside the editor,
 * refreshed on save and after a pause in typing, with Highland's template picker.
 */
export function registerPreview(context: vscode.ExtensionContext, store: BundleStore): void {
  let preview: Preview | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.preview", () => {
      const doc = scriptOf(vscode.window.activeTextEditor?.document);
      if (!preview) {
        preview = new Preview(context, store);
        preview.onDispose(() => (preview = undefined));
      }
      preview.show(doc);
    }),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      const doc = scriptOf(e?.document);
      if (preview && doc) preview.follow(doc);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => preview?.changed(e.document, false)),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => preview?.editorScrolled(e.textEditor)),
    vscode.workspace.onDidSaveTextDocument((d) => preview?.changed(d, true)),
    { dispose: store.onExternalChange((bundle) => preview?.bundleChanged(bundle)) },
    onDidChangeTemplate((doc) => preview?.changed(doc, true)),
    { dispose: () => preview?.dispose() },
  );
}

/** A Highland script (not a Bin item or the Scratchpad). */
function scriptOf(doc: vscode.TextDocument | undefined): vscode.TextDocument | undefined {
  if (!doc || !doc.languageId.startsWith("highland-")) return undefined;
  if (doc.uri.scheme === SCHEME && splitBundlePath(doc.uri.fsPath)?.entry !== "") return undefined;
  return doc;
}

class Preview {
  readonly #panel: vscode.WebviewPanel;
  #doc: vscode.TextDocument | undefined;
  #timer: NodeJS.Timeout | undefined;
  #version = 0;
  #ready = false;
  /** Until this time, editor scrolling is the preview's own doing and is not sent back. */
  #quietUntil = 0;
  readonly #disposed = new vscode.EventEmitter<void>();
  readonly onDispose = this.#disposed.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: BundleStore,
  ) {
    const dist = vscode.Uri.joinPath(context.extensionUri, "dist", "pdfjs");
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    this.#panel = vscode.window.createWebviewPanel("highwater.preview", "Preview", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist, media] });
    this.#panel.iconPath = vscode.Uri.joinPath(media, "highwater.svg");
    this.#panel.webview.html = this.#html(dist, media);
    this.#panel.onDidDispose(() => {
      clearTimeout(this.#timer);
      this.#disposed.fire();
    });
    this.#panel.webview.onDidReceiveMessage((msg: { type: string; template?: string; message?: string; offset?: number }) => {
      if (msg.type === "ready") {
        this.#ready = true;
        void this.#update();
      } else if (msg.type === "template" && this.#doc && TEMPLATES.includes(msg.template as Template)) {
        const doc = this.#doc;
        void setTemplate(this.context, this.store, doc, msg.template as Template).catch((e: unknown) => void vscode.window.showErrorMessage(`Could not save the template: ${(e as Error).message}`));
      } else if (msg.type === "reveal" && typeof msg.offset === "number") void this.#reveal(msg.offset, false);
      else if (msg.type === "jump" && typeof msg.offset === "number") void this.#reveal(msg.offset, true);
      else if (msg.type === "export" && this.#doc) void vscode.commands.executeCommand("highwater.exportPdf", this.#doc.uri);
      else if (msg.type === "exportDocx" && this.#doc) void vscode.commands.executeCommand("highwater.exportDocx", this.#doc.uri);
      else if (msg.type === "error") void vscode.window.showErrorMessage(`Preview: ${msg.message}`);
    });
  }

  show(doc: vscode.TextDocument | undefined): void {
    this.#panel.reveal(undefined, true);
    if (doc) this.follow(doc);
    else if (!this.#doc) void this.#panel.webview.postMessage({ type: "empty", message: "Open a screenplay or manuscript to preview it." });
  }

  follow(doc: vscode.TextDocument): void {
    if (doc === this.#doc) return;
    this.#doc = doc;
    this.#panel.title = `Preview: ${basename(bundleOf(doc) ?? doc.uri.fsPath)}`;
    void this.#update();
  }

  /** Typing refreshes after a pause; saving refreshes now. */
  changed(doc: vscode.TextDocument, saved: boolean): void {
    if (doc !== this.#doc) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#update(), saved ? 0 : 1000);
  }

  /** Editor scrolled: move the preview to the same place (the webview ignores it when sync is off). */
  editorScrolled(editor: vscode.TextEditor): void {
    if (editor.document !== this.#doc || Date.now() < this.#quietUntil) return;
    const top = editor.visibleRanges[0];
    if (top) void this.#panel.webview.postMessage({ type: "scrollTo", offset: editor.document.offsetAt(top.start) });
  }

  /** Preview scrolled or clicked: scroll the editor there, or (jump) put the cursor there too. */
  async #reveal(offset: number, jump: boolean): Promise<void> {
    const doc = this.#doc;
    if (!doc) return;
    const pos = doc.positionAt(offset);
    let editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    if (jump) editor = await vscode.window.showTextDocument(doc, { ...(editor?.viewColumn ? { viewColumn: editor.viewColumn } : {}), preserveFocus: false });
    if (!editor) return;
    if (jump) editor.selection = new vscode.Selection(pos, pos);
    this.#quietUntil = Date.now() + 400;
    editor.revealRange(new vscode.Range(pos, pos), jump ? vscode.TextEditorRevealType.InCenterIfOutsideViewport : vscode.TextEditorRevealType.AtTop);
  }

  bundleChanged(bundle: string): void {
    if (this.#doc && bundleOf(this.#doc) === bundle) this.changed(this.#doc, true);
  }

  dispose(): void {
    this.#panel.dispose();
  }

  async #update(): Promise<void> {
    const doc = this.#doc;
    if (!doc || !this.#ready) return;
    const version = ++this.#version;
    void this.#panel.webview.postMessage({ type: "busy" });
    try {
      const rendered = await renderDocument(this.context, this.store, doc);
      if (version !== this.#version) return; // a newer refresh is on its way
      if (!rendered) {
        void this.#panel.webview.postMessage({ type: "empty", message: "Plain-text documents have no print template to preview." });
        return;
      }
      const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
      const top = editor?.visibleRanges[0];
      const at = top ? doc.offsetAt(top.start) : null;
      void this.#panel.webview.postMessage({ type: "pdf", data: rendered.pdf, template: rendered.template, templates: TEMPLATES, pages: rendered.pages, problems: rendered.problems, anchors: rendered.anchors, at });
    } catch (error) {
      if (version === this.#version) void this.#panel.webview.postMessage({ type: "empty", message: `Could not lay out the document: ${(error as Error).message}` });
    }
  }

  #html(dist: vscode.Uri, media: vscode.Uri): string {
    const w = this.#panel.webview;
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    const uri = (base: vscode.Uri, file: string) => w.asWebviewUri(vscode.Uri.joinPath(base, file)).toString();
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} blob: data:; style-src 'unsafe-inline' ${w.cspSource}; script-src 'nonce-${nonce}' ${w.cspSource}; connect-src ${w.cspSource}; worker-src blob:; font-src ${w.cspSource} data:;">
<style>
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; background: var(--vscode-editorWidget-background, #444); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
#bar { display: flex; gap: 10px; align-items: center; padding: 6px 10px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border, transparent); }
#bar select, #bar button { font: inherit; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, transparent); padding: 2px 6px; }
#bar button[hidden] { display: none; }
#bar button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; padding: 3px 10px; cursor: pointer; }
#status { margin-left: auto; color: var(--vscode-descriptionForeground); }
#pages { flex: 1; overflow: auto; padding: 16px 0; overflow-anchor: none; }
.page { margin: 0 auto 16px; background: white; box-shadow: 0 1px 4px rgba(0,0,0,.4); position: relative; cursor: text; }
.page canvas { display: block; width: 100%; height: 100%; }
#message { padding: 24px; color: var(--vscode-descriptionForeground); }
</style></head>
<body data-pdfjs="${uri(dist, "pdf.min.mjs")}" data-worker="${uri(dist, "pdf.worker.min.mjs")}">
<div id="bar">
  <label>Template <select id="template"></select></label>
  <select id="zoom"><option value="fit">Fit width</option><option value="1">100%</option><option value="1.5">150%</option><option value="0.75">75%</option></select>
  <label title="Keep the preview and the editor at the same place"><input type="checkbox" id="sync" checked> Sync</label>
  <button id="export">Export PDF…</button>
  <button id="exportDocx" hidden>Export .docx…</button>
  <span id="status">Loading…</span>
</div>
<div id="pages"><div id="message"></div></div>
<script nonce="${nonce}" type="module" src="${uri(media, "preview.js")}"></script>
</body></html>`;
  }
}
