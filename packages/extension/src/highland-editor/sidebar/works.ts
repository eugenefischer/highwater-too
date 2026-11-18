import type { MenuItem, MirrorStatus, WorkRow, WorkSaveRow } from "../messages.ts";
import { $, button, openHelp, openMenu, shortWhen, type SidebarDeps } from "./ui.ts";
import { MORE_ICON, OPEN_ICON, RESTORE_ICON } from "./icons.ts";
import { WORKS_HELP } from "./help.ts";

// ---------------------------------------------------------------------------------------------
// Works: every work in the writing history, under where it is (its file on this computer, only its
// history, or only on the mirror). A click selects a work: it shows Open (or Restore) and More, and
// its saves beneath, only to read (a save is looked into from the document's Writing History). The Filter narrows the list; the sync button (with a
// mirror) brings in works saved on other computers.

const WORK_SECTIONS: [WorkRow["kind"], string][] = [
  ["here", "LOCAL WORKS"],
  ["local", "LOCAL HISTORY ONLY"],
  ["remote", "MIRROR ONLY"],
];
export class WorksPanel {
  readonly #list = $("worklist");
  readonly #filter = $<HTMLInputElement>("workfilter");
  readonly #sync = $<HTMLButtonElement>("workrefresh");
  #rows: WorkRow[] = [];
  #selected: number | null = null;
  #saves: WorkSaveRow[] | null = null;
  /** The open Rename window, while it waits for the extension to say how renaming went. */
  #rename: RenameWindow | null = null;
  /** "Reveal in Finder", or what the system calls it. */
  #reveal = "Reveal in Finder";

