/**
 * The Highwater Editor's page: its markup, with the stylesheet (page.css) inlined, as the webview
 * loads it. The provider supplies the webview's addresses for scripts, fonts and data files.
 */
import css from "./page.css";

export interface PageAddresses {
  /** The webview's source for the security policy. */
  cspSource: string;
  /** The script tag's nonce. */
  nonce: string;
  /** The page's script (highland-editor.js). */
  script: string;
  /** The spelling worker (spell-worker.js). */
  spellWorker: string;
  font(file: string): string;
  pdfjs(file: string): string;
  dict(file: string): string;
}

export function pageHtml(p: PageAddresses): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${p.cspSource} data:; img-src ${p.cspSource} blob: data:; style-src ${p.cspSource} 'unsafe-inline'; script-src 'nonce-${p.nonce}' ${p.cspSource}; connect-src ${p.cspSource}; worker-src blob:;">
<style>
@font-face { font-family: "Courier Prime"; src: url("${p.font("CourierPrime-Regular.ttf")}"); }
@font-face { font-family: "Courier Prime"; font-weight: bold; src: url("${p.font("CourierPrime-Bold.ttf")}"); }
@font-face { font-family: "Courier Prime"; font-style: italic; src: url("${p.font("CourierPrime-Italic.ttf")}"); }
@font-face { font-family: "Courier Prime"; font-weight: bold; font-style: italic; src: url("${p.font("CourierPrime-BoldItalic.ttf")}"); }
${css}</style></head>
<body data-pdfjs="${p.pdfjs("pdf.min.mjs")}" data-worker="${p.pdfjs("pdf.worker.min.mjs")}" data-spell-worker="${p.spellWorker}" data-dict-aff="${p.dict("index.aff")}" data-dict-dic="${p.dict("index.dic")}">
<div id="sidebar">
  <div id="sbicons" role="toolbar" aria-label="Sidebar">
    <button class="tb-icon" data-panel="navigator" data-tip="Navigator" aria-label="Navigator"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="6" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="5" cy="18" r="1.4"/><rect x="8.5" y="5" width="11" height="2" rx="1"/><rect x="8.5" y="11" width="11" height="2" rx="1"/><rect x="8.5" y="17" width="11" height="2" rx="1"/></svg></button>
    <button class="tb-icon" data-panel="bin" data-tip="Bin" aria-label="Bin"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5V9H4zM4 10.5h16v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zm4 3v1.5h8V13.5z" fill-rule="evenodd"/></svg></button>
    <button class="tb-icon" data-panel="stats" data-tip="Statistics" aria-label="Statistics"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="10" width="2.2" height="10" rx="1"/><rect x="8.6" y="5" width="2.2" height="15" rx="1"/><rect x="13.2" y="8" width="2.2" height="12" rx="1"/><rect x="17.8" y="4" width="2.2" height="16" rx="1"/></svg></button>
    <button class="tb-icon" data-panel="assets" data-tip="Assets" aria-label="Assets"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5V9H6.2a1.5 1.5 0 0 0-1.4 1L3 15zM6.3 10.5H22l-2.6 8.4a1.5 1.5 0 0 1-1.4 1.1H4.2z"/></svg></button>
    <button class="tb-icon" data-panel="scratchpad" data-tip="Scratchpad" aria-label="Scratchpad"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V15l-6 6H6.5A1.5 1.5 0 0 1 5 19.5zM8 7v1.6h8V7zm0 3.5v1.6h8v-1.6zm0 3.5v1.6h5V14zm5 7v-4.5a1.5 1.5 0 0 1 1.5-1.5H19z" fill-rule="evenodd"/></svg></button>
    <button class="tb-icon sb-ours" data-panel="history" data-tip="Writing History" aria-label="Writing History"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><path d="M12 8v4l3 2"/></svg></button>
    <button class="tb-icon" data-panel="works" data-tip="Works" aria-label="Works"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="4" height="16" rx="1"/><rect x="9.5" y="4" width="4" height="16" rx="1"/><path d="M15.2 5.3l3.6-1 3.8 14.6-3.6 1z"/></svg></button>
  </div>
  <div id="sbpanels">
    <section data-panel="navigator">
      <div id="navwrap"><div id="navlist" tabindex="0"></div><div id="navempty" hidden>The Navigator panel shows an outline of your document.</div><div id="navdrop" hidden></div></div>
      <div class="sb-foot"><input id="navfilter" type="search" placeholder="Filter" aria-label="Filter the Navigator"><button id="navtypes" class="sb-button" data-tip="Choose what the Navigator shows" aria-label="Choose what the Navigator shows"><svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.4 3 1.6 5.4.5 8c1.1 2.6 3.9 5 7.5 5s6.4-2.4 7.5-5C14.4 5.4 11.6 3 8 3zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button></div>
    </section>
    <section data-panel="bin" id="binpanel" hidden>
      <div class="sb-scroll"><div id="binlist" class="sb-cards"></div><div id="binempty" class="sb-note" hidden></div></div>
      <div class="sb-foot"><input id="binfilter" type="search" placeholder="Filter" aria-label="Filter the Bin"><button id="binnew" class="sb-button" data-tip="New Bin item" aria-label="New Bin item"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button><button id="binexport" class="sb-button" data-tip="Export Bin contents to a new document" aria-label="Export Bin contents to a new document"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg></button></div>
    </section>
    <section data-panel="stats" hidden><div class="sb-empty">Statistics come with goals and sprints (M11).</div></section>
    <section data-panel="assets" id="assetpanel" hidden>
      <div class="sb-scroll"><div id="assetlist" class="sb-cards"></div><div id="assetempty" class="sb-note" hidden></div></div>
      <div class="sb-foot sb-foot-end"><button id="assetadd" class="sb-button" data-tip="Add images…" aria-label="Add images…"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button></div>
    </section>
    <section data-panel="scratchpad" hidden>
      <div id="scratchwrap"><textarea id="scratch" spellcheck="false" aria-label="Scratchpad" placeholder="Click here to edit"></textarea><div id="scratchempty" class="sb-note">The Scratchpad is a place to make notes about your document.</div></div>
      <div id="scratchfoot" class="sb-foot"><button id="scratchexport" class="sb-button" data-tip="Export Scratchpad contents to a new document" aria-label="Export Scratchpad contents to a new document"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg></button></div>
    </section>
    <section data-panel="history" hidden>
      <div class="sb-head sb-head-help"><span id="histtitle"></span><button id="histhelp" class="sb-button sb-help" data-tip="Help" aria-label="Writing History help" aria-haspopup="dialog"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg></button></div>
      <div class="sb-scroll" id="histscroll"><div id="histlist" class="sb-rows" tabindex="0" role="listbox" aria-label="Saves"></div><div id="histnote" class="sb-note sb-loading">Loading history…</div></div>
      <div class="sb-foot">
        <div id="histstatus"><div id="histstate"></div><div id="histmirror" hidden></div></div>
        <button id="histrecord" class="sb-button" data-tip="Turn Writing History Off for This Document" aria-label="Turn Writing History Off for This Document" hidden><svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><circle class="hist-dot" cx="12" cy="12" r="4" fill="currentColor"/></svg></button>
        <button id="histexport" class="sb-button" data-tip="Export Writing History…" aria-label="Export Writing History…"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg></button>
        <button id="histgear" class="sb-button" data-tip="More writing history actions" aria-label="More writing history actions" aria-haspopup="menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
      </div>
    </section>
    <section data-panel="works" hidden>
      <div class="sb-head sb-head-help"><span id="workcomputer"></span><button id="workhelp" class="sb-button sb-help" data-tip="Help" aria-label="Works help" aria-haspopup="dialog"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/></svg></button></div>
      <div class="sb-scroll" id="workscroll"><div id="worklist" class="sb-rows" tabindex="0" role="listbox" aria-label="Works"></div><div id="worknote" class="sb-note sb-loading">Loading works…</div></div>
      <div id="workstatus" hidden></div>
      <div class="sb-foot"><input id="workfilter" type="search" placeholder="Filter" aria-label="Filter the works"><button id="workrefresh" class="sb-button" data-tip="Sync with the mirror" aria-label="Sync with the mirror" hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg></button></div>
    </section>
  </div>
  <div id="sbgrip" aria-hidden="true"></div>
