/** Runs inside VS Code's extension host (see run.ts). A minimal runner: no test framework needed. */
import * as assert from "node:assert/strict";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readBundle, writeBundle } from "@highwater/bundle";
import * as vscode from "vscode";

const fixture = process.env.HIGHWATER_E2E_FIXTURE!;
const dir = process.env.HIGHWATER_E2E_DIR!;
const highland = (path: string) => vscode.Uri.file(path).with({ scheme: "highland" });

async function copyOf(name: string): Promise<string> {
  const path = join(dir, `${name}.highland`);
  await copyFile(fixture, path);
  return path;
}

async function waitFor(what: string, test: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Opens a .highland script and waits until it has its Highland language (which reopens the document). */
async function openScript(path: string, language = "highland-fountain"): Promise<vscode.TextEditor> {
  const uri = highland(path).toString();
  await vscode.workspace.openTextDocument(highland(path));
  await waitFor(`${language} on ${path}`, () => vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri && d.languageId === language));
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri)!;
  return vscode.window.showTextDocument(doc);
}

const tests: [string, () => Promise<void>][] = [
  [
    "opens the script inside a .highland file as text",
    async () => {
      const path = await copyOf("Open");
      const doc = await vscode.workspace.openTextDocument(highland(path));
      assert.equal(doc.getText(), (await readBundle(path)).bundle.text);
    },
  ],
  [
    "saves edits back into the .highland file, keeping the other entries, and backs it up first",
    async () => {
      await vscode.workspace.getConfiguration("highwater").update("historyFolder", join(dir, "history"), vscode.ConfigurationTarget.Global);
      const path = await copyOf("Save");
      const before = (await readBundle(path)).bundle;
      const editor = await openScript(path);
      await editor.edit((e) => e.insert(new vscode.Position(0, 0), "EDITED IN VS CODE\n\n"));
      assert.equal(await editor.document.save(), true);
      const after = (await readBundle(path)).bundle;
      assert.equal(after.text, "EDITED IN VS CODE\n\n" + before.text);
      for (const p of before.paths) if (p !== before.textPath) assert.deepEqual(after.get(p), before.get(p), p);
      assert.equal((await readdir(join(dir, "history", "backups", "Save"))).length, 1);
    },
  ],
  [
    "opening a .highland file from the Explorer opens its script",
    async () => {
      const path = await copyOf("Explorer");
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path));
      await waitFor("the script editor", () => vscode.window.activeTextEditor?.document.uri.toString() === highland(path).toString());
    },
  ],
  [
    "reloads an unmodified editor when another program saves the file",
    async () => {
      const path = await copyOf("External");
      const doc = (await openScript(path)).document;
      await new Promise((r) => setTimeout(r, 500)); // let the watcher start
      const { bundle } = await readBundle(path);
      bundle.text = "Changed by Highland.";
      await writeBundle(path, bundle);
      await waitFor("the editor to reload", () => doc.getText() === "Changed by Highland.");
      assert.equal(doc.isDirty, false);
    },
  ],
  [
    "gives scripts the Highland Fountain language, an outline, highlighting and folding",
    async () => {
      const path = await copyOf("Language");
      const doc = (await openScript(path)).document;
      const symbols = (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", doc.uri)) ?? [];
      const all: string[] = [];
      const walk = (ss: vscode.DocumentSymbol[]) => ss.forEach((x) => (all.push(x.name), walk(x.children)));
      walk(symbols);
      assert.ok(all.some((n) => n.startsWith("INT.")), `outline: ${all.join(" | ")}`);
      const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>("vscode.provideDocumentSemanticTokens", doc.uri);
      assert.ok(tokens && tokens.data.length > 50, "semantic tokens");
      const folds = (await vscode.commands.executeCommand<vscode.FoldingRange[]>("vscode.executeFoldingRangeProvider", doc.uri)) ?? [];
      assert.ok(folds.length > 0, "folding ranges");
    },
  ],
  [
    "opens .fountain files as Highland Fountain",
    async () => {
      const path = join(dir, "Plain.fountain");
      await writeFile(path, "INT. KITCHEN - DAY\n\nBOB\nHi.\n");
      const doc = await vscode.workspace.openTextDocument(path);
      assert.equal(doc.languageId, "highland-fountain");
    },
  ],
  [
    "formats the selection with Highland's commands",
    async () => {
      const path = await copyOf("Format");
      const editor = await openScript(path);
      const line = editor.document.lineAt(editor.document.lineCount - 1);
      await editor.edit((e) => e.insert(line.range.end, "\n\nShe runs home."));
      const last = editor.document.lineAt(editor.document.lineCount - 1);
      const at = last.text.indexOf("runs");
      editor.selection = new vscode.Selection(last.lineNumber, at, last.lineNumber, at + 4);
      await vscode.commands.executeCommand("highwater.bold");
      assert.equal(editor.document.lineAt(last.lineNumber).text, "She **runs** home.");
      await vscode.commands.executeCommand("highwater.bold");
      assert.equal(editor.document.lineAt(last.lineNumber).text, "She runs home.");
      await vscode.commands.executeCommand("workbench.action.files.revert");
    },
  ],
  [
    "exports a screenplay as a PDF from inside VS Code",
    async () => {
      const path = await copyOf("Export");
      const editor = await openScript(path);
      const before = editor.document.getText();
      const out = vscode.Uri.file(join(dir, "Export.pdf"));
      // As the editor title button calls it: the document's URI first, then (tests only) the target.
      await vscode.commands.executeCommand("highwater.exportPdf", editor.document.uri, { target: out });
      assert.equal((await readBundle(path)).bundle.text, before, "the script is untouched");
      const bytes = await readFile(out.fsPath);
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
      assert.ok(bytes.length > 5000, `PDF of ${bytes.length} bytes`);
    },
  ],
  [
    "copies a selection to the Bin and opens the Scratchpad",
    async () => {
      const path = await copyOf("Panels");
      const editor = await openScript(path);
      let n = editor.document.lineCount - 1;
      while (n > 0 && editor.document.lineAt(n).isEmptyOrWhitespace) n--;
      const line = editor.document.lineAt(n);
      editor.selection = new vscode.Selection(line.range.start, line.range.end);
      await vscode.commands.executeCommand("highwater.copyToBin");
      const bundle = (await readBundle(path)).bundle;
      assert.deepEqual(bundle.binItems, [line.text]);
      assert.equal(bundle.text, editor.document.getText(), "the script is untouched");
      await vscode.commands.executeCommand("highwater.openScratchpad");
      await waitFor("scratchpad tab", () => vscode.window.activeTextEditor?.document.uri.path.endsWith("/scratchpad.txt") === true);
      assert.equal((await readBundle(path)).bundle.scratchpad, "");
      await vscode.commands.executeCommand("highwater.navigator.focus");
    },
  ],
  [
    "toggles Live Margins and opens the Title Page Builder",
    async () => {
      const path = await copyOf("Tools");
      await openScript(path);
      await vscode.commands.executeCommand("highwater.toggleLiveMargins");
      await vscode.commands.executeCommand("highwater.toggleLiveMargins");
      await vscode.commands.executeCommand("highwater.titlePageBuilder");
      await waitFor("title page panel", () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label === "Title Page")));
    },
  ],
  [
    "opens the PDF preview beside the script",
    async () => {
      const path = await copyOf("Preview");
      await openScript(path);
      await vscode.commands.executeCommand("highwater.preview");
      await waitFor("preview panel", () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label === "Preview: Preview.highland")));
    },
  ],
  [
    "exports a manuscript, with its image, as a PDF",
    async () => {
      const path = join(dir, "ManuscriptExport.highland");
      await copyFile(join(dirname(fixture), "ManuscriptEdgeCases.highland"), path);
      const editor = await openScript(path, "highland-markdown");
      const out = vscode.Uri.file(join(dir, "ManuscriptExport.pdf"));
      await vscode.commands.executeCommand("highwater.exportPdf", editor.document.uri, { target: out });
      const bytes = await readFile(out.fsPath);
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
      assert.ok(new TextDecoder("latin1").decode(bytes).includes("/Subtype /Image"), "the image is in the PDF");
    },
  ],
];

export async function run(): Promise<void> {
  const failed: string[] = [];
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed.push(name);
      console.error(`  ✗ ${name}\n`, error);
    }
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  if (failed.length) throw new Error(`${failed.length} of ${tests.length} end-to-end tests failed`);
  console.log(`  ${tests.length} end-to-end tests passed`);
}
