/**
 * Settings → Backup: Highland 2's Backup tab redone for the writing history (EJ, 2026-11-18;
 * claude/backup-settings-design.md in the project). Every save is recorded, so the backup
 * frequency is how often documents save themselves. Kept as VS Code settings `highwater.<key>`.
 */
export interface BackupSettings {
  /** How often documents save themselves (each save is recorded in the writing history). */
  autoSave: AutoSave;
  /** With "When I stop typing": how many seconds without a change before the document saves. */
  autoSavePause: number;
  /** Record saves in the writing history (every document). */
  writingHistory: boolean;
  /** Save a document with unsaved changes when it is exported as a PDF or Word file (Highland's "On Print or Preview"). */
  saveOnExport: boolean;
  /** When the writing history is synced with its mirror. */
  mirrorSync: MirrorSync;
  /** A new work takes its title from the title page's Title (at its first save). */
  titleFromTitlePage: boolean;
  /** Else, in a manuscript, from its first top-level heading; else the file's name. */
  titleFromHeading: boolean;
  /** Each .fountain and .md file's save adds a hidden line at its end naming its writing history. */
  linkPlainFiles: boolean;
}

/** The pause "When I stop typing" waits for, in whole seconds. */
export const AUTO_SAVE_PAUSE = { min: 1, max: 300 } as const;

/** off: only ⌘S; typing: a pause after you stop typing (`autoSavePause` seconds); a number: every that many minutes while there are unsaved changes. */
export const AUTO_SAVES = ["off", "typing", "3", "5", "10", "15", "30", "60"] as const;
export type AutoSave = (typeof AUTO_SAVES)[number];
export const AUTO_SAVE_LABELS: Record<AutoSave, string> = {
  off: "Only when I save (⌘S)",
  typing: "When I stop typing",
  "3": "Every 3 minutes",
  "5": "Every 5 minutes",
  "10": "Every 10 minutes",
  "15": "Every 15 minutes",
  "30": "Every 30 minutes",
  "60": "Every 60 minutes",
};

/** save: after every save (and every ten minutes for other computers' saves); a number: every that many minutes; manual: only Sync. */
export const MIRROR_SYNCS = ["save", "5", "10", "30", "60", "manual"] as const;
export type MirrorSync = (typeof MIRROR_SYNCS)[number];
export const MIRROR_SYNC_LABELS: Record<MirrorSync, string> = {
  save: "After every save",
  "5": "Every 5 minutes",
  "10": "Every 10 minutes",
  "30": "Every 30 minutes",
  "60": "Every 60 minutes",
  manual: "Only when I click Sync",
};

/** EJ: documents save themselves every ten minutes unless you choose otherwise (Highland's Backup Frequency default). */
export const BACKUP_DEFAULTS: BackupSettings = {
  autoSave: "10",
  autoSavePause: 1,
  writingHistory: true,
  saveOnExport: true,
  mirrorSync: "save",
  titleFromTitlePage: true,
  titleFromHeading: true,
  linkPlainFiles: false,
};

/** Stored values made sound: unknown or missing values fall back to the defaults. */
export function backupSettings(read: (key: keyof BackupSettings) => unknown): BackupSettings {
  const pick = <T extends string>(key: keyof BackupSettings, options: readonly T[], fallback: T): T => {
    const v = read(key);
    return options.includes(v as T) ? (v as T) : fallback;
  };
  const bool = (key: keyof BackupSettings, fallback: boolean) => {
    const v = read(key);
    return typeof v === "boolean" ? v : fallback;
  };
  const pause = read("autoSavePause");
  return {
    autoSave: pick("autoSave", AUTO_SAVES, BACKUP_DEFAULTS.autoSave),
    autoSavePause: typeof pause === "number" && Number.isFinite(pause) ? Math.min(AUTO_SAVE_PAUSE.max, Math.max(AUTO_SAVE_PAUSE.min, Math.round(pause))) : BACKUP_DEFAULTS.autoSavePause,
    writingHistory: bool("writingHistory", BACKUP_DEFAULTS.writingHistory),
    saveOnExport: bool("saveOnExport", BACKUP_DEFAULTS.saveOnExport),
    mirrorSync: pick("mirrorSync", MIRROR_SYNCS, BACKUP_DEFAULTS.mirrorSync),
    titleFromTitlePage: bool("titleFromTitlePage", BACKUP_DEFAULTS.titleFromTitlePage),
    titleFromHeading: bool("titleFromHeading", BACKUP_DEFAULTS.titleFromHeading),
    linkPlainFiles: bool("linkPlainFiles", BACKUP_DEFAULTS.linkPlainFiles),
  };
}

/** Milliseconds between automatic saves while a document has unsaved changes; for "typing", the pause after the last change. Null: off. */
export function autoSaveDelay(mode: AutoSave, pauseSeconds: number = BACKUP_DEFAULTS.autoSavePause): number | null {
  if (mode === "off") return null;
  if (mode === "typing") return pauseSeconds * 1000;
  return Number(mode) * 60_000;
}

/** Milliseconds between timed syncs with the mirror; null when it syncs after saves or only by hand. */
export function mirrorSyncInterval(mode: MirrorSync): number | null {
  return mode === "save" || mode === "manual" ? null : Number(mode) * 60_000;
}

/** What the Backup tab shows besides the settings: where the history is, and the mirror. */
export interface BackupInfo {
  folder: string;
  /** The label for revealing the folder ("Show in Finder" on a Mac). */
  reveal: string;
  mirror: { url: string; at: number | null; error: string | null; signIn: boolean; busy: boolean } | null;
}
