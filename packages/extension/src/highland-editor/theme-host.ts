import * as vscode from "vscode";
import { ask } from "../ask.ts";
import { activeView } from "../surface.ts";
import { postTo, type FromPage, type ToPage } from "./messages.ts";
import { colorTheme, colorThemeLabel, CUSTOM_WINDOW_THEMES, customId, HIGHLAND_THEMES, navigatorColors, pageColors, themeFor, type CustomTheme, type HighlandTheme } from "./themes.ts";

/**
 * The extension's side of themes: the one in use (highwater.theme), your own themes
 * (highwater.customThemes), the theme menu's tries and the window's colours (highwater.themeWindow).
 */
const config = () => vscode.workspace.getConfiguration("highwater");
const OWN_THEME = "highwater.ownColorTheme";

export function customThemes(): CustomTheme[] {
  return config().get<CustomTheme[]>("customThemes", []);
}

export function currentThemeId(): string {
  return config().get<string>("theme", "vscode");
}

/** The page's colours for the theme in use, or null for VS Code's own. */
export function themeVars(): Record<string, string> | null {
  const theme = themeFor(currentThemeId(), customThemes());
  return theme ? { ...pageColors(theme), ...navigatorColors(theme) } : null;
}

export function themesMessage(): Extract<ToPage, { type: "themes" }> {
  const theme = themeFor(currentThemeId(), customThemes());
  const dark = config().get<boolean>("darkPages", false);
  return {
    type: "themes",
    current: currentThemeId(),
    customs: customThemes(),
    darkPagesSetting: dark,
    // Highland 2's dark pages: the page in Sidebar Background, the print in Sidebar Text (measured from EJ's screenshot).
    darkPages: dark && theme?.mode === "dark" ? { background: theme.sidebarBackground, text: theme.sidebarText } : null,
  };
}

/** VS Code's colour theme now. */
function windowTheme(): string | undefined {
  return vscode.workspace.getConfiguration("workbench").get<string>("colorTheme");
}

async function setWindowTheme(label: string | undefined): Promise<void> {
  if (label && label !== windowTheme()) await vscode.workspace.getConfiguration("workbench").update("colorTheme", label, vscode.ConfigurationTarget.Global);
}

/** The VS Code colour theme a custom theme is shown in: Highwater Custom Light or Dark. */
const customWindowLabel = (t: HighlandTheme) => colorThemeLabel(CUSTOM_WINDOW_THEMES[t.mode === "dark" ? "custom-dark" : "custom-light"]);

/**
 * A custom theme's colours for the window: VS Code's colour themes are fixed files, so its colours
 * go into workbench.colorCustomizations (and the text editor's into
 * editor.semanticTokenColorCustomizations), scoped to Highwater Custom Light or Dark.
 */
async function setCustomWindow(t: HighlandTheme): Promise<string> {
  const label = customWindowLabel(t);
  const theme = colorTheme(t) as { colors: Record<string, string>; semanticTokenColors: Record<string, unknown> };
  const scoped = async (section: string, key: string, value: unknown) => {
    const c = vscode.workspace.getConfiguration(section);
    const own = { ...((c.inspect<Record<string, unknown>>(key)?.globalValue as Record<string, unknown> | undefined) ?? {}) };
    if (JSON.stringify(own[`[${label}]`]) === JSON.stringify(value)) return;
    own[`[${label}]`] = value;
    await c.update(key, own, vscode.ConfigurationTarget.Global);
  };
  await scoped("workbench", "colorCustomizations", theme.colors);
  await scoped("editor", "semanticTokenColorCustomizations", { enabled: true, rules: theme.semanticTokenColors });
  return label;
}

/**
 * Uses a theme for the page and the sidebar and, with highwater.themeWindow on, for the whole
 * window. The writer's own colour theme is remembered the first time it is replaced, and put back
 * for VS Code's colours.
 */
async function useTheme(context: vscode.ExtensionContext, id: string): Promise<void> {
  if (currentThemeId() !== id) await config().update("theme", id, vscode.ConfigurationTarget.Global);
  if (!config().get<boolean>("themeWindow", true)) return;
  const ours = new Set([...Object.values(HIGHLAND_THEMES), ...Object.values(CUSTOM_WINDOW_THEMES)].map(colorThemeLabel));
  const current = windowTheme();
  if (current && !ours.has(current)) await context.globalState.update(OWN_THEME, current);
  const theme = themeFor(id, customThemes());
  if (theme && id.startsWith("custom:")) await setWindowTheme(await setCustomWindow(theme));
  else if (theme) await setWindowTheme(colorThemeLabel(theme));
  else if (current && ours.has(current)) await setWindowTheme(context.globalState.get<string>(OWN_THEME) ?? (vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? "Default Light Modern" : "Default Dark Modern"));
}

