import { $, type SidebarDeps } from "./ui.ts";

// ---------------------------------------------------------------------------------------------
// The Scratchpad: Highland's plain-text notes beside the text, saved as you type (in the
// .highland file, or with a plain file's writing history). The button at the bottom right
// exports what it holds to a new document.

export class ScratchpadPanel {
  readonly #area = $<HTMLTextAreaElement>("scratch");
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The text last saved (or loaded), to tell the writer's edits from ones made elsewhere. */
  #saved = "";
  #loaded = false;

  constructor(private readonly deps: SidebarDeps) {
    this.#area.addEventListener("input", () => {
      this.#showEmpty();
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#flush(), 600);
    });
    this.#area.addEventListener("blur", () => this.#flush());
    // Text dragged in from the page is copied, not moved out of it.
    this.#area.addEventListener("dragover", (e) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    // Put in by hand, so the page keeps its text: at the cursor if the Scratchpad has one, else at the end.
    this.#area.addEventListener("drop", (e) => {
      const text = e.dataTransfer?.getData("text/plain");
      e.preventDefault();
      if (!text) return;
      const area = this.#area;
      const focused = document.activeElement === area;
      const at = focused ? area.selectionStart : area.value.length;
      const end = focused ? area.selectionEnd : at;
      const lead = !focused && area.value && !area.value.endsWith("\n") ? "\n" : "";
      area.setRangeText(lead + text, at, end, "end");
      area.focus();
      area.dispatchEvent(new Event("input"));
    });
    window.addEventListener("blur", () => this.#flush());
    $("scratchexport").onclick = () => {
      this.#flush();
      deps.post({ type: "scratchpadExport", text: this.#area.value });
    };
    // Highwater's formatting keys (⌘B, ⌘I, ⌘U…) would act on the text, not here: keep them from VS Code.
    this.#area.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && /^[biuy/.=\-]$/i.test(e.key)) e.stopPropagation();
    });
  }

  /** The Scratchpad's text from the extension; kept if the writer has changed it since it was last saved. */
  load(text: string, force: boolean): void {
    const edited = this.#area.value !== this.#saved;
    this.#saved = text;
    if (!this.#loaded || force || !edited) this.#area.value = text;
    this.#loaded = true;
    this.#showEmpty();
  }

  /** Highland's empty Scratchpad: "Click here to edit" at the top, a line about it in the middle. */
  #showEmpty(): void {
    $("scratchempty").hidden = this.#area.value !== "";
  }

  saved(text: string): void {
    this.#saved = text;
  }

  focus(): void {
    this.#area.focus();
  }

  #flush(): void {
    clearTimeout(this.#timer);
    if (!this.#loaded || this.#area.value === this.#saved) return;
    // Taken as saved now (the extension sends the text back if it couldn't be).
    this.#saved = this.#area.value;
    this.deps.post({ type: "scratchpadSave", text: this.#saved });
  }
}
