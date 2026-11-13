/**
 * The writing history's work commands: Open Work from History…, Connect to a Work's History…,
 * restoring a work that isn't on this computer, and what follows a pull from the mirror.
 * registerHistory (history.ts) supplies the shared pieces they use.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import * as vscode from "vscode";
import { computerName, formOf, type DocumentFiles, type Form, type History, type SaveKind, type WorkInfo } from "@highwater/history";
import { writeBundle } from "@highwater/bundle";
import { ask, pick } from "./ask.ts";
import type { Connector } from "./connect.ts";
import { toExtras, type PlainExtras } from "./extras.ts";
import { detectAssetsFolder, ExtrasFolder } from "./extras-folder.ts";
import type { FocusedDocument } from "./focus.ts";
import { roleOf, scriptIsOpen } from "./focus.ts";
import { LANGUAGES } from "./language.ts";
import type { HistoryMirror } from "./mirror.ts";
import { openHighland } from "./open.ts";
import type { BundleStore } from "./store.ts";
import { showDocument } from "./surface.ts";
import { toBundle } from "./to-bundle.ts";
import { afterPull, type WorksHost } from "./works.ts";

/** What the work commands share with the rest of the writing history (see registerHistory). */
export interface RestoreCore {
  history(): History;
  /** The history folder (history.ts). */
  historyRoot(): string;
  enabled(): boolean;
  mirror: HistoryMirror;
  connector: Connector;
  store: BundleStore;
  extras: PlainExtras;
  focus: FocusedDocument;
  settle(key: string): Promise<void>;
  lookup(key: string): Promise<{ id: string; branch: string; paused: boolean; copyOf: string | null } | null>;
  commitNow(key: string, kind: SaveKind, note?: string): Promise<void>;
  updateStatus(): Promise<void>;
  view: { refresh(): void };
  works: { refresh(): void };
  worksHost: WorksHost;
  askedJoins: Set<string>;
}

