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

/**
 * Opens a .highland file's script as the writer does, in the Highwater Editor, and waits until the
 * page is ready and the document has its language. (The tests use the editor writers use: VS Code's
 * text editor is a plain view, tested only where that is the point.)
 */
async function openScript(path: string, language = "highland-fountain"): Promise<vscode.TextDocument> {
  return openInEditor(highland(path), language);
}

/** Types at the end of the document in the active Highwater Editor, as the writer would, and waits for it in the document. */
async function typeAtEnd(uri: vscode.Uri, text: string): Promise<void> {
  await selectInView(documentAt(uri).getText().length);
  await vscode.commands.executeCommand("highwater.test.typeInView", text);
  await until("the typing in the document", async () => documentAt(uri).getText().endsWith(text));
}

/** What the Highwater Editor's sidebar shows (the page reports it as it changes). */
const sidebarState = () => vscode.commands.executeCommand<{ panel?: string; open?: boolean } | undefined>("highwater.test.sidebarState");

type Surface = { document?: string; view: boolean; ready?: boolean; selection?: { anchor: number; head: number }; focused?: string; focusedText?: string };
const surface = () => vscode.commands.executeCommand<Surface>("highwater.test.surface");

const untilAny = (what: string, ok: () => Promise<boolean>, ms?: number) => until(what, ok, ms);

async function until(what: string, ok: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what} (${JSON.stringify({ ...(await surface()), focusedText: undefined })})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The open document at a URI (a script gets a new TextDocument when it is given its language). */
const documentAt = (uri: vscode.Uri) => vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())!;

/**
 * Opens a document in the Highwater Editor and waits until its page is ready and the document has
 * its language. Highwater's editing commands work there only (VS Code's text editor is a plain view).
 */
async function openInEditor(uri: vscode.Uri, language = "highland-fountain"): Promise<vscode.TextDocument> {
  await vscode.commands.executeCommand("vscode.openWith", uri, "highwater.highlandEditor");
  await until("the Highwater Editor", async () => {
    const s = await surface();
    return s.view && s.ready === true && s.document === uri.toString();
  });
  await waitFor(`${language} on ${uri.path}`, () => documentAt(uri)?.languageId === language);
  return documentAt(uri);
}

/** Selects in the active Highwater Editor (offsets in the document). */
async function selectInView(anchor: number, head = anchor): Promise<void> {
  assert.ok(await vscode.commands.executeCommand<boolean>("highwater.test.selectInView", anchor, head), "the page selected");
}

