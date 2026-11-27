import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { postTo, whileOpen, type ToPage } from "../src/highland-editor/messages.ts";

const msg: ToPage = { type: "update", text: "x" };
const gone = () => new Error("Webview is disposed");

describe("a message to a page that has closed", () => {
  const unhandled: unknown[] = [];
  const track = (e: unknown) => unhandled.push(e);
  afterEach(() => {
    process.off("unhandledRejection", track);
    unhandled.length = 0;
  });

  // VS Code's three ways of refusing (extHostWebviewPanels.ts): the webview getter throws, postMessage
  // throws, or postMessage's promise rejects. Each is dropped, with nothing left unhandled.
  const panels: [string, { readonly webview: { postMessage(m: unknown): PromiseLike<boolean> } }][] = [
    ["its webview is gone", { get webview(): never { throw gone(); } }],
    ["postMessage throws", { webview: { postMessage: () => { throw gone(); } } }],
    ["postMessage rejects", { webview: { postMessage: () => Promise.reject(gone()) } }],
  ];
  for (const [what, panel] of panels)
    it(`is dropped when ${what}`, async () => {
      process.on("unhandledRejection", track);
      expect(() => postTo(panel, msg)).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    });

  it("is delivered when the page is there", async () => {
    const sent: unknown[] = [];
    postTo({ webview: { postMessage: async (m) => (sent.push(m), true) } }, msg);
    expect(sent).toEqual([msg]);
  });

  it("whileOpen says whether the panel is still open", () => {
    let close = () => {};
    const open = whileOpen({ onDidDispose: (f) => (close = f) });
    expect(open()).toBe(true);
    close();
    expect(open()).toBe(false);
  });

  it("goes through postTo everywhere in the extension: no other code posts to a webview", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
    const offenders = files(src).filter((f) => !f.endsWith("messages.ts") && /\bwebview\.postMessage\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
