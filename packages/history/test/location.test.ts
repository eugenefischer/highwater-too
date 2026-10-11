import { describe, expect, it } from "vitest";
import { defaultHistoryFolder, syncedFolder } from "../src/index.ts";

describe("history location", () => {
  it("uses each system's application-data folder", () => {
    expect(defaultHistoryFolder("darwin", {}, "/Users/ej")).toBe("/Users/ej/Library/Application Support/Highwater Too/History");
    expect(defaultHistoryFolder("linux", {}, "/home/ej")).toBe("/home/ej/.local/share/highwater-too/history");
    expect(defaultHistoryFolder("linux", { XDG_DATA_HOME: "/data/ej" }, "/home/ej")).toBe("/data/ej/highwater-too/history");
    expect(defaultHistoryFolder("linux", { XDG_DATA_HOME: "relative" }, "/home/ej")).toBe("/home/ej/.local/share/highwater-too/history");
    expect(defaultHistoryFolder("win32", { LOCALAPPDATA: "C:\\Users\\ej\\AppData\\Local" }, "C:\\Users\\ej")).toMatch(/AppData[\\/]Local[\\/]Highwater Too[\\/]History$/);
  });

  it("recognises synced folders", () => {
    expect(syncedFolder("/Users/ej/SynologyDrive/History")).toBe("Synology Drive");
    expect(syncedFolder("/Users/ej/Library/Mobile Documents/com~apple~CloudDocs/History")).toBe("iCloud Drive");
    expect(syncedFolder("/Users/ej/Dropbox")).toBe("Dropbox");
    expect(syncedFolder("/Users/ej/Library/Application Support/Highwater Too/History")).toBeNull();
  });
});
