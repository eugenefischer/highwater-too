import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { writeBundle } from "@highwater/bundle";
import { formOf, textHash, type CommitInfo, type History, type Recognition, type SaveKind } from "@highwater/history";
import * as vscode from "vscode";
import { ask, pick } from "./ask.ts";
import { plainExtras, toExtras } from "./extras.ts";
import { detectAssetsFolder, ExtrasFolder, noteId } from "./extras-folder.ts";
import type { HistoryMirror } from "./mirror.ts";
import type { BundleStore } from "./store.ts";
import { toBundle } from "./to-bundle.ts";

/** What the next save of a file is recorded as, when the writer chose how it continues a work. */
export interface NextSave {
  kind: SaveKind;
  note: string;
}

/** The question a file is waiting on, so it can be asked again. */
type Pending =
  | { stage: "connect" | "form" | "text"; r: Recognition }
  /** The file is an older save of its work, and newer ones came in (from another computer). */
  | { stage: "latest"; branch: string; title: string; save: CommitInfo; saveText: string; head: CommitInfo; headText: string };

export interface ConnectorHost {
  history(): History;
  historyRoot(): string;
  mirror: HistoryMirror;
  store: BundleStore;
  /** Records a save now (a Convert, when a file of another form becomes the work's file). */
  commit(key: string, kind: SaveKind, note: string): Promise<void>;
  /** Shows a save beside a file, to compare. */
  compare(key: string, commit: CommitInfo): Promise<void>;
  changed(): void;
}

/**
 * Recognising a file this computer has no history for (Writing history 2): by its ID, its text's
 * hash or its file name, from the catalog. Every match asks before anything is fetched, and a
 * file that is not the work's latest save asks how it continues; there is no default. Until the
 * writer chooses, the file's saves are not recorded.
 */
export class Connector {
  readonly #host: ConnectorHost;
  /** Files looked at this session (asked once each, unless still undecided). */
  readonly #looked = new Set<string>();
  /** Files waiting for the writer's choice: their saves are not recorded meanwhile. */
  readonly #pending = new Map<string, Pending>();
  /** How the next save of a file is recorded. */
  readonly #next = new Map<string, NextSave>();
  /** The latest save each file was last checked against (asked once per latest save). */
  readonly #offered = new Map<string, string>();
  /** A check in progress, per file. */
  readonly #running = new Map<string, Promise<void>>();

  constructor(host: ConnectorHost) {
    this.#host = host;
  }

  /** True while a file's saves wait for the writer's choice. */
  undecided(key: string): boolean {
    return this.#pending.has(key);
  }

  /** How this save is recorded, if the writer chose (used once). */
  takeNext(key: string): NextSave | undefined {
    const n = this.#next.get(key);
    this.#next.delete(key);
    return n;
  }

  /** How the next save of a file is to be recorded (Revert to This Save). */
  setNext(key: string, next: NextSave): void {
    this.#next.set(key, next);
  }

  /** Files to look up afresh (their work's history was removed or deleted here). */
  forget(keys: string[]): void {
    for (const k of keys) {
      this.#looked.delete(k);
      this.#pending.delete(k);
      this.#next.delete(k);
      this.#offered.delete(k);
    }
  }

