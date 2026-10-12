import { parse, type Document, type Mode } from "@highwater/parser";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { EXTRAS_SCHEME } from "./extras.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { highlightRanges, TOKEN_TYPES } from "./syntax/highlight.ts";
import { outline, type OutlineNode } from "./syntax/structure.ts";

export const LANGUAGES: Record<Mode, string> = { fountain: "highland-fountain", markdown: "highland-markdown", plain: "highland-plain" };
export const MODES = new Map<string, Mode>(Object.entries(LANGUAGES).map(([mode, id]) => [id, mode as Mode]));
const SELECTOR: vscode.DocumentSelector = Object.values(LANGUAGES).map((language) => ({ language }));

export const LEGEND = new vscode.SemanticTokensLegend([...TOKEN_TYPES], []);

/** One parse per document version, shared by highlighting, outline and folding. */
export class ParseCache {
  readonly #docs = new Map<string, { version: number; doc: Document }>();
  get(document: vscode.TextDocument): Document {
    const key = document.uri.toString();
    const hit = this.#docs.get(key);
    if (hit && hit.version === document.version) return hit.doc;
    const doc = parse(document.getText(), { mode: MODES.get(document.languageId) ?? "plain" });
    this.#docs.set(key, { version: document.version, doc });
    return doc;
  }
  forget(document: vscode.TextDocument): void {
    this.#docs.delete(document.uri.toString());
  }
}

export function registerLanguageFeatures(context: vscode.ExtensionContext, store: BundleStore): ParseCache {
  const cache = new ParseCache();

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => void assignLanguage(d, store)),
    vscode.workspace.onDidCloseTextDocument((d) => cache.forget(d)),
    vscode.languages.registerDocumentSemanticTokensProvider(SELECTOR, { provideDocumentSemanticTokens: (d) => semanticTokens(d, cache.get(d)) }, LEGEND),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, { provideDocumentSymbols: (d) => symbols(d, outline(cache.get(d))) }),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, { provideFoldingRanges: (d) => folding(d, cache.get(d)) }),
  );
  for (const d of vscode.workspace.textDocuments) void assignLanguage(d, store);
  return cache;
}

/** A .highland script opens as plain text; give it the language its text file implies. */
async function assignLanguage(doc: vscode.TextDocument, store: BundleStore): Promise<void> {
  // A plain file's Bin items and Scratchpad.
  if (doc.uri.scheme === EXTRAS_SCHEME) {
    if (doc.uri.path.endsWith(".txt") && doc.languageId !== LANGUAGES.plain && !doc.isClosed) await vscode.languages.setTextDocumentLanguage(doc, LANGUAGES.plain);
    return;
  }
  if (doc.uri.scheme !== SCHEME) return;
  const p = splitBundlePath(doc.uri.fsPath);
  if (!p) return;
  let language: string;
  if (p.entry === "") language = LANGUAGES[await store.mode(p.bundle)];
  else if (p.entry.endsWith(".json") || p.entry.endsWith(".dat")) return;
  else language = LANGUAGES.plain;
  if (doc.languageId !== language && !doc.isClosed) await vscode.languages.setTextDocumentLanguage(doc, language);
}

function semanticTokens(document: vscode.TextDocument, doc: Document): vscode.SemanticTokens {
  const builder = new vscode.SemanticTokensBuilder(LEGEND);
  const text = doc.source;
  // Line starts, to split ranges that cross lines (tokens cannot).
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) starts.push(i + 1);
  }
  let line = 0;
  for (const r of highlightRanges(doc)) {
    while (line + 1 < starts.length && starts[line + 1]! <= r.start) line++;
    let s = r.start;
    let l = line;
    while (s < r.end) {
      const lineEnd = l + 1 < starts.length ? starts[l + 1]! : text.length;
      let contentEnd = lineEnd;
      while (contentEnd > starts[l]! && (text.charCodeAt(contentEnd - 1) === 10 || text.charCodeAt(contentEnd - 1) === 13)) contentEnd--;
      const e = Math.min(r.end, contentEnd);
      if (e > s) builder.push(l, s - starts[l]!, e - s, TOKEN_TYPES.indexOf(r.type), 0);
      if (r.end <= lineEnd) break;
      l++;
      s = starts[l]!;
    }
  }
  void document;
  return builder.build();
}

function symbols(document: vscode.TextDocument, nodes: OutlineNode[]): vscode.DocumentSymbol[] {
  const range = (s: { start: number; end: number }) => new vscode.Range(document.positionAt(s.start), document.positionAt(s.end));
  const kind = { section: vscode.SymbolKind.Namespace, heading: vscode.SymbolKind.Namespace, scene: vscode.SymbolKind.Event };
  const convert = (n: OutlineNode): vscode.DocumentSymbol => {
    const sym = new vscode.DocumentSymbol(n.name, "", kind[n.kind], range(n.range), range(n.selection));
    sym.children = n.children.map(convert);
    return sym;
  };
  return nodes.map(convert);
}

function folding(document: vscode.TextDocument, doc: Document): vscode.FoldingRange[] {
  const out: vscode.FoldingRange[] = [];
  const add = (start: number, end: number, kind?: vscode.FoldingRangeKind) => {
    const a = document.positionAt(start).line;
    const b = document.positionAt(end).line;
    if (b > a) out.push(new vscode.FoldingRange(a, b, kind));
  };
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      add(n.range.start, n.range.end);
      walk(n.children);
    }
  };
  walk(outline(doc));
  for (const b of doc.overlays.boneyard) add(b.span.start, b.span.end, vscode.FoldingRangeKind.Comment);
  if (doc.titlePage) add(doc.titlePage.span.start, Math.max(doc.titlePage.span.start, doc.titlePage.span.end - 1), vscode.FoldingRangeKind.Region);
  return out;
}
