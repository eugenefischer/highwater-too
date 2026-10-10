/**
 * @highwater/parser: Fountain + Markdown + Highland directives parser with exact source spans (milestone M2).
 * Must not import "vscode" (see spec, Code layout).
 */
export const PACKAGE_NAME = "@highwater/parser";
export type * from "./ast.ts";
export { isBlank, lineText, splitLines } from "./lines.ts";
export { findOverlays, hiddenRanges, logicalText, type LogicalText } from "./overlays.ts";
export { modeFromFileName, parse, type ParseOptions } from "./parse.ts";
export { TITLE_PAGE_KEYS, fieldText, normalizeKey, readTitlePage } from "./title-page.ts";