  /** Looks a file up once per session, or asks again when it is still undecided. */
  check(key: string): Promise<void> {
    const running = this.#running.get(key);
    if (running) return running;
    const run = this.#check(key).finally(() => {
      this.#running.delete(key);
      this.#host.changed();
    });
    this.#running.set(key, run);
    return run;
  }

  async #check(key: string): Promise<void> {
    const pending = this.#pending.get(key);
    if (pending) return this.#ask(key, pending);
    if (this.#looked.has(key)) return;
    this.#looked.add(key);
    const h = this.#host.history();
    const doc = await this.#identify(key);
    if (!doc || (await h.find({ id: doc.id, path: key, text: doc.text }))) return;
    const minWords = vscode.workspace.getConfiguration("highwater").get<number>("historyMatchMinWords", 50);
    const found = await h.recognise({ id: doc.id, path: key, text: doc.text, savedText: doc.savedText }, minWords);
    if (!found.length) return;
    let r = found[0]!;
    if (found.length > 1) {
      const picked = await pick(
        [
          ...found.map((f) => ({ label: f.entry.title, description: f.entry.file ?? "", detail: f.entry.lastSave ? `Last saved ${new Date(f.entry.lastSave).toLocaleString()}` : "", f })),
          { label: "None of these", description: "keep this file separate", f: null },
        ],
        { title: `${basename(key)} matches more than one work in your writing history`, placeHolder: "Which work is it?", ignoreFocusOut: true },
      );
      if (!picked) return this.#wait(key, { r, stage: "connect" });
      if (!picked.f) return this.#separate(key);
      r = picked.f;
    }
    // Already here and found by ID or text: connecting fetches nothing, so it is not asked.
    const stage = r.local && r.by !== "name" ? "form" : "connect";
    return this.#ask(key, { r, stage });
  }

  /**
   * Asks how a tracked file continues when it is an older save of its work, because newer saves
   * came in from another computer: update it to the latest, or keep this version (the next save
   * is a revert). No default: until the writer chooses, its saves are not recorded. Asked once per
   * latest save.
   */
  offerLatest(key: string): Promise<void> {
    const running = this.#running.get(key);
    if (running) return running.then(() => this.offerLatest(key));
    const run = this.#offerLatest(key).finally(() => {
      this.#running.delete(key);
      this.#host.changed();
    });
    this.#running.set(key, run);
    return run;
  }

  async #offerLatest(key: string): Promise<void> {
    // Undecided, or the writer already chose how the next save goes.
    if (this.#pending.has(key) || this.#next.has(key)) return;
    const h = this.#host.history();
    const doc = await this.#identify(key);
    if (!doc) return;
    const found = await h.find({ id: doc.id, path: key, text: doc.text });
    if (!found || found.paused) return;
    const head = (await h.branchLog(found.branch, 1))[0];
    if (!head || this.#offered.get(key) === head.hash) return;
    this.#offered.set(key, head.hash);
    const headText = textHash(await h.scriptAt(head.hash));
    const hash = textHash(doc.text);
    if (hash === headText || doc.savedText === headText) return;
    // Only a file that is one of the work's saves: other differences are this computer's own edits.
    let saveText = hash;
    let save = await h.saveWithText(found.branch, hash);
    if (!save && doc.savedText) [save, saveText] = [await h.saveWithText(found.branch, doc.savedText), doc.savedText];
    if (!save || save.hash === head.hash || save.date >= head.date) return;
    const title = (await h.catalog()).find((e) => e.branch === found.branch)?.title ?? basename(key);
    return this.#ask(key, { stage: "latest", branch: found.branch, title, save, saveText, head, headText });
  }

  async #ask(key: string, p: Pending): Promise<void> {
    const name = basename(key);
    if (p.stage === "latest") return this.#askLatest(key, p);
    const title = p.r.entry.title;
    if (p.stage === "connect") {
      const where = p.r.local ? "" : " Its history is on the mirror, not on this computer.";
      const why =
        p.r.by === "id"
          ? `${name} belongs to “${title}” in your writing history.`
          : p.r.by === "hash"
            ? `${name} has exactly the text of a save of “${title}” in your writing history.`
            : `${name} has the same name as “${title}” in your writing history, and may be a copy of it.`;
      const go = p.r.local ? "Connect It" : "Fetch Its History";
      const choice = await ask(
        "warning",
        why,
        { modal: true, detail: `${where} ${p.r.local ? "Connect" : "Fetch that history to this computer and connect"} this file to it, so its saves continue the same history? Or keep it as a separate copy, with a history of its own.`.trim() },
        go,
        "Keep as a Separate Copy",
      );
      if (!choice) return this.#wait(key, p);
      if (choice !== go) return this.#separate(key);
      if (!p.r.local && !(await this.#host.mirror.fetchWork(p.r.entry.branch))) return this.#wait(key, p);
      return this.#ask(key, { r: { ...p.r, local: true }, stage: "form" });
    }
    const h = this.#host.history();
    const entry = p.r.entry;
    const head = (await h.branchLog(entry.branch, 1))[0];
    if (!head) return this.#done(key);
    if (p.stage === "form") {
      await h.claim({ id: entry.id, branch: entry.branch }, key);
      const form = head.form ?? entry.form;
      if (form && form !== formOf(key)) {
        const kept = form === "highland" ? "a .highland file" : `a plain .${form} file`;
        const choice = await ask(
          "warning",
          `“${title}” is kept as ${kept}, and ${name} is a different kind of file.`,
          {
            modal: true,
            detail: `Make this file the work's file: the history continues with ${name} from now on, recorded as a conversion, and the work's other file is no longer tracked. Or keep this file as a separate copy, with a history of its own.`,
          },
          "Make This File the Work's File",
          "Keep as a Separate Copy",
        );
        if (!choice) return this.#wait(key, p);
        if (choice !== "Make This File the Work's File") return this.#separate(key);
        this.#done(key);
        await this.#host.commit(key, "convert", `to ${name}`);
        return;
      }
      return this.#ask(key, { ...p, stage: "text" });
    }
    // stage "text": how this file's text relates to the work's saves.
    if (p.r.match === "latest") return this.#done(key);
    const save = p.r.text ? await h.saveWithText(entry.branch, p.r.text) : null;
    const when = save ? save.date.toLocaleString() : "an earlier date";
    const latest = head.date.toLocaleString();
    if (p.r.match === "older") {
      const choice = await ask(
        "warning",
        `${name} is an older version of “${title}”: the save of ${when}. The latest save is from ${latest}.`,
        {
          modal: true,
          detail:
            "Update to the latest: this file is replaced with the latest save (nothing is lost: this version is itself a save in the history).\n\nKeep this version: your next save goes back to it, recorded as a revert.\n\nKeep as a separate copy: this file gets a history of its own.",
        },
        "Update to the Latest",
        "Keep This Version",
        "Keep as a Separate Copy",
      );
      if (!choice) return this.#wait(key, p);
      if (choice === "Keep as a Separate Copy") return this.#separate(key);
      if (choice === "Keep This Version") {
        this.#next.set(key, { kind: "revert", note: `to the save of ${when}` });
        return this.#done(key);
      }
      if (!(await this.#update(key, head))) return this.#wait(key, p);
      return this.#done(key);
    }
    if (p.r.match === "edited") {
      const choice = await ask(
        "warning",
        `${name} was edited since the save of ${when} of “${title}”, and the work has been saved since, most recently on ${latest}.`,
        {
          modal: true,
          detail:
            "Open the latest beside it: compare the latest save with this file, then choose.\n\nKeep this version: your next save continues from this file, recorded as going back to the save of " +
            `${when} with edits.\n\nKeep as a separate copy: this file gets a history of its own.`,
        },
        "Open the Latest Beside It",
        "Keep This Version",
        "Keep as a Separate Copy",
      );
      if (!choice) return this.#wait(key, p);
      if (choice === "Keep as a Separate Copy") return this.#separate(key);
      if (choice === "Keep This Version") {
        this.#next.set(key, { kind: "revert", note: `to the save of ${when}, edited since` });
        return this.#done(key);
      }
      await this.#host.compare(key, head);
      return this.#wait(key, p);
    }
    const choice = await ask(
      "warning",
      `${name}'s text matches no save of “${title}”.`,
      {
        modal: true,
        detail: `It may have been edited somewhere without the writing history. The work was last saved on ${latest}.\n\nJoin, continuing from this text: your next save continues the work with this file's text.\n\nKeep as a separate copy: this file gets a history of its own.`,
      },
      "Join, Continuing from This Text",
      "Keep as a Separate Copy",
    );
    if (!choice) return this.#wait(key, p);
    if (choice !== "Join, Continuing from This Text") return this.#separate(key);
    this.#next.set(key, { kind: "save", note: "continuing with text edited elsewhere" });
    return this.#done(key);
  }

  async #askLatest(key: string, p: Extract<Pending, { stage: "latest" }>): Promise<void> {
    const name = basename(key);
    const day = { dateStyle: "medium", timeStyle: "short" } as const;
    const when = p.save.date.toLocaleString(undefined, day);
    const latest = p.head.date.toLocaleString(undefined, day);
    // Asked again (after comparing, say): the file may have changed since.
    const now = await this.#identify(key);
    const hash = now ? textHash(now.text) : p.saveText;
    if (hash === p.headText) return this.#done(key);
    const edited = hash !== p.saveText;
    const dirty = this.#openDocument(key)?.isDirty ?? false;
    // Replacing is offered only while the file is exactly the older save.
    const compare = dirty || edited;
    const go = compare ? "Open the Latest Beside It" : "Update to the Latest";
    const choice = await ask(
      "warning",
      `“${p.title}” has newer saves from another computer.`,
      {
        modal: true,
        detail:
          (edited ? `${name} began as the version saved on ${when}, and has been edited since.` : `${name} is the version saved on ${when}.`) +
          ` The newest version was saved on ${latest}.\n\n` +
          (compare
            ? "Open the Latest Beside It: show the newest version next to this file, to compare before choosing. This file has changes the newest version doesn't, so it isn't replaced.\n\n"
            : "Update to the Latest: replace this file (with its Bin and Scratchpad) with the newest version.\n\n") +
          "Keep This Version: carry on with the currently open file, edits included. When you next save, it becomes the newest version.\n\nUntil you choose, your saves aren't recorded.",
      },
      go,
      "Keep This Version",
    );
    if (!choice) return this.#wait(key, p);
    if (choice === "Keep This Version") {
      this.#next.set(key, { kind: "revert", note: edited ? `to the save of ${when}, edited since` : `to the save of ${when}` });
      return this.#done(key);
    }
    if (compare) {
      await this.#host.compare(key, p.head);
      return this.#wait(key, p);
    }
    // A save may have come in meanwhile: update to the newest there is.
    const head = (await this.#host.history().branchLog(p.branch, 1))[0] ?? p.head;
    if (!(await this.#update(key, head))) return this.#wait(key, p);
    this.#offered.set(key, head.hash);
    return this.#done(key);
  }

  #openDocument(key: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((d) => (d.uri.scheme === "file" || d.uri.scheme === "highland") && d.uri.fsPath === key);
  }

  /** Replaces the file with the work's latest save (refused while it has unsaved edits). */
  async #update(key: string, head: CommitInfo): Promise<boolean> {
    if (this.#openDocument(key)?.isDirty) {
      void vscode.window.showWarningMessage(`${basename(key)} has unsaved changes. Save or revert them, then choose again from the writing history item in the status bar.`);
      return false;
    }
    const h = this.#host.history();
    const files = await h.filesAt(head.hash);
    const id = (await h.find({ id: null, path: key, text: "" }))?.id;
    if (!id) return false;
    if (key.toLowerCase().endsWith(".highland")) {
      await writeBundle(key, toBundle(files, id));
      await this.#host.store.checkDisk(key);
      return true;
    }
    await writeFile(key, files.script);
    const images = (files.others ?? []).filter((o) => /^assets\/[^/]+$/.test(o.path));
    const kept = toExtras(files);
    const folderName = images.length ? (detectAssetsFolder(files.script, images.map((o) => o.path.slice("assets/".length))) ?? null) : null;
    if (folderName) {
      const dir = join(dirname(key), folderName);
      await mkdir(dir, { recursive: true });
      for (const a of images) await writeFile(join(dir, a.path.slice("assets/".length)), a.data);
    }
    const folder = new ExtrasFolder(join(this.#host.historyRoot(), "extras", id));
    await folder.replace(kept);
    if (folderName) await folder.updateSettings({ assetsFolder: folderName });
    await folder.setBase(head.hash);
    plainExtras().forget();
    plainExtras().changed(key);
    return true;
  }

  async #identify(key: string): Promise<{ id: string | null; text: string; savedText: string | null } | null> {
    try {
      if (key.toLowerCase().endsWith(".highland")) {
        const b = await this.#host.store.snapshot(key);
        const ours = b.info.highwaterToo as { documentId?: unknown; savedText?: unknown } | undefined;
        return { id: typeof ours?.documentId === "string" ? ours.documentId : null, text: b.text, savedText: typeof ours?.savedText === "string" ? ours.savedText : null };
      }
      const text = await readFile(key, "utf8");
      return { id: noteId(text), text, savedText: null };
    } catch {
      return null;
    }
  }

  #wait(key: string, p: Pending): void {
    this.#pending.set(key, p);
  }

  #done(key: string): void {
    this.#pending.delete(key);
  }

  /** Keeps the file out of the work: it starts a history of its own when saved. */
  async #separate(key: string): Promise<void> {
    this.#pending.delete(key);
    await this.#host.history().retire(key);
  }
}
