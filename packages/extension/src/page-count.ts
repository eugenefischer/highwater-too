import * as vscode from "vscode";
import { MODES } from "./language.ts";
import { onDidChangeTemplate, renderDocument } from "./render-document.ts";
import type { BundleStore } from "./store.ts";
import { activeDocument, onDidChangeActiveSurface } from "./surface.ts";

/**
 * The exact page count, as Highland shows it under its text: the document laid out with its print
 * template and options (no PDF drawn), a second after typing stops. Every page, the title page too
 * (Highland's 57 for Astounding is its PDF's 57).
 */
const counts = new Map<string, number>();
const changed = new vscode.EventEmitter<vscode.TextDocument>();
export const onDidChangePageCount = changed.event;

/** The last exact count for a document, or undefined until its first layout is done. */
export function pageCountOf(doc: vscode.TextDocument): number | undefined {
  return counts.get(doc.uri.toString());
}

/** After typing stops, a layout takes this long to start. */
const PAUSE = 1000;

export function registerPageCounts(context: vscode.ExtensionContext, store: BundleStore): void {
  const timers = new Map<string, NodeJS.Timeout>();
  const generation = new Map<string, number>();
  const count = async (doc: vscode.TextDocument): Promise<void> => {
    const key = doc.uri.toString();
    const mine = (generation.get(key) ?? 0) + 1;
    generation.set(key, mine);
    try {
      const laid = await renderDocument(context, store, doc, undefined, false);
      if (generation.get(key) !== mine || !laid) return;
      if (counts.get(key) === laid.pages) return;
      counts.set(key, laid.pages);
      changed.fire(doc);
    } catch {
      // A document that can't be laid out keeps its last count (the preview shows the error).
    }
  };
  const schedule = (doc: vscode.TextDocument | undefined, delay: number): void => {
    if (!doc || !MODES.has(doc.languageId)) return;
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void count(doc);
    }, delay));
  };
  context.subscriptions.push(
    changed,
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length && (counts.has(e.document.uri.toString()) || e.document === activeDocument())) schedule(e.document, PAUSE);
    }),
    // A template or print option changed (the title page, synopses and notes change the count).
    onDidChangeTemplate((doc) => schedule(doc, 0)),
    // Counted when first shown; a language change reopens the document.
    onDidChangeActiveSurface(() => {
      const doc = activeDocument();
      if (doc && !counts.has(doc.uri.toString())) schedule(doc, 0);
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => doc === activeDocument() && schedule(doc, 0)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      counts.delete(doc.uri.toString());
      generation.delete(doc.uri.toString());
    }),
  );
  schedule(activeDocument(), 0);
}
