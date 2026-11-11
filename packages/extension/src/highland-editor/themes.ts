/**
 * Highland 2's editor themes (its Default Themes folder): the colours of the page, text, scene
 * headings, notes and cursor, and of the sidebar. The Highland-Style Editor and the Navigator use
 * the one chosen in `highwater.theme`; "vscode" keeps VS Code's own colours. Pure, for tests.
 */
export interface HighlandTheme {
  name: string;
  mode: "light" | "dark";
  background: string;
  text: string;
  sidebarBackground: string;
  sidebarText: string;
  /** Selection, Find matches, the current Navigator item. */
  primary: string;
  /** Sections in the Navigator. */
  secondary: string;
  /** Markup and other quiet text: directives, omitted text, the title page, synopses. */
  inactive: string;
  sceneHeading: string;
  notes: string;
  cursor: string;
}

export const HIGHLAND_THEMES: Record<string, HighlandTheme> = {
  "classic": { name: "Classic", mode: "light", background: "#ffffff", text: "#2d333b", sidebarBackground: "#3f4752", sidebarText: "#c4cace", primary: "#b36795", secondary: "#2faad1", inactive: "#9bacba", sceneHeading: "#3f4752", notes: "#499c91", cursor: "#f85e66" },
  "clean": { name: "Clean", mode: "light", background: "#ffffff", text: "#2d333b", sidebarBackground: "#f3f3f3", sidebarText: "#4a4a4a", primary: "#2faad1", secondary: "#b36795", inactive: "#888888", sceneHeading: "#06455f", notes: "#499c91", cursor: "#f85e66" },
  "winter": { name: "Winter", mode: "light", background: "#f5f5f5", text: "#333333", sidebarBackground: "#e3e3e3", sidebarText: "#3a3a3a", primary: "#326878", secondary: "#5795a0", inactive: "#696969", sceneHeading: "#84697c", notes: "#5e4630", cursor: "#d36671" },
  "kermit": { name: "Kermit", mode: "light", background: "#ffffff", text: "#333333", sidebarBackground: "#eeeeee", sidebarText: "#4a4a4a", primary: "#148456", secondary: "#00ab6b", inactive: "#999999", sceneHeading: "#079e65", notes: "#00ab6b", cursor: "#0be370" },
  "solarized-light": { name: "Solarized Light", mode: "light", background: "#fdf6e3", text: "#657b83", sidebarBackground: "#ddd7d0", sidebarText: "#586e75", primary: "#268bd2", secondary: "#2aa198", inactive: "#839496", sceneHeading: "#6c71c4", notes: "#b58900", cursor: "#d33682" },
  "dark-mode": { name: "Dark Mode", mode: "dark", background: "#000000", text: "#aaaaaa", sidebarBackground: "#111111", sidebarText: "#888888", primary: "#b8c663", secondary: "#aa5b7f", inactive: "#848484", sceneHeading: "#74a2a5", notes: "#b8c663", cursor: "#c86e75" },
  "dracula": { name: "Dracula", mode: "dark", background: "#282a36", text: "#f8f8f2", sidebarBackground: "#202026", sidebarText: "#ccccca", primary: "#50fa7b", secondary: "#ffb86c", inactive: "#6272a4", sceneHeading: "#bd93f9", notes: "#ff79c6", cursor: "#f1fa8c" },
  "material": { name: "Material", mode: "dark", background: "#263238", text: "#eeffff", sidebarBackground: "#192226", sidebarText: "#657b83", primary: "#39adb5", secondary: "#91b859", inactive: "#65737e", sceneHeading: "#bb80b3", notes: "#ef5471", cursor: "#f07178" },
  "monokai": { name: "Monokai", mode: "dark", background: "#232323", text: "#f7f7f7", sidebarBackground: "#191919", sidebarText: "#999999", primary: "#f62d73", secondary: "#66d9ef", inactive: "#808080", sceneHeading: "#e6db74", notes: "#a6e22e", cursor: "#a6e22e" },
  "solarized-dark": { name: "Solarized Dark", mode: "dark", background: "#073642", text: "#839496", sidebarBackground: "#091f23", sidebarText: "#657b83", primary: "#d33682", secondary: "#2aa198", inactive: "#708284", sceneHeading: "#2aa198", notes: "#b58900", cursor: "#859900" },
  "transit": { name: "Transit", mode: "dark", background: "#1c0c19", text: "#c6bac1", sidebarBackground: "#140611", sidebarText: "#a7969e", primary: "#bc2e9e", secondary: "#ea3f3f", inactive: "#a7969e", sceneHeading: "#2faad1", notes: "#e7ea09", cursor: "#bedc3c" },
};

