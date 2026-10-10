/** Runs inside VS Code's extension host (see run.ts). A minimal runner: no test framework needed. */
import * as assert from "node:assert/strict";
import { copyFile, readdir } from "node:fs/promises";
import { join } from "node:path";
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
      const editor = await vscode.window.showTextDocument(highland(path));
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
      const doc = await vscode.workspace.openTextDocument(highland(path));
      await vscode.window.showTextDocument(doc);
      await new Promise((r) => setTimeout(r, 500)); // let the watcher start
      const { bundle } = await readBundle(path);
      bundle.text = "Changed by Highland.";
      await writeBundle(path, bundle);
      await waitFor("the editor to reload", () => doc.getText() === "Changed by Highland.");
      assert.equal(doc.isDirty, false);
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
