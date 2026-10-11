import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { createDocument, writeBundle, type DocumentMode } from "@highwater/bundle";
import * as vscode from "vscode";
import { SCHEME } from "./fs-provider.ts";
import { LANGUAGES } from "./language.ts";
import { openHighland } from "./open.ts";
import { bundleOf, renderDocument, templateOf } from "./render-document.ts";
import { BundleStore, splitBundlePath } from "./store.ts";
import { stripRevisionTags, toggleBoneyard, toggleCentre, toggleWrap, type TextEdit } from "./syntax/edits.ts";

const NEW: Record<string, { mode: DocumentMode; template: string; name: string }> = {
  screenplay: { mode: "fountain", template: "Screenplay", name: "Untitled Screenplay" },
  manuscript: { mode: "markdown", template: "Manuscript", name: "Untitled Manuscript" },
};

export function registerCommands(context: vscode.ExtensionContext, store: BundleStore): void {
  const wrap = (open: string, close = open) => () => applyToSelections((text, s, e) => toggleWrap(text, s, e, open, close));
  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.bold", wrap("**")),
    vscode.commands.registerCommand("highwater.italic", wrap("*")),
    vscode.commands.registerCommand("highwater.underline", wrap("_")),
    vscode.commands.registerCommand("highwater.strikethrough", wrap("~~")),
    vscode.commands.registerCommand("highwater.highlight", wrap("+")),
    vscode.commands.registerCommand("highwater.note", wrap("[[", "]]")),
    vscode.commands.registerCommand("highwater.centre", () => applyToSelections(toggleCentre)),
    vscode.commands.registerCommand("highwater.omit", () => applyToSelections(toggleBoneyard)),
    vscode.commands.registerCommand("highwater.toggleInvisibles", toggleInvisibles),
    vscode.commands.registerCommand("highwater.newScreenplay", () => newDocument("screenplay")),
    vscode.commands.registerCommand("highwater.newManuscript", () => newDocument("manuscript")),
    vscode.commands.registerCommand("highwater.export", exportText),
    vscode.commands.registerCommand("highwater.convertToHighland", convertToHighland),
    vscode.commands.registerCommand("highwater.useForMarkdown", useForMarkdown),
    vscode.commands.registerCommand("highwater.stopUsingForMarkdown", stopUsingForMarkdown),
    // Menus (the editor title button) pass the document's URI; only an explicit option sets where to save.
    vscode.commands.registerCommand("highwater.exportPdf", (resource?: unknown, options?: { target?: vscode.Uri }) =>
      exportPdf(context, store, resource instanceof vscode.Uri ? resource : undefined, options?.target),
    ),
  );
}

/** Applies a text toggle to every selection, last first so earlier offsets stay valid. */
async function applyToSelections(toggle: (text: string, start: number, end: number) => TextEdit): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  let text = doc.getText();
  const sels = [...editor.selections].map((s) => ({ start: doc.offsetAt(s.start), end: doc.offsetAt(s.end) })).sort((a, b) => b.start - a.start);
  const edits: TextEdit[] = [];
  for (const s of sels) {
    const edit = toggle(text, s.start, s.end);
    edits.push(edit);
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  const ok = await editor.edit((b) => {
    for (const e of edits) b.replace(new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text);
  });
  if (!ok) return;
  // Selections in the new text: shift each edit's selection by the length changes of the edits before it.
  const ascending = [...edits].reverse();
  let shift = 0;
  editor.selections = ascending.map((e) => {
    const sel = new vscode.Selection(doc.positionAt(e.selectionStart + shift), doc.positionAt(e.selectionEnd + shift));
    shift += e.text.length - (e.end - e.start);
    return sel;
  });
}

async function toggleInvisibles(): Promise<void> {
  const config = vscode.workspace.getConfiguration("editor", vscode.window.activeTextEditor?.document);
  const current = config.get<string>("renderWhitespace");
  await config.update("renderWhitespace", current === "all" ? "none" : "all", vscode.ConfigurationTarget.Global, true);
}

async function newDocument(kind: "screenplay" | "manuscript"): Promise<void> {
  const spec = NEW[kind]!;
  const folder = defaultFolder();
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(join(folder, `${spec.name}.highland`)),
    filters: { ".highland files": ["highland"] },
    title: `New ${spec.template}`,
  });
  if (!target) return;
  await writeBundle(target.fsPath, createDocument({ mode: spec.mode, template: spec.template }));
  await openHighland(target);
}

/** Export the script as .fountain / .md / .txt, without revision tags. */
async function exportText(): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.uri.scheme !== SCHEME) {
    void vscode.window.showInformationMessage("Open a document to export it.");
    return;
  }
  const p = splitBundlePath(doc.uri.fsPath);
  if (!p || p.entry !== "") return;
  const ext = doc.languageId === LANGUAGES.fountain ? "fountain" : doc.languageId === LANGUAGES.markdown ? "md" : "txt";
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(p.bundle.replace(/\.highland$/i, `.${ext}`)),
    filters: { [ext === "fountain" ? "Fountain" : ext === "md" ? "Markdown" : "Plain text"]: [ext] },
    title: "Export Text",
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(stripRevisionTags(doc.getText())));
  void vscode.window.showInformationMessage(`Exported ${basename(target.fsPath)}`);
}

