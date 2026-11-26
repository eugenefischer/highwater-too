/**
 * The Works view's page, in VS Code's own Highwater Too sidebar when no Highwater Editor is in
 * front (works-view.ts is its script): Open Document… and New Document…, then the Works panel as
 * the editor's sidebar has it, with the editor's stylesheet (page.css).
 */
import css from "./page.css";
import { WORKS_SECTION } from "./page-html.ts";

export interface WorksViewAddresses {
  cspSource: string;
  nonce: string;
  /** The page's script (works-view.js). */
  script: string;
}

export function worksViewHtml(p: WorksViewAddresses): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${p.cspSource} data:; style-src ${p.cspSource} 'unsafe-inline'; script-src 'nonce-${p.nonce}';">
<style>${css}</style></head>
<body class="works-view">
<div id="sidebar">
  <div id="wvlinks"><button id="wvopen">Open Document…</button><button id="wvnew">New Document…</button></div>
  <div id="sbpanels">
${WORKS_SECTION.replace(" hidden>", ">")}
  </div>
</div>
<div id="sbmenu" role="menu" hidden></div>
<div id="sbhelp" role="dialog" aria-label="Help" tabindex="-1" hidden><div id="sbhelptext"></div></div>
<script nonce="${p.nonce}" src="${p.script}"></script></body></html>`;
}