/** The chosen theme, or null for VS Code's colours (and for a name that isn't one of Highland's). */
export function themeFor(setting: string | undefined): HighlandTheme | null {
  return setting && setting !== "vscode" ? (HIGHLAND_THEMES[setting] ?? null) : null;
}

/** The page's colour variables for a theme (the Highland-Style Editor's CSS reads these). */
export function pageColors(t: HighlandTheme): Record<string, string> {
  return {
    "--hl-bg": t.background,
    "--hl-fg": t.text,
    "--hl-scene": t.sceneHeading,
    "--hl-note": t.notes,
    "--hl-muted": t.inactive,
    "--hl-caret": t.cursor,
    "--hl-selection": `color-mix(in srgb, ${t.primary} 30%, transparent)`,
    "--hl-match": `color-mix(in srgb, ${t.primary} 30%, transparent)`,
    "--hl-match-current": `color-mix(in srgb, ${t.primary} 60%, transparent)`,
    "--hl-panel-bg": t.sidebarBackground,
    "--hl-panel-fg": t.sidebarText,
    "--hl-input-bg": t.background,
    "--hl-border": `color-mix(in srgb, ${t.inactive} 50%, transparent)`,
    "--hl-accent": t.primary,
    "--hl-accent-fg": onColor(t.primary),
    "--hl-whitespace": `color-mix(in srgb, ${t.inactive} 60%, transparent)`,
  };
}

/** The Navigator's colour variables for a theme. */
export function navigatorColors(t: HighlandTheme): Record<string, string> {
  return {
    "--nav-bg": t.sidebarBackground,
    "--nav-fg": t.sidebarText,
    "--nav-section": t.secondary,
    "--nav-muted": t.inactive,
    "--nav-current": `color-mix(in srgb, ${t.primary} 28%, transparent)`,
    "--nav-hover": `color-mix(in srgb, ${t.sidebarText} 10%, transparent)`,
    "--nav-accent": t.primary,
    "--nav-input-bg": `color-mix(in srgb, ${t.sidebarText} 10%, ${t.sidebarBackground})`,
  };
}

/** Black or white, whichever reads better on a colour (for button text). */
export function onColor(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.4 ? "#000000" : "#ffffff";
}

// ---------------------------------------------------------------------------------------------
// The same themes for the whole VS Code window (contributed as colour themes, "Highwater Classic"
// and so on), so the panes, tabs, title and status bars match the page. Generated from the table
// above into themes/*.json by scripts/gen-themes.ts; a test keeps the files in step.

