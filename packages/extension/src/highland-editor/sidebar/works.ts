import type { MenuItem, MirrorStatus, WorkRow, WorkSaveRow } from "../messages.ts";
import { $, button, openHelp, openMenu, shortWhen, type SidebarDeps } from "./ui.ts";
import { MORE_ICON, OPEN_ICON, RESTORE_ICON } from "./icons.ts";
import { WORKS_HELP } from "./help.ts";

// ---------------------------------------------------------------------------------------------
// Works: every work in the writing history, under where it is (its file on this computer, only its
// history, or only on the mirror). A click selects a work: it shows Open (or Restore) and More, and
// its saves beneath (a click on one shows it). The Filter narrows the list; the sync button (with a
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

  show(rows: WorkRow[], mirror: MirrorStatus | null, computer: string): void {
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
    const menu: MenuItem[] = [
      ...(w.kind !== "remote" ? [{ label: "Remove from This Computer…", command: "remove" }] : []),
      { label: "Delete Writing History…", command: "delete", danger: true },
    ];
    const more = button("More", MORE_ICON, () => openMenu(more, menu, action));
    tools.append(more);
    card.append(tools);
    if (selected) card.append(this.#savesOf(w));
    card.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button, .work-saves")) return;
      this.#select(w.i, false);
    });
    return card;
  }

  /** A selected work's saves: newest first; a click shows one (beside the file, when it is here). */
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
      row.dataset.tip = `${save.kind}, ${date.toLocaleString([], { dateStyle: "full", timeStyle: "short" })}${save.note ? `\n${save.note}` : ""}${save.words ? `\n${save.words} words` : ""}\nClick to see this save${w.kind === "here" ? " beside the file as it is now" : ""}.`;
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
      row.addEventListener("click", () => this.deps.post({ type: "workSave", i: w.i, j: save.j }));
      box.append(row);
    }
    return box;
  }
}