const tests: [string, () => Promise<void>][] = [
  [
    "VS Code's text editor finds words by Highwater's rule (the Highwater Editor's own word tests are page tests)",
    async () => {
      // Not "Plain.fountain" or "Kettle.fountain": other tests open those.
      const path = join(dir, "Words.fountain");
      await writeFile(path, "INT. HALL - DAY\n\nMARLOWE\nHello, Zoë. Don’t, O'BRIEN.\n");
      const doc = await vscode.workspace.openTextDocument(path);
      await waitFor("Fountain language", () => doc.languageId === "highland-fountain");
      const range = doc.getWordRangeAtPosition(new vscode.Position(2, 3));
      assert.equal(range && doc.getText(range), "MARLOWE");
      const accented = doc.getWordRangeAtPosition(new vscode.Position(3, 9));
      assert.equal(accented && doc.getText(accented), "Zoë");
      const contraction = doc.getWordRangeAtPosition(new vscode.Position(3, 14));
      assert.equal(contraction && doc.getText(contraction), "Don’t");
      const name = doc.getWordRangeAtPosition(new vscode.Position(3, 22));
      assert.equal(name && doc.getText(name), "O'BRIEN");
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
      const uri = highland(path);
      await openScript(path);
      await selectInView(0);
      await vscode.commands.executeCommand("highwater.test.typeInView", "EDITED IN VS CODE\n\n");
      await until("the typing in the document", async () => documentAt(uri).getText().startsWith("EDITED IN VS CODE\n\n"));
      assert.equal(await documentAt(uri).save(), true);
      const after = (await readBundle(path)).bundle;
      assert.equal(after.text, "EDITED IN VS CODE\n\n" + before.text);
      for (const p of before.paths) if (p !== before.textPath && p !== "info.json") assert.deepEqual(after.get(p), before.get(p), p);
      assert.equal((await readdir(join(dir, "history", "backups", "Save"))).length, 1);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
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
        const want = name.endsWith(".highland") ? highland(file.fsPath) : file;
        // It opens where the writer writes: the Highwater Editor.
        await until(`${name} open in the Highwater Editor as ${language}`, async () => {
          const s = await surface();
          return s.view && s.ready === true && s.document === want.toString() && documentAt(want)?.languageId === language;
        });
        assert.equal(documentAt(want).getText(), "", name);
      }
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    },
  ],
  [
    "jumps between markers in a screenplay",
    async () => {
      const path = join(dir, "Complete.fountain");
      await writeFile(path, "INT. KITCHEN - DAY\n\nBOB\nHi. {{%m: here}}\n\nBO");
      const doc = await openInEditor(vscode.Uri.file(path));
      await selectInView(0);
      await vscode.commands.executeCommand("highwater.nextMarker");
      const want = doc.getText().indexOf("{{%m");
      await until("the cursor at the marker", async () => (await surface()).selection?.head === want);
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "reloads an unmodified editor when another program saves the file",
    async () => {
      const path = await copyOf("External");
      const uri = highland(path);
      await openScript(path);
      await new Promise((r) => setTimeout(r, 500)); // let the watcher start
      const { bundle } = await readBundle(path);
      bundle.text = "Changed by Highland.";
      await writeBundle(path, bundle);
      await waitFor("the editor to reload", () => documentAt(uri).getText() === "Changed by Highland.");
      // The Highwater Editor takes the new text without sending anything back.
      await new Promise((r) => setTimeout(r, 1000));
      assert.equal(documentAt(uri).getText(), "Changed by Highland.");
      assert.equal(documentAt(uri).isDirty, false);
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    },
  ],
  [
    "gives scripts the Highwater Fountain language, an outline, highlighting and folding",
    async () => {
      const path = await copyOf("Language");
      // Language features need no editor (they serve both).
      await vscode.workspace.openTextDocument(highland(path));
      await waitFor("highland-fountain", () => documentAt(highland(path))?.languageId === "highland-fountain");
      const doc = documentAt(highland(path));
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
      const uri = highland(path);
      let doc = await openInEditor(uri);
      // A line added from elsewhere (as another editor would), which the page takes in.
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, doc.positionAt(doc.getText().length), "\n\nShe runs home.");
      assert.ok(await vscode.workspace.applyEdit(edit), "the edit applies");
      doc = documentAt(uri);
      const at = doc.getText().lastIndexOf("runs");
      await selectInView(at, at + 4);
      const last = () => documentAt(uri).lineAt(documentAt(uri).lineCount - 1).text;
      await vscode.commands.executeCommand("highwater.bold");
      assert.equal(last(), "She **runs** home.");
      await vscode.commands.executeCommand("highwater.bold");
      assert.equal(last(), "She runs home.");
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "exports a screenplay as a PDF from inside VS Code",
    async () => {
      const path = await copyOf("Export");
      const doc = await openScript(path);
      const before = doc.getText();
      const out = vscode.Uri.file(join(dir, "Export.pdf"));
      // As the editor title button calls it: the document's URI first, then (tests only) the target.
      await vscode.commands.executeCommand("highwater.exportPdf", doc.uri, { target: out });
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
      const doc = await openInEditor(highland(path));
      let n = doc.lineCount - 1;
      while (n > 0 && doc.lineAt(n).isEmptyOrWhitespace) n--;
      const line = doc.lineAt(n);
      await selectInView(doc.offsetAt(line.range.start), doc.offsetAt(line.range.end));
      await vscode.commands.executeCommand("highwater.copyToBin");
      await until("the Bin item in the file", async () => JSON.stringify((await readBundle(path)).bundle.binItems) === JSON.stringify([line.text]));
      assert.equal((await readBundle(path)).bundle.text, documentAt(highland(path)).getText(), "the script is untouched");
      // In the Highwater Editor the Scratchpad is a panel of its sidebar.
      await vscode.commands.executeCommand("highwater.showSidebarPanel", "navigator");
      await until("the Navigator in the sidebar", async () => (await sidebarState())?.panel === "navigator");
      await vscode.commands.executeCommand("highwater.openScratchpad");
      await until("the Scratchpad in the sidebar", async () => {
        const s = await sidebarState();
        return s?.panel === "scratchpad" && s.open === true;
      });
      assert.equal((await readBundle(path)).bundle.scratchpad, "");
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    },
  ],
  [
    "opens the Title Page Builder",
    async () => {
      const path = await copyOf("Tools");
      await openInEditor(highland(path));
      await vscode.commands.executeCommand("highwater.titlePageBuilder");
      await waitFor("title page panel", () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.label === "Title Page")));
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
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
        const uri = highland(path);
        await openScript(path);
        await typeAtEnd(uri, "\n\nShe writes it down.");
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
        await typeAtEnd(uri, "\n\nAnd sends it away.");
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
        const doc = await openScript(path);
        const append = (text: string) => typeAtEnd(doc.uri, text);
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
        await vscode.commands.executeCommand("highwater.test.revert", path, first.hash);
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
        const doc = await openInEditor(vscode.Uri.file(path));
        const line = doc.lineAt(2);
        await selectInView(doc.offsetAt(line.range.start), doc.offsetAt(line.range.end));
        // The first Bin item of a plain file says, once, where it is kept.
        await vscode.commands.executeCommand("highwater.test.answer", "Continue");
        await vscode.commands.executeCommand("highwater.copyToBin");
        const asked: { message: string; choices: string[] }[] = [];
        await until("the once-only notice about plain files", async () => {
          asked.push(...((await vscode.commands.executeCommand<{ message: string; choices: string[] }[]>("highwater.test.asked")) ?? []));
          return asked.some((q) => q.message.includes("can’t hold a Bin or Scratchpad") && q.choices.includes("Continue"));
        });
        const index = () => JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { branch: string; paths: string[] }> };
        const binFile = () => {
          try {
            const found = Object.entries(index().documents).find(([, e]) => e.paths.includes(path));
            return found ? readFileSync(join(historyDir, "extras", found[0], "bin", "0.txt"), "utf8") : null;
          } catch {
            return null;
          }
        };
        await until("the Bin item kept with the history", async () => binFile() === "A kettle boils.");
        const [, entry] = Object.entries(index().documents).find(([, e]) => e.paths.includes(path))!;
        assert.equal(await readFile(path, "utf8"), "INT. KITCHEN - NIGHT\n\nA kettle boils.\n", "the file is untouched");
        // In the Highwater Editor the Scratchpad is a panel of its sidebar.
        await vscode.commands.executeCommand("highwater.showSidebarPanel", "navigator");
        await until("the Navigator in the sidebar", async () => (await sidebarState())?.panel === "navigator");
        await vscode.commands.executeCommand("highwater.openScratchpad");
        await until("the Scratchpad in the sidebar", async () => (await sidebarState())?.panel === "scratchpad");
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
        const doc = await openInEditor(vscode.Uri.file(path));
        await selectInView(doc.offsetAt(doc.lineAt(2).range.start), doc.offsetAt(doc.lineAt(2).range.end));
        await vscode.commands.executeCommand("highwater.copyToBin");
        // The page's Bin change reaches the history's extras folder a moment later.
        await until("the Bin item kept with the history", async () => {
          try {
            const index = JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { paths: string[] }> };
            const found = Object.entries(index.documents).find(([, e]) => e.paths.includes(path));
            return !!found && readFileSync(join(historyDir, "extras", found[0], "bin", "0.txt"), "utf8") === "The clock strikes.";
          } catch {
            return false;
          }
        });
        const highland = join(dir, "Round.highland");
        // Each conversion offers to move the old file to the Trash: keep it.
        await vscode.commands.executeCommand("highwater.test.answer", "Keep", "Keep");
        await vscode.commands.executeCommand("highwater.convertToHighland", vscode.Uri.file(path), { target: vscode.Uri.file(highland) });
        const b = (await readBundle(highland)).bundle;
        assert.equal(b.text, original);
        assert.deepEqual(b.binItems, ["The clock strikes."]);
        const id = (b.info as { highwaterToo?: { documentId?: string } }).highwaterToo?.documentId;
        assert.ok(id, "the .highland file carries the work's ID");
        await until("the .highland file in the Highwater Editor", async () => {
          const s = await surface();
          const script = vscode.Uri.file(highland).with({ scheme: "highland" });
          return s.view && s.document === script.toString() && documentAt(script)?.languageId === "highland-fountain";
        });
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
      }
    },
  ],
  [
    "exports a manuscript, with its image, as a PDF",
    async () => {
      const path = join(dir, "ManuscriptExport.highland");
      await copyFile(join(dirname(fixture), "ManuscriptEdgeCases.highland"), path);
      const doc = await openScript(path, "highland-markdown");
      const out = vscode.Uri.file(join(dir, "ManuscriptExport.pdf"));
      await vscode.commands.executeCommand("highwater.exportPdf", doc.uri, { target: out });
      const bytes = await readFile(out.fsPath);
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
      assert.ok(new TextDecoder("latin1").decode(bytes).includes("/Subtype /Image"), "the image is in the PDF");
    },
  ],
  [
    "the panes follow the Highwater Editor, and it scrolls where they ask",
    async () => {
      const path = join(dir, "Styled.fountain");
      await writeFile(path, "INT. HALL - DAY\n\nMARLOWE\nHello.\n");
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(path), "highwater.highlandEditor");
      type Surface = { document?: string; view: boolean; ready?: boolean; selection?: { anchor: number; head: number }; focused?: string };
      const surface = () => vscode.commands.executeCommand<Surface>("highwater.test.surface");
      let now: Surface = { view: false };
      const end = Date.now() + 10_000;
      while (!(now = await surface()).view || now.focused !== path) {
        if (Date.now() > end) throw new Error(`The panes did not follow the Highwater Editor: ${JSON.stringify(now)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(now.document, vscode.Uri.file(path).toString());
      // The page answers a reveal by moving its cursor, and reports the selection back.
      await vscode.commands.executeCommand("highwater.test.revealInView", 17);
      const until = Date.now() + 10_000;
      while ((now = await surface()).selection?.head !== 17) {
        if (Date.now() > until) throw new Error(`The Highwater Editor did not move its cursor: ${JSON.stringify(now)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      // A writing key works there: ⌘B with nothing selected adds the pair and puts the cursor inside.
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === path)!;
      await vscode.commands.executeCommand("highwater.bold");
      assert.equal(doc.getText().slice(17, 21), "****");
      const after = Date.now() + 10_000;
      while ((now = await surface()).selection?.head !== 19) {
        if (Date.now() > after) throw new Error(`The Highwater Editor did not put the cursor inside the bold pair: ${JSON.stringify(now)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      await doc.save(); // closing an unsaved editor would ask
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "VS Code opens a .fountain file in the Highwater Editor, and Reopen Editor With → Text Editor stays text",
    async () => {
      const events: string[] = [];
      const note = (what: string) => events.push(`${Date.now() % 1_000_000} ${what}`);
      const name = (t: vscode.Tab) => `${t.label}:${t.input instanceof vscode.TabInputCustom ? "highwater" : t.input instanceof vscode.TabInputText ? "text" : "other"}${t.isActive ? "*" : ""}`;
      const watch = vscode.window.tabGroups.onDidChangeTabs((e) => note(`tabs opened=[${e.opened.map(name)}] closed=[${e.closed.map(name)}] changed=[${e.changed.map(name)}]`));
      const until = async (what: string, test: () => boolean) => {
        try {
          await waitFor(what, test);
        } catch (e) {
          throw new Error(`${(e as Error).message}\n${events.join("\n")}`);
        }
      };
      try {
        const path = join(dir, "Default.fountain");
        await writeFile(path, "INT. HALL - DAY\n\nMARLOWE\nHello.\n");
        const uri = vscode.Uri.file(path).toString();
        const kinds = () =>
          vscode.window.tabGroups.all
            .flatMap((g) => g.tabs)
            .filter((t) => (t.input instanceof vscode.TabInputText || t.input instanceof vscode.TabInputCustom) && t.input.uri.toString() === uri)
            .map((t) => (t.input instanceof vscode.TabInputCustom ? "highland" : "text"));
        // As the Explorer opens it: VS Code picks the editor (the Highwater Editor is the default for .fountain).
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path));
        await until("the Highwater Editor", () => kinds().join() === "highland");
        assert.ok(!events.some((e) => e.includes("Default.fountain:text")), `opened as text first:\n${events.join("\n")}`);
        // VS Code's own Reopen Editor With… → Text Editor: the writer's choice, which nothing undoes.
        await vscode.commands.executeCommand("reopenActiveEditorWith", "default");
        await until("the text editor from Reopen Editor With", () => kinds().join() === "text");
        await new Promise((r) => setTimeout(r, 1500));
        assert.equal(kinds().join(), "text", `Reopen Editor With → Text Editor was undone.\n${events.join("\n")}`);
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      } finally {
        watch.dispose();
      }
    },
  ],
  [
    "opens a .highland file from the Explorer straight into the Highwater Editor, never showing it as text first",
    async () => {
      const path = await copyOf("NoFlash");
      const script = highland(path).toString();
      let shownAsText = false;
      const watch = vscode.window.tabGroups.onDidChangeTabs((e) => {
        for (const t of [...e.opened, ...e.changed]) if (t.input instanceof vscode.TabInputText && t.input.uri.toString() === script) shownAsText = true;
      });
      try {
        // As a double-click in the Explorer opens it: the file itself, which the redirect takes.
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path));
        await waitFor("the Highwater Editor", () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "highwater.highlandEditor" && t.input.uri.toString() === script)), 15_000);
        assert.ok(!shownAsText, "the script showed as text before the Highwater Editor");
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      } finally {
        watch.dispose();
      }
    },
  ],
  [
    "the panes follow edits made in the Highwater Editor to a .highland file (a marker reaches the Navigator's document)",
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
      await until("the Highwater Editor", (s) => s.view && s.ready === true && s.focused === path);
      await vscode.commands.executeCommand("highwater.test.answer", "From test");
      await vscode.commands.executeCommand("highwater.insertMarker");
      await until("the marker in the focused document's text", (s) => s.focusedText?.includes("{{%m: From test}}") === true);
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "a .highland script's own URI (as a Search result opens it) opens the Highwater Editor, not text",
    async () => {
      const path = await copyOf("SearchResult");
      const script = highland(path).toString();
      let shownAsText = false;
      const watch = vscode.window.tabGroups.onDidChangeTabs((e) => {
        for (const t of [...e.opened, ...e.changed]) if (t.input instanceof vscode.TabInputText && t.input.uri.toString() === script) shownAsText = true;
      });
      try {
        // A Search result's line can't reach a custom editor: the document opens at the top.
        await vscode.commands.executeCommand("vscode.open", highland(path), { selection: new vscode.Range(3, 0, 3, 0) });
        await waitFor("the Highwater Editor", () => vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === "highwater.highlandEditor" && t.input.uri.toString() === script)), 15_000);
        assert.ok(!shownAsText, "the script showed as text");
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      } finally {
        watch.dispose();
      }
    },
  ],
  [
    "undo and redo: the page's steps, VS Code's Edit ▸ Undo and Redo, and the unsaved dot agree",
    async () => {
      const path = join(dir, "UndoSteps.fountain");
      await writeFile(path, "INT. HALL - DAY\n\nStart.\n");
      const uri = vscode.Uri.file(path);
      const start = (await openInEditor(uri)).getText();
      const typed = start.replace("Start.", "Start. One two");
      const text = () => documentAt(uri).getText();
      // With any failure, what the page did and what the extension saw (CI's runs of 0.6.85 failed here).
      await vscode.commands.executeCommand("highwater.test.swapLog"); // from here on
      const until = async (what: string, ok: () => Promise<boolean>) => {
        try {
          await untilAny(what, ok);
        } catch (e) {
          const seen = ((await vscode.commands.executeCommand<string[]>("highwater.test.swapLog")) ?? []).join("\n");
          throw new Error(`${(e as Error).message}\ndocument: ${JSON.stringify(text())}\nlog:\n${seen}`);
        }
      };
      await selectInView(start.indexOf("Start.") + "Start.".length);
      // A burst of typing: one step for the page, an edit (and a VS Code undo step) per letter.
      await vscode.commands.executeCommand("highwater.test.typeInView", " One two");
      await until("the typing in the document", async () => text() === typed);
      assert.ok(documentAt(uri).isDirty, "unsaved after typing");
      // ⌘Z: the whole burst goes, and VS Code is back at the saved text, so no unsaved dot.
      await vscode.commands.executeCommand("highwater.test.pageStep", "undo");
      await until("the page's undo in the document", async () => text() === start);
      await until("no unsaved dot after undoing to the saved text", async () => !documentAt(uri).isDirty);
      // VS Code's Edit ▸ Redo still works after ⌘Z, and takes the page's whole step.
      await vscode.commands.executeCommand("redo");
      await until("Edit ▸ Redo: the whole burst back", async () => text() === typed);
      // VS Code's Edit ▸ Undo: the page's step too, not one letter.
      await vscode.commands.executeCommand("undo");
      await until("Edit ▸ Undo: the whole burst gone", async () => text() === start);
      assert.ok(!documentAt(uri).isDirty, "no unsaved dot after Edit ▸ Undo to the saved text");
      // ⇧⌘Z after Edit ▸ Undo.
      await vscode.commands.executeCommand("highwater.test.pageStep", "redo");
      await until("the page's redo in the document", async () => text() === typed);
      // Nothing left to redo: Edit ▸ Redo leaves the text as it is.
      await vscode.commands.executeCommand("redo");
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(text(), typed, "Edit ▸ Redo with nothing to redo");
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "the Works view in VS Code's sidebar lists the works with no document open, and opens one",
    async () => {
      const historyDir = join(dir, "history");
      const config = () => vscode.workspace.getConfiguration("highwater");
      await config().update("historyFolder", historyDir, vscode.ConfigurationTarget.Global);
      await config().update("writingHistory", true, vscode.ConfigurationTarget.Global);
      try {
        const path = join(dir, "Shelf.fountain");
        await writeFile(path, "INT. LIBRARY - NIGHT\n\nA shelf of scripts.\n");
        const doc = await vscode.workspace.openTextDocument(path);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, doc.positionAt(doc.getText().length), "\nIt hums.\n");
        assert.ok(await vscode.workspace.applyEdit(edit), "the edit applies");
        await doc.save();
        await waitFor("the work in the writing history", () => {
          try {
            const index = JSON.parse(readFileSync(join(historyDir, "index.json"), "utf8")) as { documents: Record<string, { paths: string[] }> };
            return Object.values(index.documents).some((d) => d.paths.some((p) => p.endsWith("Shelf.fountain")));
          } catch {
            return false;
          }
        }, 20_000);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        type WorksView = { ready: boolean; works: { title: string; file: string; kind: string }[]; handled?: boolean };
        const view = (msg?: object) => vscode.commands.executeCommand<WorksView>("highwater.test.worksView", msg);
        // VS Code's own command for showing a view.
        await vscode.commands.executeCommand("highwater.works.focus");
        let works: WorksView["works"] = [];
        await until("the Works view, listing the work", async () => {
          const v = await view();
          works = v.works;
          return v.ready && works.some((w) => w.file === "Shelf.fountain" && w.kind === "here");
        }, 20_000);
        const i = works.findIndex((w) => w.file === "Shelf.fountain");
        // The view's Open button, as the page posts it.
        assert.equal((await view({ type: "workAction", i, action: "open" })).handled, true);
        await until("the work open in the Highwater Editor", async () => {
          const s = await vscode.commands.executeCommand<{ document?: string; view: boolean }>("highwater.test.surface");
          return s.view && !!s.document?.endsWith("/Shelf.fountain");
        }, 20_000);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      } finally {
        await config().update("writingHistory", false, vscode.ConfigurationTarget.Global);
      }
    },
  ],
  [
    "converts a manuscript's title page to YAML front matter and back",
    async () => {
      const path = join(dir, "TitleForms.md");
      const highland = "Title: A Story\nAuthor: Someone\nContact:\n\tLine one\n\tLine two\n\nText.\n";
      await writeFile(path, highland);
      const uri = vscode.Uri.file(path);
      // A .md file is Highwater Markdown when the writer chooses: give this one the language directly.
      await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(uri), "highland-markdown");
      await openInEditor(uri, "highland-markdown");
      await vscode.commands.executeCommand("highwater.titlePageToYaml");
      await until("the title page in YAML", async () => documentAt(uri).getText() === "---\ntitle: A Story\nauthor: Someone\ncontact: |\n  Line one\n  Line two\n---\n\nText.\n");
      await vscode.commands.executeCommand("highwater.titlePageToHighland");
      await until("the title page in Highland style again", async () => documentAt(uri).getText() === highland);
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "⌘E in the Highwater Editor lays out the pages in place",
    async () => {
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
      await until("the Highwater Editor", (s) => s.view && s.ready === true);
      // The exact page count, laid out in the background for the counts line and status bar.
      await until("the page count", (s) => typeof s.pageCount === "number" && s.pageCount >= 1);
      await vscode.commands.executeCommand("highwater.preview");
      await until("the pages", (s) => (s.pagesSent ?? 0) >= 1);
      await vscode.commands.executeCommand("highwater.preview");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    },
  ],
  [
    "opening a Final Draft file converts it to a .highland file beside it",
    async () => {
      const fdx = join(dir, "Imported.fdx");
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<FinalDraft DocumentType="Script" Template="No" Version="4"><Content><Paragraph Type="Scene Heading"><Text>Int. hall - day</Text></Paragraph><Paragraph Type="Action"><Text>The clock strikes.</Text></Paragraph></Content></FinalDraft>\n`;
      await writeFile(fdx, xml);
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(fdx));
      const path = join(dir, "Imported.highland");
      await until("the converted script open in the Highwater Editor", async () => {
        const s = await surface();
        return s.view && s.document === highland(path).toString();
      });
      assert.equal((await readBundle(path)).bundle.text, "INT. HALL - DAY\n\nThe clock strikes.\n");
      assert.equal(await readFile(fdx, "utf8"), xml, "the .fdx file is unchanged");
    },
  ],
  [
    "exports a manuscript as a Word document",
    async () => {
      const path = join(dir, "DocxExport.highland");
      await copyFile(join(dirname(fixture), "ManuscriptEdgeCases.highland"), path);
      const doc = await openScript(path, "highland-markdown");
      const out = vscode.Uri.file(join(dir, "DocxExport.docx"));
      await vscode.commands.executeCommand("highwater.exportDocx", doc.uri, { target: out });
      const bytes = await readFile(out.fsPath);
      assert.equal(new TextDecoder().decode(bytes.slice(0, 2)), "PK");
      assert.ok(new TextDecoder("latin1").decode(bytes).includes("word/document.xml"));
    },
  ],
  [
    "the editor menu's Show/Hide and Enable/Disable pairs set their settings",
    async () => {
      const config = () => vscode.workspace.getConfiguration("highwater");
      const pairs: [string, string, string][] = [
        ["highwater.showParagraphNumbers", "highwater.hideParagraphNumbers", "paragraphNumbers"],
        ["highwater.enableTypewriterScrolling", "highwater.disableTypewriterScrolling", "typewriterScrolling"],
        ["highwater.showPageBreaks", "highwater.hidePageBreaks", "pageBreaks"],
        ["highwater.showSpellingChecks", "highwater.hideSpellingChecks", "spellCheck"],
      ];
      for (const [on, off, key] of pairs) {
        await vscode.commands.executeCommand(on);
        assert.equal(config().get(key), true, `${on} turns ${key} on`);
        await vscode.commands.executeCommand(on);
        assert.equal(config().get(key), true, `${on} again leaves it on`);
        await vscode.commands.executeCommand(off);
        assert.equal(config().get(key), false, `${off} turns ${key} off`);
        await config().update(key, undefined, vscode.ConfigurationTarget.Global);
      }
    },
  ],
];

export async function run(): Promise<void> {
  // Writing history only in its own test: its info.json write would race the other tests' checks.
  await vscode.workspace.getConfiguration("highwater").update("writingHistory", false, vscode.ConfigurationTarget.Global);
  // The extension starts when a document opens; its test commands are needed before that. Scripts
  // open in the Highwater Editor, as for the writer.
  await vscode.extensions.getExtension("eugenefischer.highwater-too")!.activate();
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
