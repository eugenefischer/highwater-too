import { afterAll, describe, expect, it } from "vitest";
import type { ToPage, WorkRow } from "../src/highland-editor/messages.ts";
import { closeBrowser, openWorksView } from "./harness.ts";

/** The Works view in VS Code's own sidebar (works-view.ts), in Chromium at a sidebar's width. */
afterAll(closeBrowser);

const rows: WorkRow[] = [
  { i: 0, title: "The Kettle", file: "The Kettle.highland", at: Date.now(), words: "1,200", kind: "here" },
  { i: 1, title: "Old Draft", file: "Old Draft.fountain", at: Date.now(), words: "300", kind: "local" },
  { i: 2, title: "Elsewhere", file: "Elsewhere.highland", at: Date.now(), words: "", kind: "remote" },
];
const works: ToPage = { type: "works", items: rows, mirror: { busy: false, at: Date.now(), error: null, signIn: false }, computer: "Desk", reveal: "Reveal in Finder" };

describe("the Works view", () => {
  it("asks for the works, lists them under where they are, and opens, restores and runs its buttons", async () => {
    const v = await openWorksView();
    await v.page.waitForFunction(() => (window as unknown as { highwaterTest: { posted: { type: string }[] } }).highwaterTest.posted.some((m) => m.type === "ready"));
    await v.post(works);
    await v.page.waitForSelector(".work-card");
    expect(await v.page.$$eval(".sb-day", (h) => h.map((x) => x.textContent))).toEqual(["LOCAL WORKS", "LOCAL HISTORY ONLY", "MIRROR ONLY"]);
    expect(await v.page.$$eval(".work-card .sb-row-title", (t) => t.map((x) => x.textContent))).toEqual(["The Kettle", "Old Draft", "Elsewhere"]);
    expect(await v.page.textContent("#workcomputer")).toBe("Desk");
    expect(await v.page.isVisible("#workrefresh")).toBe(true);
    // The view is no wider than VS Code's sidebar: nothing runs off its side.
    expect(await v.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A click selects a work, which shows its buttons.
    await v.page.click(".work-here .sb-row-title");
    await v.page.click(".work-here [aria-label='Open']");
    await v.page.click(".work-remote .sb-row-title");
    await v.page.click(".work-remote [aria-label='Restore…']");
    await v.page.click("#wvopen");
    await v.page.click("#wvnew");
    await v.page.click("#workrefresh");
    const posted = (await v.posted()).filter((m) => m.type !== "workSaves");
    expect(posted).toEqual([
      { type: "ready" },
      { type: "workAction", i: 0, action: "open" },
      { type: "workAction", i: 2, action: "restore" },
      { type: "worksViewCommand", command: "highwater.open" },
      { type: "worksViewCommand", command: "highwater.newDocument" },
      { type: "worksRefresh" },
    ]);
    await v.close();
  });

  it("shows the help over the view, inside it, and the More menu within it", async () => {
    const v = await openWorksView({ width: 260 });
    await v.post(works);
    await v.page.waitForSelector(".work-card");
    await v.page.click("#workhelp");
    const help = await v.page.locator("#sbhelp").boundingBox();
    expect(help).not.toBeNull();
    expect(help!.x).toBeGreaterThanOrEqual(0);
    expect(help!.x + help!.width).toBeLessThanOrEqual(260);
    await v.page.keyboard.press("Escape");
    expect(await v.page.isHidden("#sbhelp")).toBe(true);
    await v.page.click(".work-here .sb-row-title");
    await v.page.click(".work-here [aria-label='More']");
    const menu = await v.page.locator("#sbmenu").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(260);
    expect(await v.page.$$eval("#sbmenu button", (b) => b.map((x) => x.textContent))).toEqual(["Reveal in Finder", "Rename…", "Remove from This Computer…", "Delete Writing History…"]);
    await v.close();
  });

  it("says when there are no works yet", async () => {
    const v = await openWorksView();
    await v.post({ type: "works", items: [], mirror: null, computer: "Desk", reveal: "Reveal in Finder" });
    await v.page.waitForFunction(() => !document.getElementById("worknote")!.classList.contains("sb-loading"));
    expect(await v.page.textContent("#worknote")).toContain("No works yet");
    expect(await v.page.isVisible("#workrefresh")).toBe(false);
    await v.close();
  });
});
