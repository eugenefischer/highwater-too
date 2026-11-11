import * as vscode from "vscode";
import { MODES, type ParseCache } from "./language.ts";
import { countWords, documentStats } from "./syntax/stats.ts";
import { onDidChangePageCount, pageCountOf } from "./page-count.ts";
import { activeDocument, activeSelections, onDidChangeActiveSurface, onDidChangeViewSelection } from "./surface.ts";

/** Word count, the exact page count (once laid out) and reading or screen time, like Highland's stats line. */
export function registerStatusBar(context: vscode.ExtensionContext, cache: ParseCache): void {
  const item = vscode.window.createStatusBarItem("highwater.stats", vscode.StatusBarAlignment.Right, 100);
  item.name = "Highwater Too: document stats";
  let timer: NodeJS.Timeout | undefined;

  const update = (): void => {
    const active = activeSelections();
    const doc = active?.document;
    if (!active || !doc || !MODES.has(doc.languageId)) {
      item.hide();
      return;
    }
    const stats = documentStats(cache.get(doc));
    const n = (x: number) => x.toLocaleString("en-US");
    const selected = active.ranges.reduce((sum, s) => sum + (s.isEmpty ? 0 : countWords(doc.getText(s))), 0);
    const words = selected > 0 ? `${n(selected)} of ${n(stats.words)} words` : `${n(stats.words)} words`;
    // The exact count from the print layout (page-count.ts), once it has been laid out.
    const count = pageCountOf(doc);
    const pages = count === undefined ? "" : `${n(count)} ${count === 1 ? "page" : "pages"}`;
    // Screen time: a minute a printed page, as Highland counts it.
    const minutes = doc.languageId === "highland-fountain" ? (count ?? stats.minutes) : stats.minutes;
    const time = doc.languageId === "highland-fountain" ? `≈ ${n(minutes)} min screen time` : `${n(minutes)} min read`;
    item.text = pages ? `${words} · ${pages}` : words;
    item.tooltip = [`${n(stats.words)} words`, pages, time].filter(Boolean).join("\n");
    item.show();
  };
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(update, 300);
  };

  context.subscriptions.push(
    item,
    { dispose: () => clearTimeout(timer) },
    onDidChangeActiveSurface(later),
    vscode.window.onDidChangeTextEditorSelection(later),
    onDidChangeViewSelection(later),
    onDidChangePageCount((doc) => doc === activeDocument() && later()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === activeDocument()) later();
    }),
    vscode.workspace.onDidOpenTextDocument(later), // language changes reopen the document
  );
  update();
}
