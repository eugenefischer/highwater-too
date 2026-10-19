/**
 * @highwater/pdf: PDF layout and rendering for Highland's templates (milestones M4, M5).
 * Our own layout engine on PDFKit, fed by @highwater/parser and Highland's measured layouts;
 * ideas for dual dialogue and (MORE)/(CONT'D) follow Better Fountain. Must not import "vscode".
 */
export const PACKAGE_NAME = "@highwater/pdf";
export * from "./types.ts";
export { GRAPHIC_NOVEL, MULTI_CAM, SCREENPLAY, SCRIPT_TEMPLATES, STAGE_PLAY, layoutScreenplay, type ScreenplayOptions, type ScriptTemplate } from "./screenplay.ts";
export { defaultFontDir, renderPdf, type RenderOptions } from "./render.ts";
export { plain, toRuns, wrapRuns, type InlineContext } from "./text.ts";
export { MANUSCRIPT, imageSize, layoutManuscript, manuscriptHeadingPages, type ManuscriptOptions } from "./manuscript.ts";
export { PLAIN_TEXT, layoutPlainText } from "./plain.ts";
export { manuscriptDocx, DOCX_FONTS, type DocxFont, type DocxOptions } from "./docx.ts";
export { Measurer, findFamily, resolveFonts, systemFontDirs, type FontFace, type FontFaces, type ResolvedFonts } from "./fonts.ts";
export { layoutProse, wrapMeasured, type ProseLayout, type ProseOptions } from "./prose.ts";
export { ARTICLE, BULLETIN, MLA_REPORT, MODERN_STANDARD, NOVEL, PROSE_TEMPLATES, SPEECH, TREATMENT, WIKI, type ProseTemplate } from "./prose-templates.ts";
