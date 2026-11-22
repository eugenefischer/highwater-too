import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeMirrorKey, pageKeys, type Keybinding } from "../src/highland-editor/page-keys.ts";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { contributes: { keybindings: Keybinding[] } };
const bindings = manifest.contributes.keybindings;

describe("keys the page leaves to VS Code", () => {
  it("are every keybinding of the custom editor, in CodeMirror's notation", () => {
    const mac = pageKeys(bindings, true);
    expect(mac).toEqual(expect.arrayContaining(["Meta-b", "Meta-i", "Meta-u", "Ctrl-Shift-=", "Meta-Shift-.", "Meta-y", "Meta-/", "Ctrl-u", "Ctrl-Shift-u", "Meta-0", "Alt-Meta-x", "Alt-Meta-c", "Meta-1", "Meta-e", "Ctrl-m", "Ctrl-Alt-m", "Ctrl-g", "Meta-Shift-i", "Meta-=", "Meta--", "Meta-Alt-0"]));
    const other = pageKeys(bindings, false);
    expect(other).toEqual(expect.arrayContaining(["Ctrl-b", "Ctrl-u", "Ctrl-Alt-x", "Ctrl-e", "Ctrl-="]));
    // Mac-only keybindings (Omit ⌘Y, ⌃U capitals) leave those keys alone elsewhere: Ctrl+Y is redo there.
    expect(other).not.toContain("Ctrl-y");
    const count = bindings.filter((b) => (b.when ?? "").includes("activeCustomEditorId == 'highwater.highlandEditor'")).length;
    expect(mac.length).toBeGreaterThan(count / 2);
  });

  it("names every key the manifest uses, or says which one it can't", () => {
    for (const b of bindings) for (const k of [b.key, b.mac, b.win, b.linux]) if (k) expect(() => codeMirrorKey(k), k).not.toThrow();
    expect(codeMirrorKey("alt+cmd+x")).toBe("Alt-Meta-x");
    expect(() => codeMirrorKey("ctrl+f5")).toThrow(/needs a CodeMirror name/);
  });
});
