/**
 * Highland 2's Document Template window: each template's group, description and Template Options
 * (EJ's screenshots, 2026-11-12). No VS Code imports: the Highland-Style Editor's page uses it too.
 */
export interface TemplateOption {
  /** The setting's last part: "headers", "body" or a checkbox's key. */
  key: string;
  label: string;
  kind: "font" | "check";
  /** Fonts to choose from (the first is not necessarily the default). */
  choices?: string[];
  default: string | boolean;
}

export interface TemplateInfo {
  name: string;
  group: "Scripts" | "Literary" | "Professional" | "Academic" | "Unformatted";
  description: string;
  options: TemplateOption[];
}

const SCRIPT_FONTS = ["Courier Prime", "Courier", "New York Medium", "Times New Roman"];
const body = (choices: string[], def: string): TemplateOption => ({ key: "body", label: "Body", kind: "font", choices, default: def });
const headers = (choices: string[], def: string): TemplateOption => ({ key: "headers", label: "Headers", kind: "font", choices, default: def });
const NOVEL_FONTS = ["Amiri", "TeX Gyre Schola", "Baskerville", "Cormorant Garamond", "Times New Roman"];

export const TEMPLATE_INFO: TemplateInfo[] = [
  { name: "Screenplay", group: "Scripts", description: "The industry standard for feature films and teleplays.", options: [body(["Courier Prime", "Courier", "Highland Sans"], "Courier Prime")] },
  {
    name: "Multi-Cam",
    group: "Scripts",
    description: "The industry standard for multi-cam sitcoms, with dialogue and scene description automatically double-spaced.",
    options: [body(["Courier Prime", "Courier", "Highland Sans"], "Courier Prime"), { key: "uppercaseAction", label: "Uppercase action", kind: "check", default: true }],
  },
  { name: "Stage Play", group: "Scripts", description: "A common format for stage plays, with a wide left margin for Stage Direction and underlined Scene Headers. Lyrics are uppercase, non-italics.", options: [body(SCRIPT_FONTS, "Courier Prime")] },
  {
    name: "Graphic Novel",
    group: "Scripts",
    description: "A common format for graphic novel scripts.\n\nMany writers use printed headings (#) to indicate page numbers, and forced scene headers (.PANEL ONE, .PANEL TWO) for individual panels.",
    options: [body(SCRIPT_FONTS, "Courier Prime")],
  },
  {
    name: "Manuscript",
    group: "Literary",
    description: "The industry standard for book submissions.\n\nThis format automatically double-spaces. When writing, simply leave a blank line between paragraphs. Highwater Too will make the adjustment when you print or preview.",
    options: [
      body(SCRIPT_FONTS, "Courier Prime"),
      { key: "indentLeading", label: "Indent leading paragraphs", kind: "check", default: false },
      { key: "spaceBeforeSections", label: "Add space before section headers", kind: "check", default: true },
    ],
  },
  { name: "Novel", group: "Literary", description: "A beautiful layout for fiction inspired by author Michael Chabon.", options: [headers(NOVEL_FONTS, "Amiri"), body(NOVEL_FONTS, "Amiri")] },
  { name: "Treatment", group: "Literary", description: "A popular format for film and television pitches, with bold headings.", options: [body(["Courier Prime", "Courier", "Highland Sans"], "Highland Sans")] },
  { name: "Modern Standard", group: "Professional", description: "A clean, contemporary format useful for a wide range of documents.", options: [headers(["Avenir Next", "Spectral"], "Avenir Next"), body(["Avenir Next", "Spectral"], "Avenir Next")] },
  {
    name: "Article",
    group: "Professional",
    description: "With strong type contrast and large blockquotes, this format is ideal for web-style articles.",
    options: [headers(["Lato", "Merriweather", "Avenir Next Condensed"], "Lato"), body(["Georgia", "Merriweather", "Lato"], "Georgia")],
  },
  { name: "Bulletin", group: "Professional", description: "Featuring very large headings for signs and notices.", options: [body(["SF Pro Display", "New York Medium"], "SF Pro Display")] },
  { name: "Speech", group: "Professional", description: "Designed for public speaking.", options: [headers(["New York Medium", "SF Pro Display"], "New York Medium"), body(["New York Medium", "SF Pro Display"], "New York Medium")] },
  {
    name: "MLA Report",
    group: "Academic",
    description: "The common format for most college-level writing.\n\nThis format automatically indents and double-spaces. When writing, simply leave a blank line between paragraphs. Highwater Too will make the adjustment when you print or preview.",
    options: [],
  },
  { name: "Wiki", group: "Academic", description: "A structured layout for reference material and tutorials.", options: [headers(["Georgia", "SF Pro Display"], "Georgia"), body(["Georgia", "SF Pro Display"], "Georgia")] },
  { name: "Plain Text", group: "Unformatted", description: "Completely unformatted, so all special markup (such as ** and #) will remain in the printed document.", options: [] },
];

/** "Multi-Cam" → "multiCam" (the settings' middle part). */
export function templateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c: string) => c.toUpperCase());
}
