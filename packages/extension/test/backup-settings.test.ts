import { describe, expect, it } from "vitest";
import { autoSaveDelay, BACKUP_DEFAULTS, backupSettings, mirrorSyncInterval } from "../src/highland-editor/backup-settings.ts";

describe("Settings → Backup", () => {
  it("falls back to the defaults for missing or unknown values", () => {
    expect(backupSettings(() => undefined)).toEqual(BACKUP_DEFAULTS);
    expect(BACKUP_DEFAULTS.autoSave).toBe("10");
    expect(backupSettings((k) => ({ autoSave: "7", writingHistory: "yes", saveOnExport: false, mirrorSync: "30" })[k])).toEqual({ ...BACKUP_DEFAULTS, saveOnExport: false, mirrorSync: "30" });
  });

  it("saves a second after typing stops, or every so many minutes", () => {
    expect(autoSaveDelay("off")).toBeNull();
    expect(autoSaveDelay("typing")).toBe(1000);
    expect(autoSaveDelay("10")).toBe(10 * 60_000);
  });

  it("syncs with the mirror on a timer only for the timed choices", () => {
    expect(mirrorSyncInterval("save")).toBeNull();
    expect(mirrorSyncInterval("manual")).toBeNull();
    expect(mirrorSyncInterval("10")).toBe(10 * 60_000);
  });
});
