import { HIGHLAND_KEY, HighlandBundle, MODE_UTI, TEXT_FILES, type DocumentMode } from "./bundle.ts";

/** The Navigator filter defaults Highland writes for a new document. */
export const DEFAULT_NAVIGATOR_FILTERS = {
  sceneHeaders: true,
  sectionHeaders: true,
  synopses: true,
  notes: true,
  images: true,
  links: true,
  referenceLinks: true,
  includedFiles: true,
  markers: false,
};

export interface NewDocumentOptions {
  mode: DocumentMode;
  /** Highland template name, e.g. "Screenplay" or "Manuscript". */
  template: string;
  text?: string;
}

/**
 * Creates a bundle with the same files Highland 2 writes for a new document:
 * info.json and the text file, plus characters.json, navigatorFilters.json and sprints.json
 * for every mode except plain text (Highland's fountain and markdown samples all have them).
 */
export function createDocument(options: NewDocumentOptions): HighlandBundle {
  const { mode, template, text = "" } = options;
  const info = {
    version: 2,
    transient: false,
    type: MODE_UTI[mode],
    [HIGHLAND_KEY]: {
      templateName: template,
      showSynopses: false,
      printParagraphNumbers: false,
      sidebarWidth: 0,
      currentTabIndex: -1,
      cursorPosition: 0,
    },
  };
  const entries: [string, string][] = [];
  if (mode !== "plain") {
    entries.push(["characters.json", "[]"], ["navigatorFilters.json", JSON.stringify(DEFAULT_NAVIGATOR_FILTERS)]);
  }
  entries.push([TEXT_FILES[mode], text], ["info.json", JSON.stringify(info)]);
  if (mode !== "plain") entries.push(["sprints.json", "[]"]);
  return HighlandBundle.fromEntries("Untitled.textbundle", entries);
}
