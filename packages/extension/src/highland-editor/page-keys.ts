/**
 * Which key presses the Highwater Editor's page leaves to VS Code. The page is a webview: VS Code
 * hears every key press in it (its webview host passes them all on) and runs the keybindings this
 * extension declares for the custom editor in package.json (⌘B, ⌃M, ⌘E…). The page must do
 * nothing with those keys itself, neither CodeMirror's own bindings nor the browser's (bold for
 * ⌘B), so they are bound in the page to a command that only swallows them.
 *
 * The list comes from package.json at build time (scripts/build.mjs passes the keybindings), so it
 * can't drift from what VS Code runs. The opposite case, keys the page keeps from VS Code (undo and
 * redo, whose VS Code command would undo the document instead of the page), is in webview.ts.
 */
export interface Keybinding {
  key?: string;
  mac?: string;
  win?: string;
  linux?: string;
  when?: string;
}

/** The custom editor's keybindings, in CodeMirror's key notation, for a Mac or not. */
export function pageKeys(bindings: readonly Keybinding[], mac: boolean): string[] {
  const out = new Set<string>();
  for (const b of bindings) {
    if (!/activeCustomEditorId == 'highwater\.highlandEditor'/.test(b.when ?? "")) continue;
    // A Mac uses "mac" when given, else "key"; elsewhere "key" (no keybinding here differs between Windows and Linux).
    const key = mac ? (b.mac ?? b.key) : b.key;
    if (key) out.add(codeMirrorKey(key));
  }
  return [...out];
}

const MODIFIERS: Record<string, string> = { cmd: "Meta", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };

/** A VS Code key ("alt+cmd+x", "ctrl+shift+=") in CodeMirror's notation ("Alt-Meta-x", "Ctrl-Shift-="). */
export function codeMirrorKey(vscodeKey: string): string {
  const parts = vscodeKey.toLowerCase().split("+");
  const key = parts.pop()!;
  const mods = parts.map((p) => {
    const m = MODIFIERS[p];
    if (!m) throw new Error(`Unknown modifier "${p}" in keybinding "${vscodeKey}"`);
    return m;
  });
  if (!/^([a-z0-9]|[=\-/.,;'[\]\\`])$/.test(key)) throw new Error(`Key "${key}" in keybinding "${vscodeKey}" needs a CodeMirror name added here`);
  return [...mods, key].join("-");
}