</div>
<div id="sbmenu" role="menu" hidden></div>
<div id="navpop" role="dialog" aria-label="Show in the Navigator" hidden></div>
<div id="sbhelp" role="dialog" aria-label="Help" tabindex="-1" hidden><div id="sbhelptext"></div></div>
<div id="binpop" role="dialog" aria-label="Bin item" hidden><textarea id="binpoptext" spellcheck="false" aria-label="Bin item text"></textarea></div>
<div id="content">
<div id="topbar">
  <div class="tb-side">
    <button id="tbsidebar" class="tb-icon" data-tip="Show or hide the sidebar" aria-label="Show or hide the sidebar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M9.5 5v14"/></svg></button>
    <button id="tbtext" class="tb-icon" data-tip="Show Editor" aria-label="Show Editor (⌘E)"><svg viewBox="0 0 24 24"><path d="M4 5h16M4 9.5h12M4 14h16M4 18.5h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    <button id="tbpages" class="tb-icon" data-tip="Show Preview" aria-label="Show Preview (⌘E)"><svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="1.1" class="tb-hole"/><circle cx="8.5" cy="12" r="1.1" class="tb-hole"/><circle cx="8.5" cy="16.5" r="1.1" class="tb-hole"/></svg></button>
  </div>
  <div class="tb-mid">
    <select id="pzoom" aria-label="Page size" data-tip="Page size"><option value="fit">Fit width</option><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select>
    <span id="pstatus"></span>
  </div>
  <div class="tb-side tb-right">
    <button id="ptemplate" data-tip="Choose the document's template" aria-haspopup="dialog" hidden></button>
    <button id="tbtheme" class="tb-icon" data-tip="Choose a theme for the app" aria-label="Choose a theme for the app"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="3.3 2.6"/></svg></button>
  </div>
</div>
<div id="main">
<div id="cmpbar" role="toolbar" aria-label="Comparing with a save" hidden><span class="cmp-what"></span><span class="cmp-where"></span><button class="cmp-prev sb-button" aria-label="Previous change"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button><button class="cmp-next sb-button" aria-label="Next change"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button><span class="cmp-hint">Double-click to edit there, or press Done</span><button class="cmp-revert cmp-text" data-tip="Revert to this save">Revert…</button><button class="cmp-done cmp-text" data-tip="Stop comparing (Escape)">Done</button></div>
<div id="editor"></div>
<div id="preview">
  <div id="pages" tabindex="-1"></div>
  <div id="pbottom"><div id="pboxes"></div><button id="psaveword" hidden>Save As Word</button><button id="psave">Save As PDF</button></div>
</div>
</div>
<div id="counts"></div>
</div>
<script nonce="${p.nonce}" src="${p.script}"></script></body></html>`;
}
