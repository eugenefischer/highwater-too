import type { AssetCard } from "../messages.ts";
import { $, MAC, button, faintDragImage, type SidebarDeps } from "./ui.ts";
import { ASSET_TYPE } from "./bin.ts";

// ---------------------------------------------------------------------------------------------
// Assets: the document's images. Drag one into the page to put in its reference; add images
// with the + button, or by dropping files from Finder (VS Code asks for Shift while dragging in).

export class AssetsPanel {
  readonly #list = $("assetlist");
  readonly #empty = $("assetempty");
  #available = false;

  constructor(private readonly deps: SidebarDeps) {
    $("assetadd").onclick = () => deps.post({ type: "assetsAdd" });
    const panel = $("assetpanel");
    panel.addEventListener("dragover", (e) => {
      if (!this.#available || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      panel.classList.add("dropping");
    });
    panel.addEventListener("dragleave", (e) => {
      if (!panel.contains(e.relatedTarget as Node | null)) panel.classList.remove("dropping");
    });
    panel.addEventListener("drop", (e) => {
      e.preventDefault();
      panel.classList.remove("dropping");
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.(png|jpe?g|gif|tiff?|heic|webp|pdf)$/i.test(f.name));
      if (!files.length) return;
      void Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))).then((list) => deps.post({ type: "assetsImport", files: list }));
    });
  }

  show(cards: AssetCard[], available: boolean): void {
    this.#available = available;
    this.#list.replaceChildren(...cards.map((c) => this.#card(c)));
    this.#empty.hidden = cards.length > 0;
    this.#empty.textContent = available ? `The Assets list shows images imported into your document. Add them with +, or hold Shift and drag them in from ${MAC ? "Finder" : "your files"}; drag one into the text to use it.` : "Open a document to see its assets.";
    $("assetadd").hidden = !available;
  }

  #card(c: AssetCard): HTMLElement {
    const el = document.createElement("div");
    el.className = "assetcard";
    el.draggable = true;
    el.dataset.tip = `${c.name}\nDrag into the text to use it; double-click to open it.`;
    const pic = document.createElement("div");
    pic.className = "assetcard-pic";
    if (c.thumb) {
      const img = document.createElement("img");
      img.src = c.thumb;
      img.alt = "";
      img.draggable = false;
      pic.append(img);
    }
    const text = document.createElement("div");
    text.className = "assetcard-text";
    const label = document.createElement("div");
    label.className = "bincard-label";
    label.textContent = c.label;
    const detail = document.createElement("div");
    detail.className = "bincard-detail";
    detail.textContent = c.detail;
    text.append(label, detail);
    const tools = document.createElement("div");
    tools.className = "bincard-tools";
    tools.append(button("Delete", '<path d="M6 6l12 12M18 6 6 18"/>', () => this.deps.post({ type: "assetDelete", name: c.name })));
    el.append(pic, text, tools);
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer!.setData("text/plain", c.reference);
      e.dataTransfer!.setData(ASSET_TYPE, c.name);
      e.dataTransfer!.effectAllowed = "copy";
      faintDragImage(e, c.label);
    });
    el.addEventListener("dblclick", () => this.deps.post({ type: "assetOpen", name: c.name }));
    return el;
  }
}