/** A colour with an alpha, as #rrggbbaa. */
function alpha(hex: string, a: number): string {
  return `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}

/** A mix of two colours (0: all `a`, 1: all `b`), as #rrggbb. */
function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = (c: number, s: number) => (c >> s) & 255;
  const out = [16, 8, 0].map((s) => Math.round(ch(ca, s) * (1 - t) + ch(cb, s) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The theme's id in themes/: highwater-<id>-color-theme.json. */
export function colorThemeFile(id: string): string {
  return `themes/highwater-${id}-color-theme.json`;
}

/** The label VS Code shows in its theme list. */
export function colorThemeLabel(t: HighlandTheme): string {
  return `Highwater ${t.name}`;
}

export function colorTheme(t: HighlandTheme): object {
  const onPrimary = onColor(t.primary);
  const sidebarEdge = mix(t.sidebarBackground, t.sidebarText, 0.12);
  const inputBg = t.mode === "dark" ? mix(t.sidebarBackground, t.sidebarText, 0.08) : mix(t.sidebarBackground, "#ffffff", 0.6);
  return {
    $schema: "vscode://schemas/color-theme",
    name: colorThemeLabel(t),
    type: t.mode,
    semanticHighlighting: true,
    colors: {
      foreground: t.sidebarText,
      descriptionForeground: t.inactive,
      focusBorder: t.primary,
      "textLink.foreground": t.primary,
      "textLink.activeForeground": t.primary,
      "progressBar.background": t.primary,
      "badge.background": t.primary,
      "badge.foreground": onPrimary,
      "button.background": t.primary,
      "button.foreground": onPrimary,
      "button.hoverBackground": mix(t.primary, t.mode === "dark" ? "#ffffff" : "#000000", 0.12),
      "input.background": inputBg,
      "input.foreground": t.sidebarText,
      "input.border": sidebarEdge,
      "input.placeholderForeground": t.inactive,
      "dropdown.background": inputBg,
      "dropdown.foreground": t.sidebarText,
      "dropdown.border": sidebarEdge,
      "scrollbarSlider.background": alpha(t.inactive, 0.25),
      "scrollbarSlider.hoverBackground": alpha(t.inactive, 0.4),
      "scrollbarSlider.activeBackground": alpha(t.inactive, 0.55),
      "widget.shadow": "#00000033",

      "editor.background": t.background,
      "editor.foreground": t.text,
      "editorCursor.foreground": t.cursor,
      "editor.selectionBackground": alpha(t.primary, 0.3),
      "editor.inactiveSelectionBackground": alpha(t.primary, 0.18),
      "editor.selectionHighlightBackground": alpha(t.primary, 0.15),
      "editor.findMatchBackground": alpha(t.primary, 0.6),
      "editor.findMatchHighlightBackground": alpha(t.primary, 0.3),
      "editor.lineHighlightBackground": alpha(t.text, 0.04),
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": alpha(t.inactive, 0.6),
      "editorLineNumber.activeForeground": t.inactive,
      "editorWhitespace.foreground": alpha(t.inactive, 0.6),
      "editorIndentGuide.background1": alpha(t.inactive, 0.15),
      "editorInlayHint.foreground": t.inactive,
      "editorInlayHint.background": "#00000000",
      "editorGutter.background": t.background,
      "editorWidget.background": t.sidebarBackground,
      "editorWidget.foreground": t.sidebarText,
      "editorWidget.border": sidebarEdge,
      "editorSuggestWidget.background": t.sidebarBackground,
      "editorSuggestWidget.foreground": t.sidebarText,
      "editorSuggestWidget.border": sidebarEdge,
      "editorSuggestWidget.selectedBackground": alpha(t.primary, 0.35),
      "editorSuggestWidget.highlightForeground": t.primary,
      "editorHoverWidget.background": t.sidebarBackground,
      "editorHoverWidget.foreground": t.sidebarText,
      "editorHoverWidget.border": sidebarEdge,

      "editorGroupHeader.tabsBackground": t.sidebarBackground,
      "editorGroupHeader.tabsBorder": t.sidebarBackground,
      "editorGroup.border": sidebarEdge,
      "tab.activeBackground": t.background,
      "tab.activeForeground": t.text,
      "tab.activeBorderTop": t.primary,
      "tab.inactiveBackground": t.sidebarBackground,
      "tab.inactiveForeground": alpha(t.sidebarText, 0.7),
      "tab.border": t.sidebarBackground,
      "breadcrumb.background": t.background,
      "breadcrumb.foreground": t.inactive,

      "sideBar.background": t.sidebarBackground,
      "sideBar.foreground": t.sidebarText,
      "sideBar.border": t.sidebarBackground,
      "sideBarTitle.foreground": t.sidebarText,
      "sideBarSectionHeader.background": t.sidebarBackground,
      "sideBarSectionHeader.foreground": t.sidebarText,
      "sideBarSectionHeader.border": sidebarEdge,
      "list.activeSelectionBackground": alpha(t.primary, 0.4),
      "list.activeSelectionForeground": t.sidebarText,
      "list.inactiveSelectionBackground": alpha(t.primary, 0.25),
      "list.inactiveSelectionForeground": t.sidebarText,
      "list.hoverBackground": alpha(t.sidebarText, 0.08),
      "list.hoverForeground": t.sidebarText,
      "list.focusOutline": t.primary,
      "list.highlightForeground": t.primary,
      "list.dropBackground": alpha(t.primary, 0.25),
      "tree.indentGuidesStroke": alpha(t.inactive, 0.3),

      "activityBar.background": t.sidebarBackground,
      "activityBar.foreground": t.sidebarText,
      "activityBar.inactiveForeground": alpha(t.sidebarText, 0.5),
      "activityBar.activeBorder": t.primary,
      "activityBar.border": t.sidebarBackground,
      "activityBarBadge.background": t.primary,
      "activityBarBadge.foreground": onPrimary,

      "titleBar.activeBackground": t.sidebarBackground,
      "titleBar.activeForeground": t.sidebarText,
      "titleBar.inactiveBackground": t.sidebarBackground,
      "titleBar.inactiveForeground": t.inactive,
      "titleBar.border": t.sidebarBackground,
      "statusBar.background": t.sidebarBackground,
      "statusBar.foreground": t.sidebarText,
      "statusBar.border": t.sidebarBackground,
      "statusBar.noFolderBackground": t.sidebarBackground,
      "statusBar.debuggingBackground": t.primary,
      "statusBar.debuggingForeground": onPrimary,
      "statusBarItem.remoteBackground": t.primary,
      "statusBarItem.remoteForeground": onPrimary,
      "statusBarItem.hoverBackground": alpha(t.sidebarText, 0.12),

      "panel.background": t.background,
      "panel.border": sidebarEdge,
      "panelTitle.activeForeground": t.text,
      "panelTitle.activeBorder": t.primary,
      "panelTitle.inactiveForeground": t.inactive,
      "terminal.background": t.background,
      "terminal.foreground": t.text,

      "quickInput.background": t.sidebarBackground,
      "quickInput.foreground": t.sidebarText,
      "quickInputList.focusBackground": alpha(t.primary, 0.4),
      "quickInputList.focusForeground": t.sidebarText,
      "pickerGroup.foreground": t.primary,
      "menu.background": t.sidebarBackground,
      "menu.foreground": t.sidebarText,
      "menu.selectionBackground": alpha(t.primary, 0.4),
      "menu.selectionForeground": t.sidebarText,
      "menu.border": sidebarEdge,
      "notifications.background": t.sidebarBackground,
      "notifications.foreground": t.sidebarText,
      "toolbar.hoverBackground": alpha(t.sidebarText, 0.12),
    },
    // The text editor's Fountain and Markdown, as the Highland-Style Editor shows them.
    semanticTokenColors: {
      sceneHeading: { foreground: t.sceneHeading, bold: true },
      sceneNumber: t.sceneHeading,
      section: t.inactive,
      synopsis: t.inactive,
      heading: { foreground: t.text, bold: true },
      note: { foreground: t.notes, italic: true },
      directive: t.inactive,
      markup: t.inactive,
      revisionTag: t.inactive,
      boneyard: t.inactive,
      titleKey: t.inactive,
      titleValue: t.text,
      character: t.text,
      parenthetical: t.text,
      transition: t.text,
      centered: t.text,
      lyric: { foreground: t.text, italic: true },
      pageBreak: t.inactive,
      quote: { foreground: t.text, italic: true },
      listMarker: t.inactive,
      term: { foreground: t.text, bold: true },
      tableHeader: { foreground: t.text, bold: true },
      linkDefinition: t.inactive,
      link: { foreground: t.primary, underline: true },
      bold: { bold: true },
      italic: { italic: true },
      boldItalic: { bold: true, italic: true },
      underline: { underline: true },
      strike: { strikethrough: true },
      highlight: { foreground: t.text },
    },
    tokenColors: [
      { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: t.inactive, fontStyle: "italic" } },
      { scope: ["markup.heading", "entity.name.section"], settings: { foreground: t.sceneHeading, fontStyle: "bold" } },
      { scope: ["string"], settings: { foreground: t.secondary } },
      { scope: ["keyword", "storage"], settings: { foreground: t.primary } },
      { scope: ["constant", "entity.name.function", "support.function"], settings: { foreground: t.secondary } },
      { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      { scope: ["markup.underline.link"], settings: { foreground: t.primary } },
    ],
  };
}
