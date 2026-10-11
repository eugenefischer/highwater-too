import { join, sep } from "node:path";

/**
 * Where the writing history lives unless the writer picks a folder: each system's place for an
 * application's own data, kept out of synced folders and outside VS Code's extension storage
 * (which is deleted with the extension).
 *   macOS:   ~/Library/Application Support/Highwater Too/History
 *   Linux:   $XDG_DATA_HOME/highwater-too/history (default ~/.local/share/highwater-too/history)
 *   Windows: %LOCALAPPDATA%\Highwater Too\History (not roaming: profiles that roam would copy every repo around)
 */
export function defaultHistoryFolder(platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", "Highwater Too", "History");
  if (platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Highwater Too", "History");
  const data = env.XDG_DATA_HOME && env.XDG_DATA_HOME.startsWith("/") ? env.XDG_DATA_HOME : join(home, ".local", "share");
  return join(data, "highwater-too", "history");
}

/** Folders kept in step by a sync service, where git repositories can be damaged by syncing. */
const SYNCED: [RegExp, string][] = [
  [/[\\/]Dropbox[\\/]/i, "Dropbox"],
  [/[\\/]SynologyDrive[\\/]/i, "Synology Drive"],
  [/[\\/]OneDrive[^\\/]*[\\/]/i, "OneDrive"],
  [/[\\/]Google ?Drive[\\/]/i, "Google Drive"],
  [/[\\/]Library[\\/]Mobile Documents[\\/]/i, "iCloud Drive"],
  [/[\\/]iCloud ?Drive[\\/]/i, "iCloud Drive"],
  [/[\\/]Library[\\/]CloudStorage[\\/]/i, "a cloud storage service"],
  [/[\\/]Box( Sync)?[\\/]/i, "Box"],
  [/[\\/]pCloud ?Drive[\\/]/i, "pCloud"],
  [/[\\/]Nextcloud[\\/]/i, "Nextcloud"],
  [/[\\/]ownCloud[\\/]/i, "ownCloud"],
];

/** The sync service a folder appears to be in, if any (judged by its path). */
export function syncedFolder(path: string): string | null {
  const p = /[\\/]$/.test(path) ? path : path + sep;
  return SYNCED.find(([re]) => re.test(p))?.[1] ?? null;
}