/** Make a .highland document from a plain .fountain or .md file (the original is left as it is). */
async function convertToHighland(uri?: vscode.Uri): Promise<void> {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!source || source.scheme !== "file") {
    void vscode.window.showInformationMessage("Open or select a .fountain or .md file to convert.");
    return;
  }
  const ext = extname(source.fsPath).toLowerCase();
  const kind = ext === ".fountain" || ext === ".spmd" ? NEW.screenplay! : ext === ".md" || ext === ".markdown" ? NEW.manuscript! : null;
  const mode: DocumentMode = kind?.mode ?? "plain";
  const template = kind?.template ?? "Plain Text";
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === source.toString());
  const text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(source));
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(join(dirname(source.fsPath), `${basename(source.fsPath, extname(source.fsPath))}.highland`)),
    filters: { ".highland files": ["highland"] },
    title: "Save as .highland File",
  });
  if (!target) return;
  await writeBundle(target.fsPath, createDocument({ mode, template, text }));
  await openHighland(target);
}

function defaultFolder(): string {
  const doc = vscode.window.activeTextEditor?.document;
  if (doc && (doc.uri.scheme === "file" || doc.uri.scheme === SCHEME)) {
    const p = splitBundlePath(doc.uri.fsPath);
    return dirname(p ? p.bundle : doc.uri.fsPath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
}

/**
 * Exports a screenplay (the given one, else the active editor's) as a PDF, asking where to save
 * unless `target` is given (tests). Uses the editor's text, so unsaved edits are included, and the
 * document's own "Title Page" print option. Only ever writes a .pdf on disk (file: scheme).
 */
async function exportPdf(context: vscode.ExtensionContext, store: BundleStore, resource?: vscode.Uri, target?: vscode.Uri): Promise<void> {
  const doc = (resource && vscode.workspace.textDocuments.find((d) => d.uri.toString() === resource.toString())) ?? vscode.window.activeTextEditor?.document;
  if (!doc || !doc.languageId.startsWith("highland-")) {
    void vscode.window.showInformationMessage("Open a screenplay or manuscript to export it as a PDF.");
    return;
  }
  const template = await templateOf(context, store, doc);
  if (!template) {
    void vscode.window.showInformationMessage("PDF export works for screenplays and manuscripts; plain-text documents export as text.");
    return;
  }
  const path = bundleOf(doc) ?? doc.uri.fsPath;
  const out =
    target ??
    (await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.replace(/\.(highland|fountain|spmd|md|markdown)$/i, "") + ".pdf"),
      filters: { PDF: ["pdf"] },
      title: `Export PDF (${template} template)`,
    }));
  if (!out) return;
  if (out.scheme !== "file" || !/\.pdf$/i.test(out.fsPath)) {
    void vscode.window.showErrorMessage(`Not exporting: ${out.toString()} is not a .pdf file on disk.`);
    return;
  }
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Exporting ${basename(out.fsPath)}…` }, async () => {
    const result = (await renderDocument(context, store, doc, template))!;
    await vscode.workspace.fs.writeFile(out, result.pdf);
    for (const problem of result.problems) void vscode.window.showWarningMessage(problem);
    if (!target) {
      void vscode.window.showInformationMessage(`Exported ${basename(out.fsPath)} (${template} template, ${result.pages} pages).`, "Open", "Reveal in Finder").then((choice) => {
        if (choice === "Open") void vscode.env.openExternal(out);
        if (choice === "Reveal in Finder") void vscode.commands.executeCommand("revealFileInOS", out);
      });
    }
  });
}


const MD_PATTERNS = ["*.md", "*.markdown"];

/** Opens .md files as Highwater Markdown, everywhere or in this workspace, through files.associations. */
async function useForMarkdown(): Promise<void> {
  const choices = [
    { label: "Everywhere", description: "user settings", target: vscode.ConfigurationTarget.Global },
    ...(vscode.workspace.workspaceFolders?.length ? [{ label: "This workspace", description: "workspace settings", target: vscode.ConfigurationTarget.Workspace }] : []),
  ];
  const picked = await vscode.window.showQuickPick(choices, {
    title: "Open .md files with Highwater Too",
    placeHolder: "VS Code's Markdown preview and Markdown extensions will not apply to them",
  });
  if (!picked) return;
  const config = vscode.workspace.getConfiguration("files");
  const inspect = config.inspect<Record<string, string>>("associations");
  const current = (picked.target === vscode.ConfigurationTarget.Global ? inspect?.globalValue : inspect?.workspaceValue) ?? {};
  const next = { ...current };
  for (const p of MD_PATTERNS) next[p] = LANGUAGES.markdown;
  await config.update("associations", next, picked.target);
  void vscode.window.showInformationMessage(`.md files now open as Highwater Markdown (${picked.label.toLowerCase()}). Files already open change when reopened.`);
}

/** Undoes useForMarkdown in every settings scope where it was set. */
async function stopUsingForMarkdown(): Promise<void> {
  const config = vscode.workspace.getConfiguration("files");
  const inspect = config.inspect<Record<string, string>>("associations");
  let changed = false;
  for (const [value, target] of [
    [inspect?.globalValue, vscode.ConfigurationTarget.Global],
    [inspect?.workspaceValue, vscode.ConfigurationTarget.Workspace],
  ] as const) {
    if (!value || !MD_PATTERNS.some((p) => value[p] === LANGUAGES.markdown)) continue;
    const next = { ...value };
    for (const p of MD_PATTERNS) if (next[p] === LANGUAGES.markdown) delete next[p];
    await config.update("associations", Object.keys(next).length ? next : undefined, target);
    changed = true;
  }
  void vscode.window.showInformationMessage(changed ? ".md files open as ordinary Markdown again." : ".md files were not set to open with Highwater Too.");
}