/** Tries in the theme menu (or the Command Palette's list), one at a time, and the theme there was before. */
let applying: Promise<void> = Promise.resolve();
let before: { theme: string; window: string | undefined } | null = null;
const queue = (f: () => Promise<void>) => (applying = applying.then(f, f));

function startTrying(): void {
  before = { theme: currentThemeId(), window: windowTheme() };
}

function stopTrying(context: vscode.ExtensionContext, keep: boolean): void {
  const was = before;
  before = null;
  if (keep || !was) return;
  queue(async () => {
    await useTheme(context, was.theme);
    if (config().get<boolean>("themeWindow", true)) await setWindowTheme(was.window);
  });
}

/** The theme menu's and theme window's messages; false for any other. */
export function handleThemeMessage(context: vscode.ExtensionContext, msg: FromPage): boolean {
  if (msg.type === "themePaneOpen") startTrying();
  else if (msg.type === "themePreview") queue(() => useTheme(context, msg.id));
  else if (msg.type === "themePaneClose") stopTrying(context, msg.keep);
  else if (msg.type === "customThemesSave") void config().update("customThemes", msg.themes, vscode.ConfigurationTarget.Global);
  else if (msg.type === "customThemeDelete") void deleteTheme(context, msg.id);
  else if (msg.type === "darkPagesSet") void config().update("darkPages", msg.on, vscode.ConfigurationTarget.Global);
  else if (msg.type === "copyText") void vscode.env.clipboard.writeText(msg.text).then(() => vscode.window.setStatusBarMessage(msg.note, 3000));
  else return false;
  return true;
}

async function deleteTheme(context: vscode.ExtensionContext, id: string): Promise<void> {
  const theme = customThemes().find((t) => t.id === id);
  if (!theme) return;
  const ok = await ask("warning", `Delete the theme “${theme.name || "Custom Theme"}”?`, { modal: true, detail: "Copy its theme link first if you might want it back." }, "Delete");
  if (ok !== "Delete") return;
  if (currentThemeId() === customId(theme)) await queue(() => useTheme(context, "vscode"));
  await config().update("customThemes", customThemes().filter((t) => t.id !== id), vscode.ConfigurationTarget.Global);
}

export function registerThemes(context: vscode.ExtensionContext): void {
  // A custom theme in use, edited in the theme window: the window's colours follow.
  let reapply: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("highwater.customThemes")) return;
      clearTimeout(reapply);
      reapply = setTimeout(() => {
        const id = currentThemeId();
        const theme = themeFor(id, customThemes());
        if (id.startsWith("custom:") && theme && config().get<boolean>("themeWindow", true)) queue(async () => void (await setCustomWindow(theme)));
      }, 400);
    }),
    // Choose Theme…: the theme menu in the Highwater Editor; with none in front, VS Code's list.
    vscode.commands.registerCommand("highwater.chooseTheme", async () => {
      const view = activeView();
      if (view) return postTo(view.panel, { type: "showThemePane" });
      const items = [
        { label: "Match VS Code", description: "your VS Code colour theme", id: "vscode" },
        ...Object.entries(HIGHLAND_THEMES).map(([id, t]) => ({ label: t.name, description: t.mode, id })),
        ...customThemes().map((t) => ({ label: t.name || "Custom Theme", description: `${t.mode}, your own`, id: customId(t) })),
      ];
      const quick = vscode.window.createQuickPick<(typeof items)[number]>();
      quick.title = "Theme for the Highwater Editor";
      quick.items = items;
      quick.activeItems = items.filter((i) => i.id === currentThemeId());
      let chosen = false;
      startTrying();
      quick.onDidChangeActive((active) => {
        const id = active[0]?.id;
        if (id) queue(() => useTheme(context, id));
      });
      quick.onDidAccept(() => {
        chosen = true;
        quick.hide();
      });
      quick.onDidHide(() => {
        stopTrying(context, chosen);
        quick.dispose();
      });
      quick.show();
    }),
  );
}
