/**
 * @highwater/parser: Fountain + Markdown + Highland directives parser with exact source spans (milestone M2).
 * Must not import "vscode" (see spec, Code layout).
 */
export const PACKAGE_NAME = "@highwater/parser";
export type * from "./ast.ts";
export { isBlank, lineText, splitLines } from "./lines.ts";
export { findOverlays, hiddenRanges, logicalText, offsetAt, type LogicalText } from "./overlays.ts";
export { modeFromFileName, parse, type ParseOptions } from "./parse.ts";
export { TITLE_PAGE_KEYS, fieldText, normalizeKey, readTitlePage } from "./title-page.ts";
export { classifyFountain } from "./fountain.ts";
export { classifyMarkdown, classifyPlain } from "./markdown.ts";
export { inlineText, parseInline, parseInlineLines } from "./inline.ts";
export { collectDirectives, directivesInLine, formatTimestamp, parseDirective, seriesCounter } from "./directives.ts";
export { resolveIncludes, type IncludeFile, type IncludeLoader, type IncludeProblem, type IncludeResult, type MergedElement, type ResolvedDocument, type ResolvedInclude } from "./includes.ts";
