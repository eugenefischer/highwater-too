/**
 * Every message between the extension and the Highwater Editor's page, in both directions. The
 * extension side (provider.ts, sidebar-host.ts) and the page side (webview.ts, sidebar.ts, pages.ts,
 * template-window.ts, spelling.ts) both type their messages from here, so a renamed field or a
 * misspelled type is a compile error. No VS Code or DOM imports, since both sides use it.
 * The extension sends with `postTo`; the page with its `acquireVsCodeApi()` handle, typed `FromPage`.
 */
import type { Mode } from "@highwater/parser";
import type { NavigatorFilters } from "../syntax/navigator.ts";

export const PANELS = ["navigator", "bin", "stats", "assets", "scratchpad", "history", "works"] as const;
export type PanelName = (typeof PANELS)[number];

export interface SidebarState {
  open: boolean;
  panel: PanelName;
  width: number;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface SelectionRange {
  anchor: number;
  head: number;
}

/** A change to the Bin that undo can reverse: an item added or removed at an index, or moved. */
export type BinOp = { kind: "add" | "remove"; index: number; text: string } | { kind: "move"; from: number; to: number };

export interface BinCard {
  text: string;
  label: string;
  detail: string;
}

export interface AssetCard {
  name: string;
  label: string;
  detail: string;
  reference: string;
  thumb: string | null;
}

export interface HistorySave {
  hash: string;
  /** Milliseconds since 1970. */
  at: number;
  kind: string;
  note: string;
  delta: string;
  words: string;
}

export interface MenuItem {
  label: string;
  command: string;
  sep?: boolean;
  /** Shown in the error colour (deleting). */
  danger?: boolean;
}

export interface MirrorStatus {
  at: number | null;
  error: string | null;
  signIn: boolean;
  busy: boolean;
}

export interface HistoryMessage {
  type: "history";
  title: string;
  note: string;
  saves: HistorySave[];
  state: "on" | "paused" | "off" | "none";
  document: boolean;
  mirror: MirrorStatus | null;
  menu: MenuItem[];
}

export interface WorkRow {
  i: number;
  title: string;
  file: string;
  /** Last save, milliseconds since 1970. */
  at: number | null;
  words: string;
  kind: "here" | "local" | "remote";
}

export interface WorkSaveRow {
  j: number;
  at: number;
  kind: string;
  note: string;
  delta: string;
  words: string;
}

export interface PdfMessage {
  type: "pdf";
  data: Uint8Array;
  template: string;
  templates: readonly string[];
  anchors: number[];
  problems: string[];
  print: Record<string, boolean>;
  /** The offset the pages should open at. */
  at: number | null;
}

/** The template window's option values: template name → option key → value. */
export type OptionValues = Record<string, Record<string, string | boolean>>;

/** From the extension to the page. */
export type ToPage =
  // The text and how to show it.
  | { type: "init"; text: string; mode: Mode }
  | { type: "update"; text: string }
  | { type: "reveal"; offset: number; how: "top" | "center"; select: boolean }
  | { type: "select"; ranges: SelectionRange[] }
  | { type: "theme"; vars: Record<string, string> | null }
  | { type: "fontSize"; px: number | null }
  | { type: "numbers"; on: boolean }
  | { type: "invisibles"; on: boolean }
  | { type: "spelling"; on: boolean; words: string[] }
  | { type: "nextMisspelling" }
  | { type: "counts"; characters: number; words: number; pages: number | null }
  | { type: "recordDrag" }
  // The pages (preview mode) and the template window.
  | { type: "togglePreview" }
  | PdfMessage
  | { type: "previewEmpty"; message: string }
  | { type: "template"; template: string; templates: readonly string[] }
  | { type: "templateValues"; values: OptionValues }
  | { type: "templateThumb"; template: string; data: Uint8Array | null; message: string }
  // The sidebar.
  | { type: "sidebar"; state: Partial<SidebarState> }
  | { type: "showPanel"; panel: PanelName }
  | { type: "toggleSidebar" }
  | { type: "navFilters"; json: string | undefined; filters: NavigatorFilters | undefined }
  | { type: "scratchpad"; text: string; force: boolean }
  | { type: "scratchpadSaved"; text: string }
  | { type: "bin"; items: BinCard[]; available: boolean }
  | { type: "toBin"; cut: boolean }
  | { type: "binRefused" }
  | { type: "assets"; items: AssetCard[]; available: boolean }
  | HistoryMessage
  | { type: "works"; items: WorkRow[]; mirror: MirrorStatus | null; computer: string }
  | { type: "workSaves"; i: number; saves: WorkSaveRow[] };

/** From the page to the extension. */
export type FromPage =
  // The text.
  | { type: "ready" }
  | { type: "pageFocus" }
  | { type: "edit"; changes: TextChange[] }
  | { type: "selection"; ranges: SelectionRange[] }
  | { type: "scroll"; top: number }
  | { type: "chooseTheme" }
  | { type: "learnWord"; word: string }
  | { type: "dragRecord"; lines: string[] }
  // The pages and the template window.
  | { type: "preview"; at: number | null }
  | { type: "previewClosed" }
  | { type: "previewSave"; kind: "pdf" | "docx" }
  | { type: "printOption"; key: string; value: boolean }
  | { type: "templateWindow" }
  | { type: "previewTemplate"; template: string }
  | { type: "templateOption"; template: string; key: string; value: string | boolean }
  | { type: "templateThumb"; template: string }
  // The sidebar.
  | { type: "sidebarState"; state: SidebarState }
  | { type: "navFiltersSet"; filters: NavigatorFilters }
  | { type: "scratchpadSave"; text: string }
  | { type: "scratchpadExport"; text: string }
  | { type: "binOp"; op: BinOp }
  | { type: "binEdit"; index: number; text: string }
  | { type: "binExport" }
  | { type: "assetsAdd" }
  | { type: "assetsImport"; files: { name: string; data: Uint8Array }[] }
  | { type: "assetDelete"; name: string }
  | { type: "assetOpen"; name: string }
  | { type: "historyCommand"; command: string }
  | { type: "historyCompare"; hash: string }
  | { type: "historyRevert"; hash: string }
  | { type: "worksRefresh" }
  | { type: "workAction"; i: number; action: string }
  | { type: "workSaves"; i: number }
  | { type: "workSave"; i: number; j: number };

/** Sends a message to a Highwater Editor page (as `void panel.webview.postMessage(msg)`, typed). */
export function postTo(panel: { webview: { postMessage(message: unknown): unknown } }, msg: ToPage): void {
  void panel.webview.postMessage(msg);
}
