/** Runs inside VS Code's extension host (see run.ts). A minimal runner: no test framework needed. */
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    "treats a whole name as one word (completion, double-click and word moves depend on it)",
    async () => {
      // Not "Plain.fountain" or "Kettle.fountain": other tests open those.
      const path = join(dir, "Words.fountain");
      await writeFile(path, "INT. HALL - DAY\n\nCAMPBELL\nHello, Doña.\n");
      const doc = await vscode.workspace.openTextDocument(path);
      await waitFor("Fountain language", () => doc.languageId === "highland-fountain");
      const range = doc.getWordRangeAtPosition(new vscode.Position(2, 3));
      assert.equal(range && doc.getText(range), "CAMPBELL");
      const accented = doc.getWordRangeAtPosition(new vscode.Position(3, 9));
      assert.equal(accented && doc.getText(accented), "Doña");
    },
  ],
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
      for (const p of before.paths) if (p !== before.textPath && p !== "info.json") assert.deepEqual(after.get(p), before.get(p), p);
      assert.equal((await readdir(join(dir, "history", "backups", "Save"))).length, 1);
    },
  ],
  [
    "New Document makes each kind of blank document and opens it",
    async () => {
      for (const [kind, name, language] of [
        ["screenplay", "New.highland", "highland-fountain"],
        ["manuscript", "NewManuscript.highland", "highland-markdown"],
        ["fountain", "New.fountain", "highland-fountain"],
        ["markdown", "New.md", "highland-markdown"],
      ] as const) {
        const file = vscode.Uri.file(join(dir, name));
        await vscode.commands.executeCommand("highwater.newDocument", kind, file);
        const want = name.endsWith(".highland") ? highland(file.fsPath).toString() : file.toString();
        await waitFor(`${name} open as ${language}`, () => {
          const doc = vscode.window.activeTextEditor?.document;
          return doc?.uri.toString() === want && doc.languageId === language;
        });
        assert.equal(vscode.window.activeTextEditor!.document.getText(), "", name);
      }
    },
  ],
  [
    "completes character names and jumps between markers in a screenplay",
    async () => {
      const path = join(dir, "Complete.fountain");
      // Line 5 is "BO", after an empty line: the cue being typed.
      await writeFile(path, "INT. KITCHEN - DAY\n\nBOB\nHi. {{%m: here}}\n\nBO");
      const doc = await vscode.workspace.openTextDocument(path);
      const editor = await vscode.window.showTextDocument(doc);
      await waitFor("Fountain", () => editor.document.languageId === "highland-fountain");
      const list = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(5, 2));
      assert.ok(list.items.some((i) => (typeof i.label === "string" ? i.label : i.label.label) === "BOB"), "BOB is offered");
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      await vscode.commands.executeCommand("highwater.nextMarker");
      assert.equal(doc.offsetAt(editor.selection.active), doc.getText().indexOf("{{%m"));
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
    "gives scripts the Highwater Fountain language, an outline, highlighting and folding",
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
    "opens .fountain files as Highwater Fountain",
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
    "records a save in the writing history",
    async () => {
      const historyDir = join(dir, "history");
      await vscode.workspace.getConfiguration("highwater").update("historyFolder", historyDir, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration("highwater").update("writingHistory", true, vscode.ConfigurationTarget.Global);
      try {
        const path = await copyOf("History");
        const editor = await openScript(path);
        await editor.edit((e) => e.insert(editor.document.lineAt(editor.document.lineCount - 1).range.end, "\n\nShe writes it down."));
        await vscode.commands.executeCommand("workbench.action.files.save");
        await waitFor("a commit on the document's branch", () => {
          try {
            const index = JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { branch: string }> };
            const branch = Object.values(index.documents)[0]?.branch;
            if (!branch) return false;
            const text = execFileSync("git", ["show", `${branch}:text.fountain`], { cwd: join(historyDir, "history.git"), encoding: "utf8" });
            return text.includes("She writes it down.");
          } catch {
            return false;
          }
        }, 20_000);
        const info = (await readBundle(path)).bundle.info as { highwaterToo?: { documentId?: string } };
        assert.ok(info.highwaterToo?.documentId, "the document ID is stored in info.json");
        // Mirroring to a remote (a local bare repository here) pushes after the next save.
        const remote = join(dir, "remote.git");
        execFileSync("git", ["init", "-q", "--bare", remote]);
        await vscode.workspace.getConfiguration("highwater").update("historyRemote", remote, vscode.ConfigurationTarget.Global);
        await editor.edit((e) => e.insert(editor.document.lineAt(editor.document.lineCount - 1).range.end, "\n\nAnd sends it away."));
        await vscode.commands.executeCommand("workbench.action.files.save");
        await waitFor("the branch on the mirror", () => {
          try {
            return execFileSync("git", ["for-each-ref", "refs/heads/works/"], { cwd: remote, encoding: "utf8" }).trim() !== "";
          } catch {
            return false;
          }
        }, 30_000);
      } finally {
        await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  // The tests drive text editors; the Highland-Style Editor's own tests open it explicitly.
  await vscode.workspace.getConfiguration("highwater").update("highlandEditor", false, vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration("highwater").update("historyRemote", undefined, vscode.ConfigurationTarget.Global);
      }
    },
  ],
  [
    "Revert to This Save saves the document and records the revert at once, saving unsaved changes first",
    async () => {
      const historyDir = join(dir, "history-revert");
      await vscode.workspace.getConfiguration("highwater").update("historyFolder", historyDir, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration("highwater").update("writingHistory", true, vscode.ConfigurationTarget.Global);
      try {
        const path = await copyOf("Revert");
        const editor = await openScript(path);
        const doc = editor.document;
        const append = (text: string) => editor.edit((e) => e.insert(doc.lineAt(doc.lineCount - 1).range.end, text));
        const repo = join(historyDir, "history.git");
        const log = (): { hash: string; date: Date; message: string; text: string }[] => {
          try {
            const index = JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { branch: string }> };
            const branch = Object.values(index.documents)[0]?.branch;
            if (!branch) return [];
            return execFileSync("git", ["log", "--format=%H%x00%aI%x00%s", branch], { cwd: repo, encoding: "utf8" })
              .trim()
              .split("\n")
              .map((l) => {
                const [hash, date, message] = l.split("\0") as [string, string, string];
                return { hash, date: new Date(date), message, text: execFileSync("git", ["show", `${hash}:text.fountain`], { cwd: repo, encoding: "utf8" }) };
              });
          } catch {
            return [];
          }
        };
        await append("\n\nFirst line.");
        await doc.save();
        await waitFor("the first save", () => log()[0]?.text.includes("First line.") ?? false, 20_000);
        const first = log()[0]!;
        await append("\n\nSecond line.");
        await doc.save();
        await waitFor("the second save", () => log()[0]?.text.includes("Second line.") ?? false, 20_000);
        await append("\n\nThird line.");
        assert.ok(doc.isDirty);
        await vscode.commands.executeCommand("highwater.test.answer", "Save and Revert");
        await vscode.commands.executeCommand("highwater.history.revert", { key: path, commit: { hash: first.hash, date: first.date, message: first.message } });
        const asked = (await vscode.commands.executeCommand("highwater.test.asked")) as { message: string; choices: string[] }[];
        assert.ok(asked.some((a) => a.message.includes("has unsaved changes") && a.choices.includes("Revert Without Saving")), JSON.stringify(asked));
        await waitFor("the revert in the history", () => log()[0]?.message.startsWith("Revert") ?? false, 20_000);
        const [revert, saved] = log();
        assert.equal(revert!.text, first.text, "the revert records the earlier save's text");
        assert.ok(saved!.message.startsWith("Save") && saved!.text.includes("Third line."), "the unsaved changes were saved first");
        assert.equal(doc.getText(), first.text);
        assert.ok(!doc.isDirty, "the document is saved");
      } finally {
        await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
      }
    },
  ],
  [
    "gives a plain .fountain file a Bin and Scratchpad, kept and recorded with the writing history",
    async () => {
      const historyDir = join(dir, "history");
      await vscode.workspace.getConfiguration("highwater").update("historyFolder", historyDir, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration("highwater").update("writingHistory", true, vscode.ConfigurationTarget.Global);
      try {
        // Not "Plain.fountain": an earlier test leaves that file open, with other text.
        const path = join(dir, "Kettle.fountain");
        await writeFile(path, "INT. KITCHEN - NIGHT\n\nA kettle boils.\n");
        const doc = await vscode.workspace.openTextDocument(path);
        await waitFor("Fountain language", () => doc.languageId === "highland-fountain");
        const editor = await vscode.window.showTextDocument(doc);
        const line = editor.document.lineAt(2);
        editor.selection = new vscode.Selection(line.range.start, line.range.end);
        // The first Bin item of a plain file says, once, where it is kept.
        await vscode.commands.executeCommand("highwater.test.answer", "Continue");
        await vscode.commands.executeCommand("highwater.copyToBin");
        const asked = await vscode.commands.executeCommand<{ message: string; choices: string[] }[]>("highwater.test.asked");
        assert.ok(asked.some((q) => q.message.includes("can’t hold a Bin or Scratchpad") && q.choices.includes("Continue")), "the once-only notice about plain files is asked");
        const index = () => JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { branch: string; paths: string[] }> };
        const [id, entry] = Object.entries(index().documents).find(([, e]) => e.paths.includes(path))!;
        assert.equal(await readFile(join(historyDir, "extras", id, "bin", "0.txt"), "utf8"), "A kettle boils.");
        assert.equal(await readFile(path, "utf8"), "INT. KITCHEN - NIGHT\n\nA kettle boils.\n", "the file is untouched");
        await vscode.commands.executeCommand("highwater.openScratchpad");
        await waitFor("scratchpad tab", () => vscode.window.activeTextEditor?.document.uri.scheme === "highwater-extras");
        // Edit and save the document itself, not through an editor: VS Code replaces editors as
        // tabs and the sidebar change, and an edit through a replaced one is refused.
        const script = await vscode.workspace.openTextDocument(path);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(script.uri, script.lineAt(2).range.end, " It whistles.");
        assert.ok(await vscode.workspace.applyEdit(edit), "the edit applies");
        assert.ok(await script.save(), "the script saves");
        await waitFor("the Bin in the commit", () => {
          try {
            return execFileSync("git", ["show", `${entry.branch}:bin/0.txt`], { cwd: join(historyDir, "history.git"), encoding: "utf8" }) === "A kettle boils.";
          } catch {
            return false;
          }
        }, 20_000);
      } finally {
        await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  // The tests drive text editors; the Highland-Style Editor's own tests open it explicitly.
  await vscode.workspace.getConfiguration("highwater").update("highlandEditor", false, vscode.ConfigurationTarget.Global);
      }
    },
  ],
  [
    "converts a plain file to a .highland file and back, keeping one writing history",
    async () => {
      const historyDir = join(dir, "history");
      await vscode.workspace.getConfiguration("highwater").update("historyFolder", historyDir, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration("highwater").update("writingHistory", true, vscode.ConfigurationTarget.Global);
      try {
        const path = join(dir, "Round.fountain");
        const original = "INT. HALL - DAY\n\nThe clock strikes.\n";
        await writeFile(path, original);
        const doc = await vscode.workspace.openTextDocument(path);
        await waitFor("Fountain language", () => doc.languageId === "highland-fountain");
        const editor = await vscode.window.showTextDocument(doc);
        editor.selection = new vscode.Selection(editor.document.lineAt(2).range.start, editor.document.lineAt(2).range.end);
        await vscode.commands.executeCommand("highwater.copyToBin");
        const highland = join(dir, "Round.highland");
        // Each conversion offers to move the old file to the Trash: keep it.
        await vscode.commands.executeCommand("highwater.test.answer", "Keep", "Keep");
        await vscode.commands.executeCommand("highwater.convertToHighland", vscode.Uri.file(path), { target: vscode.Uri.file(highland) });
        const b = (await readBundle(highland)).bundle;
        assert.equal(b.text, original);
        assert.deepEqual(b.binItems, ["The clock strikes."]);
        const id = (b.info as { highwaterToo?: { documentId?: string } }).highwaterToo?.documentId;
        assert.ok(id, "the .highland file carries the work's ID");
        await waitFor("the .highland editor", () => vscode.window.activeTextEditor?.document.uri.scheme === "highland" && vscode.window.activeTextEditor.document.languageId === "highland-fountain");
        await vscode.commands.executeCommand("highwater.convertToFountain", undefined, { target: vscode.Uri.file(path) });
        const trash = (await vscode.commands.executeCommand<{ message: string; choices: string[] }[]>("highwater.test.asked")).filter((q) => q.message.includes("to the Trash?"));
        assert.deepEqual(trash.map((q) => q.choices), [["Move to Trash", "Keep"], ["Move to Trash", "Keep"]], "both conversions offered the Trash, with Keep");
        assert.equal(await readFile(path, "utf8"), original);
        const index = JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { branch: string; paths: string[] }>; retired?: string[] };
        const entry = index.documents[id!]!;
        assert.equal(entry.paths.at(-1), path, "the history follows the plain file again");
        assert.ok(index.retired?.includes(highland), "the .highland file is no longer tracked");
        assert.equal(await readFile(join(historyDir, "extras", id!, "bin", "0.txt"), "utf8"), "The clock strikes.");
        const repo = join(historyDir, "history.git");
        const log = execFileSync("git", ["log", "--format=%s", entry.branch], { cwd: repo, encoding: "utf8" }).trim().split("\n");
        assert.deepEqual(log.slice(0, 2).map((m) => m.split(" ")[0]), ["Convert", "Convert"]);
        assert.ok(log[0]!.includes("to Round.fountain") && log[1]!.includes("to Round.highland"), log.join("\n"));
        const record = () => execFileSync("git", ["log", "--format=%h %s", "--name-only", entry.branch], { cwd: repo, encoding: "utf8" });
        assert.equal(execFileSync("git", ["diff", `${entry.branch}~2`, entry.branch, "--", "text.fountain", "bin"], { cwd: repo, encoding: "utf8" }), "", `the text and Bin are unchanged; the branch:\n${record()}`);
      } finally {
        await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  // The tests drive text editors; the Highland-Style Editor's own tests open it explicitly.
  await vscode.workspace.getConfiguration("highwater").update("highlandEditor", false, vscode.ConfigurationTarget.Global);
      }
    },
  ],
  [
    "asks about a duplicated .highland file, and keeps it separate or makes it the work's file",
    async () => {
      const historyDir = join(dir, "history");
      await vscode.workspace.getConfiguration("highwater").update("historyFolder", historyDir, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration("highwater").update("writingHistory", true, vscode.ConfigurationTarget.Global);
      const idOf = async (path: string) => ((await readBundle(path)).bundle.info as { highwaterToo?: { documentId?: string } }).highwaterToo?.documentId;
      const index = () => JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { paths: string[] }> };
      const asked = () => vscode.commands.executeCommand<{ message: string; choices: string[] }[]>("highwater.test.asked");
      const saveEdited = async (path: string, words: string) => {
        const doc = await vscode.workspace.openTextDocument(highland(path));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), `${words}\n\n`);
        assert.ok(await vscode.workspace.applyEdit(edit), "the edit applies");
        assert.ok(await doc.save(), "the script saves");
      };
      try {
        const original = await copyOf("Duplicated");
        await openScript(original);
        await saveEdited(original, "THE ORIGINAL");
        let id: string | undefined;
        for (let i = 0; i < 100 && !(id = await idOf(original)); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(id, "the original has the work's ID");

        // A duplicate kept as a separate work gets an ID and history of its own.
        const separate = join(dir, "Duplicated copy.highland");
        await copyFile(original, separate);
        await vscode.commands.executeCommand("highwater.test.answer", "Keep as a Separate Work");
        await openScript(separate);
        let question: { message: string; choices: string[] } | undefined;
        for (let i = 0; i < 100 && !(question = (await asked()).find((q) => q.message.includes("looks like a copy of Duplicated.highland"))); i++) await new Promise((r) => setTimeout(r, 100));
        assert.deepEqual(question?.choices, ["Keep as a Separate Work", "Make This the Work's File"], "the copy question is asked, with both choices");
        await saveEdited(separate, "THE SEPARATE COPY");
        let other: string | undefined;
        for (let i = 0; i < 100 && (!(other = await idOf(separate)) || other === id); i++) await new Promise((r) => setTimeout(r, 100));
        assert.ok(other && other !== id, "the separate copy names a work of its own");
        assert.equal(index().documents[id]!.paths.at(-1), original, "the work's file is still the original");

        // A duplicate made the work's file takes over the history.
        const taken = join(dir, "Duplicated taken.highland");
        await copyFile(original, taken);
        await vscode.commands.executeCommand("highwater.test.answer", "Make This the Work's File");
        await openScript(taken);
        await waitFor("the duplicate becomes the work's file", () => index().documents[id!]!.paths.at(-1) === taken);
        await saveEdited(taken, "THE WORK GOES ON HERE");
        assert.equal(await idOf(taken), id, "it keeps the work's ID");
      } finally {
        await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  // The tests drive text editors; the Highland-Style Editor's own tests open it explicitly.
  await vscode.workspace.getConfiguration("highwater").update("highlandEditor", false, vscode.ConfigurationTarget.Global);
      }
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
  [
    "the panes follow the Highland-Style Editor, and it scrolls where they ask",
    async () => {
      const path = join(dir, "Styled.fountain");
      await writeFile(path, "INT. HALL - DAY\n\nCAMPBELL\nHello.\n");
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(path), "highwater.highlandEditor");
      type Surface = { document?: string; view: boolean; ready?: boolean; selection?: { anchor: number; head: number }; focused?: string };
      const surface = () => vscode.commands.executeCommand<Surface>("highwater.test.surface");
      let now: Surface = { view: false };
      const end = Date.now() + 10_000;
      while (!(now = await surface()).view || now.focused !== path) {
        if (Date.now() > end) throw new Error(`The panes did not follow the Highland-Style Editor: ${JSON.stringify(now)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(now.document, vscode.Uri.file(path).toString());
      // The page answers a reveal by moving its cursor, and reports the selection back.
      await vscode.commands.executeCommand("highwater.test.revealInView", 17);
      const until = Date.now() + 10_000;
      while ((now = await surface()).selection?.head !== 17) {
        if (Date.now() > until) throw new Error(`The Highland-Style Editor did not move its cursor: ${JSON.stringify(now)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      // A writing key works there: ⌘B with nothing selected adds the pair and puts the cursor inside.
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === path)!;
      await vscode.commands.executeCommand("highwater.bold");
      assert.equal(doc.getText().slice(17, 21), "****");
      const after = Date.now() + 10_000;
      while ((now = await surface()).selection?.head !== 19) {
        if (Date.now() > after) throw new Error(`The Highland-Style Editor did not put the cursor inside the bold pair: ${JSON.stringify(now)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      await doc.save(); // closing an unsaved editor would ask
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "swaps between the text editor and the Highland-Style Editor in place, unsaved changes and all",
    async () => {
      const path = join(dir, "Swap.fountain");
      await writeFile(path, "INT. HALL - DAY\n\nCAMPBELL\nHello.\n");
      const doc = await vscode.workspace.openTextDocument(path);
      await waitFor("Fountain language", () => doc.languageId === "highland-fountain");
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      await editor.edit((e) => e.insert(new vscode.Position(4, 0), "\nShe waits.\n"));
      assert.ok(doc.isDirty);
      const uri = doc.uri.toString();
      const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => (t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputCustom) && t.input.uri.toString() === uri);
      const within = <T>(what: string, p: Thenable<T>) =>
        Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not finish (a save-or-discard question?)`)), 10_000))]);
      await within("Open in Highland-Style Editor", vscode.commands.executeCommand("highwater.openHighlandEditor"));
      await waitFor("one Highland-Style tab", () => tabs().length === 1 && tabs()[0]!.input instanceof vscode.TabInputCustom);
      assert.ok(doc.isDirty, "the unsaved changes are kept");
      await within("Open in Text Editor", vscode.commands.executeCommand("highwater.openTextEditor"));
      await waitFor("one text tab", () => tabs().length === 1 && tabs()[0]!.input instanceof vscode.TabInputText);
      assert.ok(doc.getText().includes("She waits."));
      await doc.save();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "opens scripts in the Highland-Style Editor when it is the default, except after the code button",
    async () => {
      const config = vscode.workspace.getConfiguration("highwater");
      await config.update("highlandEditor", true, vscode.ConfigurationTarget.Global);
      try {
        const path = join(dir, "Default.fountain");
        await writeFile(path, "INT. HALL - DAY\n\nCAMPBELL\nHello.\n");
        const uri = vscode.Uri.file(path).toString();
        const kinds = () =>
          vscode.window.tabGroups.all
            .flatMap((g) => g.tabs)
            .filter((t) => (t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputCustom) && t.input.uri.toString() === uri)
            .map((t) => (t.input instanceof vscode.TabInputCustom ? "highland" : "text"));
        const doc = await vscode.workspace.openTextDocument(path);
        await waitFor("Fountain language", () => doc.languageId === "highland-fountain");
        await vscode.window.showTextDocument(doc, { preview: false });
        await waitFor("the Highland-Style Editor instead of text", () => kinds().join() === "highland");
        await vscode.commands.executeCommand("highwater.openTextEditor");
        await waitFor("the text editor", () => kinds().join() === "text");
        // It stays text: the code button was the writer's choice.
        await new Promise((r) => setTimeout(r, 1000));
        assert.equal(kinds().join(), "text");
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        // VS Code's own Reopen Editor With… → Text Editor (the editor menu in the breadcrumbs bar)
        // is the writer's choice too: it stays text, not switched straight back.
        await vscode.window.showTextDocument(doc, { preview: false });
        await waitFor("the Highwater Editor again", () => kinds().join() === "highland");
        await vscode.commands.executeCommand("reopenActiveEditorWith", "default");
        await waitFor("the text editor from Reopen Editor With", () => kinds().join() === "text");
        await new Promise((r) => setTimeout(r, 1500));
        assert.equal(kinds().join(), "text", "Reopen Editor With → Text Editor was undone");
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      } finally {
        await config.update("highlandEditor", false, vscode.ConfigurationTarget.Global);
      }
    },
  ],
  [
    "the panes follow edits made in the Highland-Style Editor to a .highland file (a marker reaches the Navigator's document)",
    async () => {
      const path = await copyOf("MarkerPanes");
      await vscode.commands.executeCommand("vscode.openWith", highland(path), "highwater.highlandEditor");
      type Surface = { view: boolean; ready?: boolean; focused?: string; focusedText?: string };
      const surface = () => vscode.commands.executeCommand<Surface>("highwater.test.surface");
      const until = async (what: string, ok: (s: Surface) => boolean) => {
        const end = Date.now() + 10_000;
        let now: Surface;
        while (!ok((now = await surface()))) {
          if (Date.now() > end) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify({ ...now, focusedText: now.focusedText?.slice(-80) })}`);
          await new Promise((r) => setTimeout(r, 100));
        }
      };
      await until("the Highland-Style Editor", (s) => s.view && s.ready === true && s.focused === path);
      await vscode.commands.executeCommand("highwater.test.answer", "From test");
      await vscode.commands.executeCommand("highwater.insertMarker");
      await until("the marker in the focused document's text", (s) => s.focusedText?.includes("{{%m: From test}}") === true);
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "a .highland script's own URI with a line (as a Search result opens it) lands on that line, and keeps it when switched to the Highland-Style Editor",
    async () => {
      const path = await copyOf("SearchResult");
      const doc = await vscode.workspace.openTextDocument(highland(path));
      await waitFor("Fountain language", () => vscode.workspace.textDocuments.some((d) => d.uri.toString() === highland(path).toString() && d.languageId === "highland-fountain"));
      const live = vscode.workspace.textDocuments.find((d) => d.uri.toString() === highland(path).toString())!;
      const line = Math.min(10, live.lineCount - 1);
      await vscode.commands.executeCommand("vscode.open", highland(path), { selection: new vscode.Range(line, 0, line, 0) });
      await waitFor("a text editor on the result's line", () => {
        const e = vscode.window.activeTextEditor;
        return e?.document.uri.toString() === highland(path).toString() && e.selection.active.line === line;
      });
      await vscode.commands.executeCommand("highwater.openHighlandEditor");
      type Surface = { view: boolean; selection?: { anchor: number; head: number } };
      const want = live.offsetAt(new vscode.Position(line, 0));
      const end = Date.now() + 10_000;
      let now: Surface = { view: false };
      while (!((now = await vscode.commands.executeCommand<Surface>("highwater.test.surface")).view && now.selection?.head === want)) {
        if (Date.now() > end) {
          // Which tabs there were, to tell a slow swap from a lost one (it failed once on macOS).
          const tabs = vscode.window.tabGroups.all.map((g) => ({
            active: g.isActive,
            tabs: g.tabs.map((t) => ({ label: t.label, active: t.isActive, kind: t.input instanceof vscode.TabInputCustom ? `custom:${t.input.viewType}` : t.input instanceof vscode.TabInputText ? "text" : typeof t.input })),
          }));
          throw new Error(`The Highland-Style Editor did not keep the line: ${JSON.stringify({ ...now, focusedText: undefined })} (wanted ${want}); tabs ${JSON.stringify(tabs)}`);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      void doc;
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "⌘E in the Highland-Style Editor lays out the pages in place, not in a side-by-side Preview",
    async () => {
      // A side-by-side Preview left open by an earlier test would follow this document (and take
      // its name): close it first, so only a Preview this test opens could fail it.
      const previews = vscode.window.tabGroups.all.flatMap((g) => g.tabs.filter((t) => t.label.startsWith("Preview")));
      if (previews.length) await vscode.window.tabGroups.close(previews);
      const path = await copyOf("PreviewInPlace");
      await vscode.commands.executeCommand("vscode.openWith", highland(path), "highwater.highlandEditor");
      type Surface = { view: boolean; ready?: boolean; pagesSent?: number; pageCount?: number };
      const surface = () => vscode.commands.executeCommand<Surface>("highwater.test.surface");
      const until = async (what: string, ok: (s: Surface) => boolean) => {
        const end = Date.now() + 15_000;
        let now: Surface;
        while (!ok((now = await surface()))) {
          if (Date.now() > end) throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(now)}`);
          await new Promise((r) => setTimeout(r, 100));
        }
      };
      await until("the Highland-Style Editor", (s) => s.view && s.ready === true);
      // The exact page count, laid out in the background for the counts line and status bar.
      await until("the page count", (s) => typeof s.pageCount === "number" && s.pageCount >= 1);
      await vscode.commands.executeCommand("highwater.preview");
      await until("the pages", (s) => (s.pagesSent ?? 0) >= 1);
      // The side-by-side Preview didn't open: ⌘E shows the pages in place.
      assert.ok(!vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label.startsWith("Preview: PreviewInPlace"))));
      await vscode.commands.executeCommand("highwater.preview");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "exports a manuscript as a Word document",
    async () => {
      const path = join(dir, "DocxExport.highland");
      await copyFile(join(dirname(fixture), "ManuscriptEdgeCases.highland"), path);
      const editor = await openScript(path, "highland-markdown");
      const out = vscode.Uri.file(join(dir, "DocxExport.docx"));
      await vscode.commands.executeCommand("highwater.exportDocx", editor.document.uri, { target: out });
      const bytes = await readFile(out.fsPath);
      assert.equal(new TextDecoder().decode(bytes.slice(0, 2)), "PK");
      assert.ok(new TextDecoder("latin1").decode(bytes).includes("word/document.xml"));
    },
  ],
];

export async function run(): Promise<void> {
  // Writing history only in its own test: its info.json write would race the other tests' checks.
  await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  // The tests drive text editors; the Highland-Style Editor's own tests open it explicitly.
  await vscode.workspace.getConfiguration("highwater").update("highlandEditor", false, vscode.ConfigurationTarget.Global);
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
