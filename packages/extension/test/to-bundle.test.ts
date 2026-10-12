import { createDocument } from "@highwater/bundle";
import { parse } from "@highwater/parser";
import { describe, expect, it } from "vitest";
import { navigatorItems } from "../src/syntax/navigator.ts";
import { toBundle } from "../src/to-bundle.ts";

const id = "1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d";

describe("a .highland file from a save", () => {
  it("packs a plain file's text, Bin, Scratchpad, images and template, with its ID", () => {
    const script = `A manuscript ![map](My%20Book%20assets/map.png).\n\n[[highwater: ${id}]]\n`;
    const b = toBundle(
      {
        scriptName: "text.md",
        script,
        bin: ["cut", "kept"],
        scratchpad: "ideas",
        settings: { templateName: "Manuscript", assetsFolder: "My Book assets" },
        others: [{ path: "assets/map.png", data: new Uint8Array([1, 2, 3]) }],
      },
      id,
    );
    expect(b.mode).toBe("markdown");
    expect(b.text).toBe("A manuscript ![map](assets/map.png).\n");
    expect(b.binItems).toEqual(["cut", "kept"]);
    expect(b.scratchpad).toBe("ideas");
    expect(b.get("assets/map.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(b.highlandSettings.templateName).toBe("Manuscript");
    expect((b.info.highwaterToo as { documentId: string }).documentId).toBe(id);
  });

  it("chooses a template from the text type when none was chosen", () => {
    expect(toBundle({ scriptName: "text.fountain", script: "INT. HOUSE - DAY\n" }, id).highlandSettings.templateName).toBe("Screenplay");
    expect(toBundle({ scriptName: "text.txt", script: "Notes.\n" }, id).mode).toBe("plain");
  });

  it("rebuilds a .highland file's save whole, from its own info.json", () => {
    const original = createDocument({ mode: "fountain", template: "Screenplay", text: "x" });
    const others = original.paths.filter((p) => p !== original.textPath).map((p) => ({ path: p, data: original.get(p)! }));
    const b = toBundle({ scriptName: "text.fountain", script: "INT. HOUSE - DAY\n", others, bin: ["b"] }, id);
    expect(b.text).toBe("INT. HOUSE - DAY\n");
    expect(b.get("characters.json")).toBeDefined();
    expect(b.binItems).toEqual(["b"]);
    expect((b.info.highwaterToo as { documentId: string }).documentId).toBe(id);
  });
});

describe("the Navigator", () => {
  it("does not list the note linking a plain file to its history", () => {
    const items = navigatorItems(parse(`INT. HOUSE - DAY\n\nShe enters. [[check this]]\n\n[[highwater: ${id}]]\n`, { mode: "fountain" }));
    expect(JSON.stringify(items.map((i) => [i.type, i.label, i.children.map((c) => c.label)]))).not.toContain("highwater:");
    expect(JSON.stringify(items)).toContain("check this");
  });
});