  constructor(private readonly deps: SidebarDeps) {
    this.#filter.addEventListener("input", () => this.#render());
    this.#sync.onclick = () => deps.post({ type: "worksRefresh" });
    const status = $("workstatus");
    status.onclick = () => {
      if (status.classList.contains("attention")) deps.post({ type: "historyCommand", command: "highwater.signInHistoryMirror" });
    };
    const help = $("workhelp");
    help.onclick = () => openHelp(help, WORKS_HELP);
    // A click anywhere in the list's area but on a work (between works, or below them) lets go.
    $("workscroll").addEventListener("mousedown", (e) => {
      if (!(e.target as HTMLElement).closest(".work-card")) this.deselect();
    });
    this.#list.addEventListener("keydown", (e) => {
      const shown = this.#shown();
      const at = shown.findIndex((w) => w.i === this.#selected);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = shown[Math.max(0, Math.min(shown.length - 1, at < 0 ? 0 : at + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) this.#select(next.i, true);
      } else if (e.key === "Escape" && this.#selected !== null) {
        e.preventDefault();
        this.deselect();
      }
    });
  }

  show(rows: WorkRow[], mirror: MirrorStatus | null, computer: string, reveal = "Reveal in Finder"): void {
    this.#reveal = reveal;
    // This computer's name: what saves made here are called on other computers ("on …").
    const name = $("workcomputer");
    name.textContent = computer;
    name.dataset.tip = "This computer";
    // Works are matched by title and kind across refreshes (their order may change).
    const was = this.#rows.find((w) => w.i === this.#selected);
    this.#rows = rows;
    const again = was ? rows.find((w) => w.title === was.title && w.kind === was.kind) : undefined;
    this.#selected = again?.i ?? null;
    this.#saves = null;
    if (again && again.kind !== "remote") this.deps.post({ type: "workSaves", i: again.i });
    const note = $("worknote");
    note.classList.remove("sb-loading");
    note.textContent = "No works yet: each document's writing history starts with its first save.";
    note.hidden = rows.length > 0;
    this.#sync.hidden = !mirror;
    this.#sync.classList.toggle("busy", !!mirror?.busy);
    // When the mirror was last synced, always in view (as in the Writing History's foot).
    const status = $("workstatus");
    status.hidden = !mirror;
    status.classList.toggle("busy", !!mirror?.busy);
    status.textContent = !mirror
      ? ""
      : mirror.busy
        ? "Syncing with the mirror…"
        : mirror.signIn
          ? "Mirror needs you to sign in"
          : mirror.error
            ? "Not mirrored yet"
            : mirror.at
              ? `Synced with the mirror ${shortWhen(new Date(mirror.at))}`
              : "Not synced with the mirror yet";
    // As in the Writing History: a needed sign-in is done from here, with a click.
    status.classList.toggle("attention", !!mirror?.signIn && !mirror.busy);
    if (mirror?.error && !mirror.signIn) status.dataset.tip = mirror.error;
    else if (mirror?.signIn) status.dataset.tip = "Click to sign in to the history mirror";
    else delete status.dataset.tip;
    this.#render();
  }

  saves(i: number, saves: WorkSaveRow[]): void {
    if (i !== this.#selected) return;
    this.#saves = saves;
    this.#render();
  }

  /** No work selected (on leaving the panel, Escape, or a click beside the works). */
  deselect(): void {
    if (this.#selected === null) return;
    this.#selected = null;
    this.#saves = null;
    this.#render();
  }

  #select(i: number, scroll: boolean): void {
    if (i === this.#selected) return;
    this.#selected = i;
    this.#saves = null;
    if (this.#rows.find((w) => w.i === i)?.kind !== "remote") this.deps.post({ type: "workSaves", i });
    this.#render();
    if (scroll) this.#list.querySelector<HTMLElement>(".work-card.selected")?.scrollIntoView({ block: "nearest" });
  }

  /** The works the Filter lets through, in the order shown (by section). */
  #shown(): WorkRow[] {
    const words = this.#filter.value.trim().toLowerCase();
    const match = (w: WorkRow) => !words || `${w.title} ${w.file}`.toLowerCase().includes(words);
    return WORK_SECTIONS.flatMap(([kind]) => this.#rows.filter((w) => w.kind === kind && match(w)));
  }

  #render(): void {
    const shown = this.#shown();
    const out: HTMLElement[] = [];
    for (const [kind, heading] of WORK_SECTIONS) {
      const works = shown.filter((w) => w.kind === kind);
      if (!works.length) continue;
      const h = document.createElement("div");
      h.className = "sb-day";
      h.textContent = heading;
      out.push(h);
      for (const w of works) out.push(this.#card(w));
    }
    this.#list.replaceChildren(...out);
  }

  #card(w: WorkRow): HTMLElement {
    const selected = w.i === this.#selected;
    const card = document.createElement("div");
    card.className = `sb-row work-card work-${w.kind}${selected ? " selected" : ""}`;
    card.setAttribute("role", "option");
    card.setAttribute("aria-selected", String(selected));
    const main = document.createElement("div");
    main.className = "sb-row-main";
    const title = document.createElement("span");
    title.className = "sb-row-title";
    title.textContent = w.title;
    main.append(title);
    card.append(main);
    // The file's name, then when it was last saved and how long it is.
    for (const line of [w.file, [w.at ? `Saved ${shortWhen(new Date(w.at))}` : "", w.words ? `${w.words} words` : ""].filter(Boolean).join(" · ")]) {
      if (!line) continue;
      const detail = document.createElement("div");
      detail.className = "sb-row-detail";
      detail.textContent = line;
      card.append(detail);
    }
    const tools = document.createElement("div");
    tools.className = "sb-row-tools";
    const action = (name: string) => this.deps.post({ type: "workAction", i: w.i, action: name });
    tools.append(
      w.kind === "here" ? button("Open", OPEN_ICON, () => action("open")) : button("Restore…", RESTORE_ICON, () => action("restore")),
    );
    // Only a work whose history is on this computer can be renamed (EJ): a rename is one of its saves.
    const menu: MenuItem[] = [
      // A local work's file, shown in a Finder window.
      ...(w.kind === "here" ? [{ label: this.#reveal, command: "reveal" }] : []),
      ...(w.kind !== "remote" ? [{ label: "Rename…", command: "rename" }, { label: "Remove from This Computer…", command: "remove" }] : []),
      { label: "Delete Writing History…", command: "delete", danger: true },
    ];
    const more = button("More", MORE_ICON, () => openMenu(more, menu, (name) => (name === "rename" ? this.#openRename(w) : action(name))));
    tools.append(more);
    card.append(tools);
    if (selected) card.append(this.#savesOf(w));
    card.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button, .work-saves")) return;
      this.#select(w.i, false);
    });
    return card;
  }

  /** Rename…: a window with the title, and the file's name when the writer ticks the box. */
  #openRename(w: WorkRow): void {
    this.#rename?.close();
    this.#rename = new RenameWindow(w, (title, file) => this.deps.post({ type: "workRename", i: w.i, title, ...(file !== undefined ? { file } : {}) }), () => (this.#rename = null));
  }

  /** The extension renamed the work (the window closes), or says why it couldn't (the window stays). */
  renamed(i: number, error?: string): void {
    if (!this.#rename || this.#rename.work.i !== i) return;
    if (error) this.#rename.failed(error);
    else this.#rename.close();
  }

  /** A selected work's saves, newest first: a record to read, not clickable. */
  #savesOf(w: WorkRow): HTMLElement {
    const box = document.createElement("div");
    box.className = "work-saves";
    const note = (text: string) => {
      const n = document.createElement("div");
      n.className = "sb-row-detail";
      n.textContent = text;
      box.append(n);
    };
    if (w.kind === "remote") note("Its saves are on the mirror. Restore it to see them.");
    else if (!this.#saves) note("Loading saves…");
    else if (!this.#saves.length) note("No saves.");
    for (const save of this.#saves ?? []) {
      const date = new Date(save.at);
      const row = document.createElement("div");
      row.className = "work-save";
      row.dataset.tip = `${save.kind}, ${date.toLocaleString([], { dateStyle: "full", timeStyle: "short" })}${save.note ? `\n${save.note}` : ""}${save.words ? `\n${save.words} words` : ""}`;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = shortWhen(date);
      const kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = save.kind;
      const delta = document.createElement("span");
      delta.className = "hist-delta";
      delta.textContent = save.delta;
      row.append(when, kind, delta);
      box.append(row);
    }
    return box;
  }
}

/**
 * The Rename window (EJ, 0.6.65): the work's title, and "Also change file name?", which makes the
 * file's name editable. Rename does both; Cancel or Escape does nothing.
 */
class RenameWindow {
  readonly #root = document.createElement("div");
  readonly #title: HTMLInputElement;
  readonly #change: HTMLInputElement | null;
  readonly #file: HTMLInputElement | null;
  readonly #error: HTMLElement;
  readonly #ok: HTMLButtonElement;
  readonly #ext: string;

  constructor(
    readonly work: WorkRow,
    private readonly submit: (title: string, file: string | undefined) => void,
    private readonly closed: () => void,
  ) {
    // Only a work whose file is here has a file name to change.
    const hasFile = work.kind === "here" && !!work.file;
    this.#ext = /\.[^.]+$/.exec(work.file)?.[0] ?? "";
    this.#root.id = "renamewin";
    this.#root.setAttribute("role", "dialog");
    this.#root.setAttribute("aria-label", "Rename Work");
    this.#root.innerHTML = `<div class="tw-sheet rn-sheet">
  <div class="tw-head"><h1>Rename Work</h1></div>
  <div class="rn-body">
    <label class="rn-row"><span>Title:</span><input type="text" class="rn-title" spellcheck="false"></label>
    ${hasFile ? `<label class="rn-check"><input type="checkbox" class="rn-change"> Also change file name?</label>
    <label class="rn-row"><span>File name:</span><input type="text" class="rn-file" spellcheck="false" disabled></label>` : ""}
    <div class="rn-error" role="alert" hidden></div>
  </div>
  <div class="rn-foot"><button class="rn-cancel">Cancel</button><button class="rn-ok">Rename</button></div>
</div>`;
    const q = <T extends HTMLElement>(sel: string) => this.#root.querySelector<T>(sel);
    this.#title = q<HTMLInputElement>(".rn-title")!;
    this.#change = q<HTMLInputElement>(".rn-change");
    this.#file = q<HTMLInputElement>(".rn-file");
    this.#error = q<HTMLElement>(".rn-error")!;
    this.#ok = q<HTMLButtonElement>(".rn-ok")!;
    this.#title.value = work.title;
    if (this.#file) this.#file.value = work.file;
    this.#change?.addEventListener("change", () => {
      this.#file!.disabled = !this.#change!.checked;
      if (this.#change!.checked) {
        this.#file!.focus();
        this.#file!.setSelectionRange(0, Math.max(0, this.#file!.value.length - this.#ext.length));
      }
      this.#check();
    });
    for (const input of [this.#title, this.#file]) input?.addEventListener("input", () => this.#check());
    q<HTMLButtonElement>(".rn-cancel")!.onclick = () => this.close();
    this.#ok.onclick = () => this.#go();
    this.#root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        this.#go();
      }
    });
    // A click outside the sheet does nothing (as with the Settings window): Cancel or Escape closes it.
    document.body.append(this.#root);
    this.#check();
    this.#title.focus();
    this.#title.select();
  }

  /** What would be done, or why not: the Rename button follows it. */
  #problem(): string | null {
    const title = this.#title.value.trim();
    if (!title) return "Type a title.";
    const file = this.#fileName();
    if (file !== undefined) {
      if (!file.slice(0, file.length - this.#ext.length).trim()) return "Type a file name.";
      if (/[/\\:]/.test(file)) return "A file name can’t contain / \\ or :.";
    }
    return null;
  }

  /** The new file name (with the work's extension), when the box is ticked and it differs. */
  #fileName(): string | undefined {
    if (!this.#change?.checked || !this.#file) return undefined;
    let name = this.#file.value.trim();
    if (this.#ext && !name.toLowerCase().endsWith(this.#ext.toLowerCase())) name += this.#ext;
    return name === this.work.file ? undefined : name;
  }

  #check(): void {
    const problem = this.#problem();
    const unchanged = this.#title.value.trim() === this.work.title && this.#fileName() === undefined;
    this.#ok.disabled = problem !== null || unchanged;
    this.#error.hidden = true;
  }

  #go(): void {
    if (this.#ok.disabled) return;
    const problem = this.#problem();
    if (problem) return this.failed(problem);
    this.#ok.disabled = true;
    this.#ok.textContent = "Renaming…";
    this.submit(this.#title.value.trim(), this.#fileName());
  }

  failed(message: string): void {
    this.#ok.textContent = "Rename";
    this.#check();
    this.#error.textContent = message;
    this.#error.hidden = false;
  }

  close(): void {
    if (!this.#root.isConnected) return;
    this.#root.remove();
    this.closed();
  }
}
