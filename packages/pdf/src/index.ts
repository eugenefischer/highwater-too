/**
 * @highwater/pdf: PDF layout and rendering for Highland's templates (milestones M4, M5).
 * Our own layout engine on PDFKit, fed by @highwater/parser and Highland's measured layouts;
 * ideas for dual dialogue and (MORE)/(CONT'D) follow Better Fountain. Must not import "vscode".
 */
export const PACKAGE_NAME = "@highwater/pdf";
export * from "./types.ts";
export { SCREENPLAY, layoutScreenplay, type ScreenplayOptions } from "./screenplay.ts";
export { defaultFontDir, renderPdf, type RenderOptions } from "./render.ts";
export { plain, toRuns, wrapRuns, type InlineContext } from "./text.ts";
export { MANUSCRIPT, imageSize, layoutManuscript, manuscriptHeadingPages, type ManuscriptOptions } from "./manuscript.ts";
export { manuscriptDocx, DOCX_FONTS, type DocxFont, type DocxOptions } from "./docx.ts";