export function restoreCommands(core: RestoreCore) {
  const { history, historyRoot, enabled, mirror, connector, store, extras, focus, settle, lookup, commitNow, updateStatus, view, works, worksHost, askedJoins } = core;

  /**
   * Open Work from History…: any work in the history (pulled from another computer too). A work
   * already on this computer opens; any other is restored exactly as its latest save was kept — a
   * .highland or plain file under its recorded name — and continues the same history. Converting it
   * is a separate step afterwards; going back to an older save is done from the open document.
   */
  async function openWork(): Promise<void> {
    const h = history();
    if (mirror.url) await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Bringing in the writing history…" }, () => pulled(mirror.pull()));
    const works = await h.works();
    if (!works.length) {
      void vscode.window.showInformationMessage(mirror.url ? "The writing history has no works yet." : "The writing history has no works yet. To bring in works saved on another computer, set up the history mirror there and here.");
      return;
    }
    const work = await pick(
      works.map((w) => {
        const here = w.paths.slice().reverse().find((p) => existsSync(p));
        return {
          label: w.title,
          description: here ? basename(here) : w.local ? "history on this computer" : "on the mirror",
          detail: `Last saved ${w.lastSave!.toLocaleString()}${w.file ? ` as ${w.file}` : ""}${w.latest ? ` · ${w.latest.message.replace(/^\S+ \S+ \S+, /, "")}` : ""}`,
          work: w,
          here,
        };
      }),
      { title: "Open Work from History", placeHolder: "Choose a work", matchOnDescription: true },
    );
    if (!work) return;
    if (work.here) return void (await openFile(work.here));
    await restoreWork(work.work);
  }

  /**
   * Connect to a Work's History…: the writer joins the focused document (and its own history, if
   * it has one) to another work, usually one whose file is no longer where it was saved: renamed
   * or moved after Highland 2 removed its ID, say. Nothing finds such a file by itself; this is the
   * writer's choice, and permanent, so it is spelled out and confirmed first.
   */
  async function connectToWork(): Promise<void> {
    const key = focus.key;
    if (!key) return void vscode.window.showInformationMessage("Open a document to connect it to a work's writing history.");
    if (!enabled()) return void vscode.window.showInformationMessage("Turn the writing history on to connect a document to a work's history.");
    const h = history();
    const name = basename(key);
    // Its latest save goes into its own history first, so nothing is left out of the join.
    await settle(key);
    const own = await lookup(key);
    const others = (await h.works()).filter((w) => w.id && w.branch !== own?.branch);
    const missing = others.filter((w) => w.local && w.paths.length > 0 && !w.paths.some((p) => existsSync(p)));
    type Item = vscode.QuickPickItem & { work?: WorkInfo; all?: true };
    const item = (w: WorkInfo): Item => {
      const last = w.paths.at(-1);
      return {
        label: w.title,
        description: last ? basename(last) : (w.file ?? ""),
        detail: [w.lastSave ? `Last saved ${w.lastSave.toLocaleString()}` : "", last ? `was at ${last}` : w.local ? "" : "only on the mirror"].filter(Boolean).join(" · "),
        work: w,
      };
    };
    const title = `Connect ${name} to a work's writing history`;
    let picked = await pick<Item>([...missing.map(item), { label: "Show All Works…", all: true }], {
      title,
      placeHolder: missing.length ? "Works whose file is no longer where it was saved" : "No work's file is missing from where it was saved",
    });
    if (picked?.all) picked = await pick<Item>(others.map(item), { title, placeHolder: "Every work in the writing history" });
    const w = picked?.work;
    if (!w?.id) return;

    const form = formOf(key);
    const kept = w.form;
    const saves = own ? (await h.log(own.id, 10_000)).length : 0;
    const previous = w.paths.filter((p) => p !== key);
    const detail = [
      `${name} becomes the file of “${w.title}”, and its saves continue that work's history${w.lastSave ? ` (last saved ${w.lastSave.toLocaleString()})` : ""}.`,
      own
        ? `${name}'s own writing history (${saves} save${saves === 1 ? "" : "s"}) is joined into the history of “${w.title}” in one merge. Both are kept, but they can never be separated again, and ${name}'s separate history is deleted, here and, when they next sync, on your other computers.`
        : `${name} has no writing history of its own: the history of “${w.title}” continues from ${name} as it is now, Bin and Scratchpad included.`,
      kept && kept !== form ? `“${w.title}” is kept as ${kept === "highland" ? "a .highland file" : `a .${kept} file`}, and continues as ${name}, recorded as a conversion.` : "",
      previous.length ? `The work's previous file (${previous.map((p) => basename(p)).join(", ")}) is no longer tracked: if it turns up again, it starts a history of its own.` : "",
      "This cannot be undone.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const ok = await ask("warning", `Permanently join ${name}${own ? " and its writing history" : ""} to the writing history of “${w.title}”?`, { modal: true, detail }, "Join Permanently");
    if (ok !== "Join Permanently") return;

    if (!w.local && !(await mirror.fetchWork(w.branch))) return;
    connector.forget([key, ...previous]);
    for (const p of previous) await h.retire(p);
    if (own) {
      const id = await h.join(own.id, { id: w.id, branch: w.branch, form: kept }, { form, file: name }, "connected by hand");
      // The work's ID goes into a .highland file; a plain file's Bin and Scratchpad move with it.
      if (form === "highland") {
        await store.update(key, (b) => {
          b.setInfo({ ...b.info, highwaterToo: { ...((b.info.highwaterToo as object | undefined) ?? {}), documentId: id } });
          return ["info.json"];
        });
      } else await extras.moveTo(own.id, id);
      if (mirror.url) mirror.schedule();
      else await h.flushCatalog();
    } else {
      await h.claim({ id: w.id, branch: w.branch }, key);
      // Recorded now (even if nothing changed), so the history shows where the file joined it.
      await commitNow(key, kind(kept, form), `to ${name}, connected by hand`);
    }
    extras.forget();
    await vscode.commands.executeCommand("highwater.panels.refresh");
    view.refresh();
    works.refresh();
    void updateStatus();
    void vscode.window.showInformationMessage(`${name} now continues the writing history of “${w.title}”.`);
  }

  /** A connection to a work kept as another kind of file is a conversion. */
  function kind(kept: Form | null, form: Form): SaveKind {
    return kept && kept !== form ? "convert" : "connect";
  }

  /** Restores a work not on this computer (fetching it first if only the mirror has it). */
  async function restoreWork(w: WorkInfo): Promise<void> {
    const h = history();
    if (!w.local && !mirror.url) return void vscode.window.showErrorMessage(`${w.title}'s history is not on this computer. Set up the history mirror to fetch it.`);
    // Where it goes is asked before anything is fetched, so a cancelled restore leaves nothing here.
    const here = w.local ? (await h.branchLog(w.branch, 1))[0] : undefined;
    const known = here?.form ?? w.form ?? (here ? savedForm(await h.filesAt(here.hash)) : "highland");
    const ext = known === "highland" ? "highland" : known;
    const name = here?.file ?? w.file ?? `${w.title}.${ext}`;
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(), name)),
      filters: { [ext === "highland" ? ".highland files" : `.${ext} files`]: [ext] },
      title: `Restore ${w.title}`,
    });
    if (!target) return;
    const path = target.fsPath;
    if (formOf(path) !== known) {
      void vscode.window.showErrorMessage(`${w.title} is kept as a .${ext} file, and is restored as one. To change that, convert it after restoring.`);
      return;
    }
    if (existsSync(path)) {
      const choice = await ask(
        "warning",
        `${basename(path)} is already in that folder.`,
        { modal: true, detail: "It may have been copied or synced there. Open it instead, or replace it with the restored work?" },
        "Open It",
        "Replace It",
      );
      if (!choice) return;
      if (choice === "Open It") return void (await openFile(path));
    }
    // Only in the catalog: fetch its history now (the writer asked for this work).
    if (!w.local && !(await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Fetching ${w.title}…` }, () => mirror.fetchWork(w.branch)))) return;
    const latest = (await h.branchLog(w.branch, 1))[0];
    if (!latest) return;
    const files = await h.filesAt(latest.hash);
    const form = latest.form ?? savedForm(files);
    if (form !== known) return void vscode.window.showErrorMessage(`${w.title} is now kept as a .${form === "highland" ? "highland" : form} file. Restore it again to choose a name for that.`);
    // The restored file continues the work's history.
    const id = await h.claim(w, path);
    if (form === "highland") await writeBundle(path, toBundle(files, id));
    else {
      // A plain file, exactly as saved: the text, its Bin, Scratchpad and the rest back with
      // Highwater Too, its images in the folder its text refers to, beside it.
      const images = (files.others ?? []).filter((o) => /^assets\/[^/]+$/.test(o.path));
      await writeFile(path, files.script);
      const kept = toExtras(files);
      const folderName = images.length ? (detectAssetsFolder(files.script, images.map((o) => o.path.slice("assets/".length))) ?? `${basename(path, extname(path))} assets`) : null;
      if (folderName) {
        const dir = join(dirname(path), folderName);
        await mkdir(dir, { recursive: true });
        for (const a of images) await writeFile(join(dir, a.path.slice("assets/".length)), a.data);
      }
      if (kept.bin.length || kept.scratchpad !== undefined || kept.document || folderName) {
        const folder = new ExtrasFolder(join(historyRoot(), "extras", id));
        await folder.replace(kept);
        if (folderName) await folder.updateSettings({ assetsFolder: folderName });
      }
      extras.forget();
    }
    await commitNow(path, "restore", `on ${computerName()}`);
    await openFile(path);
    view.refresh();
    void updateStatus();
  }

  async function openFile(path: string): Promise<void> {
    if (path.toLowerCase().endsWith(".highland")) {
      await openHighland(vscode.Uri.file(path));
      return;
    }
    let doc = await vscode.workspace.openTextDocument(path);
    if (/\.(md|markdown)$/i.test(path) && doc.languageId === "markdown") doc = await vscode.languages.setTextDocumentLanguage(doc, LANGUAGES.markdown);
    await showDocument(doc);
  }

  /**
   * After a pull: show what came in, bring in open plain files' Bin and Scratchpad, drop works
   * deleted elsewhere, and offer to join histories that began as copies.
   */
  async function pulled(work: Promise<string[]>): Promise<void> {
    const updated = await work.catch(() => [] as string[]);
    if (updated.length) {
      extras.forget();
      for (const d of vscode.workspace.textDocuments) if (extras.isPlain(d)) await extras.bringIn(d.uri.fsPath).catch(() => false);
      if (updated.includes("main")) await afterPull(worksHost, askedJoins).catch(() => undefined);
      // Open files that are now older saves of their works: offer the latest.
      const open = new Set<string>();
      for (const d of vscode.workspace.textDocuments) {
        const role = roleOf(d);
        if (role.kind === "script" && scriptIsOpen(role.key)) open.add(role.key);
      }
      for (const key of open) await connector.offerLatest(key).catch(() => undefined);
      view.refresh();
      works.refresh();
      void updateStatus();
    }
  }

  return { openWork, connectToWork, restoreWork, openFile, pulled };
}

/** A save's form, judged by its files, for saves made before the Highwater-Form line. */
function savedForm(files: DocumentFiles): Form {
  const info = files.others?.find((o) => o.path === "info.json");
  if (info) {
    try {
      if ("type" in (JSON.parse(new TextDecoder().decode(info.data)) as object)) return "highland";
    } catch {
      // not a .highland file's info.json
    }
  }
  return formOf(files.scriptName);
}
