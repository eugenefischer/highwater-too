import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { BACKUP_DEFAULTS } from "../src/highland-editor/backup-settings.ts";
import { DOCUMENT_DEFAULTS } from "../src/highland-editor/document-settings.ts";
import { GENERAL_DEFAULTS } from "../src/highland-editor/general-settings.ts";
import { INTERNATIONAL_DEFAULTS } from "../src/highland-editor/international-settings.ts";
import type { FromPage, ToPage } from "../src/highland-editor/messages.ts";
import { build } from "esbuild";

/**
 * The Highwater Editor's page outside VS Code, for testing what it does with key presses, the
 * mouse and messages. It is the page VS Code shows (page-html.ts and the built
 * dist/highland-editor.js, so run `npm run build` first), with two stand-ins:
 *
 * - `acquireVsCodeApi` records every message the page posts (`posted()`);
 * - a keydown listener on the page's window, bubbling, like the one VS Code's webview host adds to
 *   pass key presses on (pre/index.html `handleInnerKeydown`): `forwarded()` lists the key
 *   presses that would have reached VS Code's keybindings.
 *
 * Set HIGHWATER_CHROMIUM to a Chromium executable to use one other than Playwright's own.
 */
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

export type Mode = "fountain" | "markdown" | "plain";

export interface EditorPage {
  page: Page;
  post(message: ToPage): Promise<void>;
  posted(): Promise<FromPage[]>;
  forwarded(): Promise<string[]>;
  text(): Promise<string>;
  selection(): Promise<{ anchor: number; head: number; assoc: number }>;
  select(anchor: number, head?: number): Promise<void>;
  /** Runs a function with the CodeMirror view in the page. */
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
}

let browser: Browser | null = null;
let file: string | null = null;

/** page-html.ts imports its stylesheet as text (esbuild's text loader), so it is bundled the same way here. */
async function pageHtml(addresses: object, module = "page-html.ts", fn = "pageHtml"): Promise<string> {
  const r = await build({ entryPoints: [join(dirname(fileURLToPath(import.meta.url)), `../src/highland-editor/${module}`)], bundle: true, format: "esm", write: false, loader: { ".css": "text" }, platform: "node", logLevel: "warning" });
  const mod = (await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0]!.text).toString("base64")}`)) as Record<string, (a: object) => string>;
  return mod[fn]!(addresses);
}

/** The stand-in for VS Code's webview API: every message the page posts is kept in `highwaterTest.posted`. */
const STAND_IN = `<script>
window.highwaterTest = { view: null, posted: [], forwarded: [] };
window.acquireVsCodeApi = () => ({ postMessage: (m) => window.highwaterTest.posted.push(JSON.parse(JSON.stringify(m))) });
window.addEventListener("keydown", (e) => {
  const mods = (e.metaKey ? "Meta+" : "") + (e.ctrlKey ? "Control+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "");
  if (mods && mods !== "Shift+" && !["Shift", "Control", "Alt", "Meta"].includes(e.key)) window.highwaterTest.forwarded.push(mods + e.key);
});
</script>`;

async function harnessFile(): Promise<string> {
  if (file) return file;
  const url = (x: string) => pathToFileURL(join(dist, x)).href;
  let html = await pageHtml({ cspSource: "", nonce: "n", script: url("highland-editor.js"), spellWorker: url("spell-worker.js"), font: (x: string) => url(`fonts/${x}`), pdfjs: (x: string) => url(`pdfjs/${x}`), dict: (x: string) => url(`dictionary-en/${x}`) });
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
  html = html.replace("<head>", `<head>${STAND_IN}`);
  const dir = mkdtempSync(join(tmpdir(), "highwater-page-"));
  file = join(dir, "page.html");
  writeFileSync(file, html);
  return file;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

/** Opens the page with the text, as the extension does: settings, then init. */
export async function openEditor(text: string, mode: Mode, o: { width?: number; settings?: { general?: object; document?: object; backup?: object } } = {}): Promise<EditorPage> {
  browser ??= await chromium.launch(process.env.HIGHWATER_CHROMIUM ? { executablePath: process.env.HIGHWATER_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: o.width ?? 1100, height: 700 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(await harnessFile()).href);
  const post = (m: ToPage) => page.evaluate((msg) => window.postMessage(msg, "*"), m as unknown as object);
  await post({
    type: "settings",
    general: { ...GENERAL_DEFAULTS, ...o.settings?.general },
    document: { ...DOCUMENT_DEFAULTS, ...o.settings?.document },
    international: INTERNATIONAL_DEFAULTS,
    backup: { ...BACKUP_DEFAULTS, ...o.settings?.backup },
  } as ToPage);
  await post({ type: "init", text, mode });
  await page.waitForFunction(() => (window as unknown as { highwaterTest: { view: unknown } }).highwaterTest.view !== null);
  await page.evaluate(() => document.fonts.ready);
  await page.click(".cm-content");
  const T = "window.highwaterTest";
  return {
    page,
    post,
    posted: () => page.evaluate(`${T}.posted`),
    forwarded: () => page.evaluate(`${T}.forwarded`),
    text: () => page.evaluate(`${T}.view.state.doc.toString()`),
    selection: () => page.evaluate(`(() => { const m = ${T}.view.state.selection.main; return { anchor: m.anchor, head: m.head, assoc: m.assoc }; })()`),
    select: (anchor, head = anchor) => page.evaluate(`${T}.view.dispatch({ selection: { anchor: ${anchor}, head: ${head} } })`),
    evaluate: (fn) => page.evaluate(`(${fn})(${T}.view)`),
    close: async () => {
      await page.close();
      if (errors.length) throw new Error(`Errors in the page: ${errors.join("; ")}`);
    },
  };
}

export interface WorksViewPage {
  page: Page;
  post(message: ToPage): Promise<void>;
  posted(): Promise<FromPage[]>;
  close(): Promise<void>;
}

let worksFile: string | null = null;

/** The Works view's page (works-view-html.ts and the built dist/works-view.js), as VS Code's sidebar shows it, `width` wide. */
export async function openWorksView(o: { width?: number; height?: number } = {}): Promise<WorksViewPage> {
  if (!worksFile) {
    let html = await pageHtml({ cspSource: "", nonce: "n", script: pathToFileURL(join(dist, "works-view.js")).href }, "works-view-html.ts", "worksViewHtml");
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "").replace("<head>", `<head>${STAND_IN}`);
    worksFile = join(mkdtempSync(join(tmpdir(), "highwater-works-")), "works.html");
    writeFileSync(worksFile, html);
  }
  browser ??= await chromium.launch(process.env.HIGHWATER_CHROMIUM ? { executablePath: process.env.HIGHWATER_CHROMIUM } : {});
  const page = await browser.newPage({ viewport: { width: o.width ?? 300, height: o.height ?? 600 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(worksFile).href);
  return {
    page,
    post: (m) => page.evaluate((msg) => window.postMessage(msg, "*"), m as unknown as object),
    posted: () => page.evaluate("window.highwaterTest.posted"),
    close: async () => {
      await page.close();
      if (errors.length) throw new Error(`Errors in the page: ${errors.join("; ")}`);
    },
  };
}
