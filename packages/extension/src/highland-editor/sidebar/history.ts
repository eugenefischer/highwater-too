import type { HistoryMessage, HistorySave, MenuItem } from "../messages.ts";
import { $, button, dayHeading, openHelp, openMenu, shortWhen, type SidebarDeps } from "./ui.ts";
import { COMPARE_ICON, REVERT_ICON } from "./icons.ts";
import { HISTORY_HELP } from "./help.ts";

// ---------------------------------------------------------------------------------------------
// Writing History (Highwater's, not Highland's): this document's saves, newest first, under a
// heading for each day. A click selects a save, which shows Compare and Revert where its word change
// was; Escape, a click beside the saves or leaving the panel lets go of it. The foot shows whether the history is recording and how the
// mirror is doing, with the record (off or on for this document), export and gear (the rest) buttons.

export class HistoryPanel {
  readonly #list = $("histlist");
  readonly #note = $("histnote");
  readonly #record = $<HTMLButtonElement>("histrecord");
  #saves: HistorySave[] = [];
  #selected: string | null = null;
  #menu: MenuItem[] = [];

  constructor(private readonly deps: SidebarDeps) {
    const run = (command: string) => deps.post({ type: "historyCommand", command });
    this.#record.onclick = () => run("highwater.toggleDocumentHistory");
    $("histexport").onclick = () => run("highwater.exportHistory");
    const help = $("histhelp");
    help.onclick = () => openHelp(help, HISTORY_HELP);
    const gear = $("histgear");
    gear.onclick = () => openMenu(gear, this.#menu, run);
    $("histmirror").onclick = () => {
      if ($("histmirror").classList.contains("attention")) run("highwater.signInHistoryMirror");
    };
    this.#list.addEventListener("keydown", (e) => {
      const i = this.#saves.findIndex((x) => x.hash === this.#selected);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = this.#saves[Math.max(0, Math.min(this.#saves.length - 1, i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) this.#select(next.hash, true);
      } else if (e.key === "Escape" && this.#selected) {
        e.preventDefault();
        this.deselect();
      }
    });
    // A click in the list but not on a save lets go of the selection.
    $("histscroll").addEventListener("mousedown", (e) => {
      if (!(e.target as HTMLElement).closest(".hist-row")) this.deselect();
    });
  }

  show(msg: HistoryMessage): void {
    $("histtitle").textContent = msg.title;
    this.#note.classList.remove("sb-loading");
    this.#note.textContent = msg.note;
    this.#note.hidden = !msg.note;
    this.#saves = msg.saves;
    this.#menu = msg.menu;
    if (!this.#saves.some((x) => x.hash === this.#selected)) this.#selected = null;
    this.#foot(msg);
    const rows: HTMLElement[] = [];
    let day = "";
    for (const save of msg.saves) {
      const date = new Date(save.at);
      const heading = dayHeading(date);
      if (heading !== day) {
        day = heading;
        const h = document.createElement("div");
        h.className = "sb-day";
        h.textContent = heading;
        rows.push(h);
      }
      const row = document.createElement("div");
      row.className = "sb-row hist-row";
      row.dataset.hash = save.hash;
      row.setAttribute("role", "option");
      row.dataset.tip = `${save.kind}, ${date.toLocaleString([], { dateStyle: "full", timeStyle: "short" })}${save.words ? `\n${save.words} words` : ""}`;
      const main = document.createElement("div");
      main.className = "sb-row-main";
      const time = document.createElement("span");
      time.className = "sb-row-when";
      time.textContent = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const kind = document.createElement("span");
      kind.className = "sb-row-kind";
      kind.textContent = save.kind;
      const delta = document.createElement("span");
      delta.className = "hist-delta";
      delta.textContent = save.delta;
      main.append(time, kind, delta);
      row.append(main);
      if (save.note) {
        const note = document.createElement("div");
        note.className = "sb-row-detail";
        note.textContent = save.note;
        row.append(note);
      }
      const tools = document.createElement("div");
      tools.className = "sb-row-tools";
      tools.append(
        button("Compare with Now", COMPARE_ICON, () => this.#compare(save.hash)),
        button("Revert to This Save…", REVERT_ICON, () => this.deps.post({ type: "historyRevert", hash: save.hash })),
      );
      row.append(tools);
      row.addEventListener("mousedown", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        this.#select(save.hash, false);
      });
      rows.push(row);
    }
    this.#list.replaceChildren(...rows);
    this.#mark();
  }

  /** No save selected (on leaving the panel, Escape, or a click beside the saves). */
  deselect(): void {
    if (this.#selected === null) return;
    this.#selected = null;
    this.#mark();
  }

  #select(hash: string, scroll: boolean): void {
    this.#selected = hash;
    this.#mark();
    if (scroll) this.#list.querySelector<HTMLElement>(".hist-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  #mark(): void {
    for (const r of this.#list.querySelectorAll<HTMLElement>(".hist-row")) {
      const on = r.dataset.hash === this.#selected;
      r.classList.toggle("selected", on);
      r.setAttribute("aria-selected", String(on));
    }
  }

  #compare(hash: string): void {
    this.deps.post({ type: "historyCompare", hash });
  }

  /** The foot: whether this document's saves are being recorded, and the mirror's last outcome. */
  #foot(msg: HistoryMessage): void {
    const last = msg.saves[0] ? new Date(msg.saves[0].at) : null;
    $("histstate").textContent = !msg.document
      ? "Not saved yet"
      : msg.state === "off"
        ? "Writing history is off"
        : msg.state === "paused"
          ? "Paused for this document"
          : last
            ? `Recording · last save ${shortWhen(last)}`
            : "Starts with the next save";
    const rec = this.#record;
    rec.hidden = !msg.document || msg.state === "off";
    const paused = msg.state === "paused";
    rec.classList.toggle("paused", paused);
    const tip = paused ? "Turn Writing History On for This Document" : "Turn Writing History Off for This Document";
    rec.dataset.tip = tip;
    rec.setAttribute("aria-label", tip);
    const mirror = $("histmirror");
    mirror.hidden = !msg.mirror || msg.state === "off";
    mirror.classList.toggle("attention", !!msg.mirror?.signIn && !msg.mirror.busy);
    if (msg.mirror?.error) mirror.dataset.tip = msg.mirror.error;
    else delete mirror.dataset.tip;
    mirror.classList.toggle("busy", !!msg.mirror?.busy);
    mirror.textContent = !msg.mirror
      ? ""
      : msg.mirror.busy
        ? "Syncing with the mirror…"
        : msg.mirror.signIn
        ? "Mirror needs you to sign in"
        : msg.mirror.error
          ? "Not mirrored yet"
          : msg.mirror.at
            ? `Synced with the mirror ${shortWhen(new Date(msg.mirror.at))}`
            : "Not synced with the mirror yet";
  }
}
