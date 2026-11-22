import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, openEditor } from "./harness.ts";

/**
 * What the Highwater Editor's page does with typing, keys and messages, in Chromium. Offsets are
 * CodeMirror's (the page's text has "\n" line breaks only).
 */
afterAll(closeBrowser);

const mod = process.platform === "darwin" ? "Meta" : "Control";
// The page decides Mac or not from navigator.platform, which Chromium reports truthfully, so the
// keys follow the machine the tests run on.

describe("the text and the extension", () => {
  it("posts each edit as changes that rebuild the page's text from the document's", async () => {
    const start = "# Chapter\n\nThe first line.\n";
    const e = await openEditor(start, "markdown");
    await e.select(start.indexOf("first"), start.indexOf("first") + "first".length);
    await e.page.keyboard.type("only", { delay: 20 });
    await e.page.keyboard.press("End");
    await e.page.keyboard.press("Enter");
    await e.page.keyboard.type("More.", { delay: 20 });
    let text = start;
    for (const m of await e.posted()) if (m.type === "edit") for (const c of m.changes) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
    expect(text).toBe(await e.text());
    expect(text).toBe("# Chapter\n\nThe only line.\nMore.\n");
    await e.close();
  });

  it("takes a change made elsewhere without posting it back", async () => {
    const e = await openEditor("One.\n\nTwo.\n", "markdown");
    await e.post({ type: "update", text: "One.\n\nTwo and a half.\n" });
    await e.page.waitForTimeout(50);
    expect(await e.text()).toBe("One.\n\nTwo and a half.\n");
    expect((await e.posted()).filter((m) => m.type === "edit")).toEqual([]);
    await e.close();
  });
});

describe("undo and redo", () => {
  it("undoes typing over a selection in one step, and keeps the keys from VS Code", async () => {
    const start = "# Chapter\n\nThe first line.\n\nThe second line, to replace.\n";
    const e = await openEditor(start, "markdown");
    const from = start.indexOf("The second");
    await e.select(from, start.length - 1);
    await e.page.keyboard.type("New words", { delay: 30 });
    expect(await e.text()).toBe(start.replace("The second line, to replace.", "New words"));
    await e.page.keyboard.press(`${mod}+z`);
    expect(await e.text()).toBe(start);
    expect(await e.selection()).toMatchObject({ anchor: from, head: start.length - 1 });
    await e.page.keyboard.press(`${mod}+Shift+z`);
    expect(await e.text()).toBe(start.replace("The second line, to replace.", "New words"));
    // VS Code's own Undo would also undo the document's last edit (one key press).
    expect((await e.forwarded()).filter((k) => /\+(z|Z|y)$/.test(k))).toEqual([]);
    await e.close();
  });

  it("leaves undo in a text box to the box, and still keeps the key from VS Code", async () => {
    const e = await openEditor("Text.\n", "markdown");
    await e.page.evaluate(() => {
      const t = document.querySelector("textarea")!;
      t.closest("[hidden]")?.removeAttribute("hidden");
      t.style.display = "block";
      t.value = "";
      t.focus();
    });
    await e.page.keyboard.type("scratch", { delay: 20 });
    await e.page.keyboard.press(`${mod}+z`);
    expect(await e.page.evaluate(() => document.querySelector("textarea")!.value)).toBe("");
    expect(await e.text()).toBe("Text.\n");
    expect((await e.forwarded()).filter((k) => /\+z$/.test(k))).toEqual([]);
    await e.close();
  });
});

describe("keys", () => {
  it("passes Highwater's own keys on to VS Code and does nothing with them itself", async () => {
    const e = await openEditor("Some words.\n", "markdown");
    await e.select(0, 4);
    await e.page.keyboard.press(`${mod}+b`);
    expect(await e.text()).toBe("Some words.\n");
    expect(await e.forwarded()).toContain(`${mod}+b`);
    await e.close();
  });
});

describe("the cursor at a wrapped line", () => {
  const para = "The person he spoke to first, he later recalled, was Diana Glampers. He hadn't put nametags in his ambient, like most did, he just remembered her introduction with a kind of startled pleasure that someone would bother to say her whole name aloud at a party like this one, where nobody did.";
  for (const columnWidth of ["narrow", "medium", "wide"]) {
    it(`stops at both sides of every wrap after a space (${columnWidth} column)`, async () => {
      const e = await openEditor(`# Chapter\n\n${para}\n\n${para.replace(/ /g, "  ")}\n`, "markdown", { settings: { general: { columnWidth } } });
      const wraps = await e.evaluate<number[]>(`(v) => { const d = v.state.doc.toString(); const out = [];
        for (let p = 1; p < d.length; p++) { const a = v.coordsAtPos(p, -1), b = v.coordsAtPos(p, 1); if (a && b && b.top - a.top > 3 && d[p - 1] !== "\\n") out.push(p); } return out; }`);
      expect(wraps.length).toBeGreaterThan(3);
      const text = await e.text();
      for (const n of wraps) {
        await e.select(n - 1);
        const seen: [number, number][] = [];
        for (const k of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft", "ArrowLeft"]) {
          await e.page.keyboard.press(k);
          const s = await e.selection();
          seen.push([s.head, s.assoc]);
        }
        if (text[n - 1] === " ")
          expect(seen, `wrap at ${n}`).toEqual([
            [n, -1],
            [n, 1],
            [n + 1, -1],
            [n, 1],
            [n, -1],
            [n - 1, 1],
          ]);
        else expect(seen.map((s) => s[0]), `wrap at ${n}`).toEqual([n, n + 1, n + 2, n + 1, n, n - 1]);
      }
      await e.close();
    });
  }
});

describe("edit rules", () => {
  it("puts a scene heading in capitals as it is typed", async () => {
    const e = await openEditor("INT. HALL - DAY\n\nAction.\n\n", "fountain");
    await e.page.keyboard.press(`${mod}+End`);
    await e.page.keyboard.type("int. kitchen - night", { delay: 20 });
    expect(await e.text()).toBe("INT. HALL - DAY\n\nAction.\n\nINT. KITCHEN - NIGHT");
    await e.close();
  });

  it("keeps a plain file's history line hidden and out of reach", async () => {
    const id = "<!-- highwater: 0123456789abcdef -->";
    const e = await openEditor(`Text.\n\n${id}\n`, "markdown", { settings: { backup: { linkPlainFiles: true } } });
    await e.page.keyboard.press(`${mod}+End`);
    await e.page.keyboard.type(" More.", { delay: 20 });
    const text = await e.text();
    expect(text.endsWith(`\n\n${id}\n`)).toBe(true);
    expect(text).toContain("More.");
    expect(await e.page.evaluate(() => document.querySelector(".cm-content")!.textContent!.includes("highwater:"))).toBe(false);
    await e.close();
  });

  it("refuses typing while comparing with a save", async () => {
    const e = await openEditor("The text now.\n", "markdown");
    await e.post({ type: "compare", base: "The text then.\n", hash: "0", at: 0 });
    await e.page.waitForTimeout(100);
    await e.select(4);
    await e.page.keyboard.type("x");
    expect(await e.text()).toBe("The text now.\n");
    await e.close();
  });
});
