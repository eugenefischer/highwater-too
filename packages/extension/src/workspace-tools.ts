import * as vscode from "vscode";
import { LANGUAGES, type ParseCache } from "./language.ts";
import { liveMargins } from "./syntax/margins.ts";
import { BUILDER_FIELDS, readBuilderValues, titlePageEdit, type BuilderValues } from "./syntax/title-builder.ts";
import { activeColumn, activeDocument, viewOf } from "./surface.ts";

const SELECTOR: vscode.DocumentSelector = Object.values(LANGUAGES).map((language) => ({ language }));

/** Live Margins (⌘L) and the Title Page Builder (M6). */
export function registerWorkspaceTools(context: vscode.ExtensionContext, cache: ParseCache): void {
  const KEY = "highwater.liveMargins";
  let on = context.globalState.get<boolean>(KEY, false);
  void vscode.commands.executeCommand("setContext", KEY, on);

  // Live Margins are inlay hints of spaces at the start of lines, not decorations: VS Code wraps
  // lines around inlay hints, but not around decorations, which pushed long lines past the edge.
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.InlayHintsProvider = {
    onDidChangeInlayHints: changed.event,
    provideInlayHints(document, range) {
      if (!on) return [];
      const from = document.offsetAt(range.start);
      const to = document.offsetAt(range.end);
      return liveMargins(cache.get(document))
        .filter(({ at }) => at >= from && at <= to)
        .map(({ at, indent }) => new vscode.InlayHint(document.positionAt(at), "\u00a0".repeat(indent)));
    },
  };

  context.subscriptions.push(
    changed,
    vscode.languages.registerInlayHintsProvider(SELECTOR, provider),
    vscode.commands.registerCommand("highwater.toggleLiveMargins", async () => {
      on = !on;
      await context.globalState.update(KEY, on);
      void vscode.commands.executeCommand("setContext", KEY, on);
      changed.fire();
    }),
    vscode.commands.registerCommand("highwater.titlePageBuilder", () => openBuilder(context, cache)),
  );
}

// ---------------------------------------------------------------------------------------------
// Title Page Builder: a small form like Highland's (fields, then Clear All, Cancel, Insert).

async function openBuilder(context: vscode.ExtensionContext, cache: ParseCache): Promise<void> {
  const document = activeDocument();
  const column = activeColumn();
  if (!document || !document.languageId.startsWith("highland-")) {
    void vscode.window.showInformationMessage("Open a document to build its title page.");
    return;
  }
  const values = readBuilderValues(cache.get(document));
  const panel = vscode.window.createWebviewPanel("highwater.titlePage", "Title Page", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true });
  panel.webview.html = builderHtml(panel.webview, values);
  panel.webview.onDidReceiveMessage(
    async (msg: { type: "insert"; values: BuilderValues } | { type: "cancel" }) => {
      if (msg.type === "insert") {
        // Re-read the document as it is now: the writer may have typed meanwhile.
        const edit = titlePageEdit(cache.get(document), msg.values);
        const we = new vscode.WorkspaceEdit();
        we.replace(document.uri, new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)), edit.text);
        await vscode.workspace.applyEdit(we);
      }
      panel.dispose();
      // Back to the editor the writer came from (the Highwater Editor if that was it).
      const view = viewOf(document);
      if (view) view.panel.reveal(view.panel.viewColumn, false);
      else await vscode.window.showTextDocument(document, column ? { viewColumn: column } : {});
    },
    undefined,
    context.subscriptions,
  );
}

function builderHtml(webview: vscode.Webview, values: BuilderValues): string {
  const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rows = BUILDER_FIELDS.map(
    (f, i) => `<label for="f${i}">${esc(f.label)}</label><textarea id="f${i}" data-label="${esc(f.label)}" rows="${f.label === "Contact info" ? 4 : 2}">${esc(values[f.label])}</textarea>`,
  ).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px 20px; max-width: 520px; }
h1 { font-size: 1.2em; font-weight: 600; margin: 0 0 12px; }
form { display: grid; grid-template-columns: max-content 1fr; gap: 8px 12px; align-items: start; }
label { padding-top: 4px; text-align: right; }
textarea { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 6px; resize: vertical; }
textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
.buttons { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
button { font: inherit; padding: 4px 14px; border: none; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
.clear { margin-right: auto; }
p { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
</style></head><body>
<h1>Title Page</h1>
<form id="form">${rows}</form>
<p>Each line of a field becomes a line on the title page. Other title page fields you have written yourself are kept.</p>
<div class="buttons"><button class="clear" id="clear">Clear All</button><button id="cancel">Cancel</button><button class="primary" id="insert">Insert</button></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const fields = [...document.querySelectorAll("textarea")];
fields[0].focus();
document.getElementById("clear").onclick = () => { fields.forEach((f) => (f.value = "")); fields[0].focus(); };
document.getElementById("cancel").onclick = () => vscode.postMessage({ type: "cancel" });
const insert = () => vscode.postMessage({ type: "insert", values: Object.fromEntries(fields.map((f) => [f.dataset.label, f.value])) });
document.getElementById("insert").onclick = insert;
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) insert();
  if (e.key === "Escape") vscode.postMessage({ type: "cancel" });
});
</script></body></html>`;
}
