/** Where the writing history is kept, and how a file names the work it belongs to. */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { defaultHistoryFolder, History } from "@highwater/history";
import { readBundle } from "@highwater/bundle";
import * as vscode from "vscode";
import { noteId } from "./extras-folder.ts";

/** Our key in info.json: { documentId } ties a .highland file to its branch in the history. */
export const INFO_KEY = "highwaterToo";

/** The history folder: the writer's choice, else the system's application-data folder. */
export function historyRoot(): string {
  const chosen = vscode.workspace.getConfiguration("highwater").get<string>("historyFolder", "").trim();
  return chosen || defaultHistoryFolder(process.platform, process.env, homedir());
}

/** One History per folder, kept: a second one for the same folder would race the first. */
const histories = new Map<string, History>();

/** The writing history in the current history folder, or null when it is turned off. */
export function currentHistory(): History | null {
  if (!vscode.workspace.getConfiguration("highwater").get<boolean>("writingHistory", true)) return null;
  return historyAt(historyRoot());
}

export function historyAt(dir: string): History {
  let h = histories.get(dir);
  if (!h) histories.set(dir, (h = new History(dir, { stillHas })));
  return h;
}

/** Forgets the History objects for folders whose contents moved (Change Location…). */
export function forgetHistories(...dirs: string[]): void {
  for (const dir of dirs) histories.delete(dir);
}

/**
 * The work's file at `path` is still there and still the work's: it exists and names this ID or
 * none (Highland 2 drops the ID when it saves). Otherwise a file found elsewhere with the work's ID
 * or text is the work's file moved, not a copy.
 */
async function stillHas(path: string, id: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const named = await fileId(path).catch(() => null);
  return named === null || named === id;
}

/** The document ID a file names: in a .highland file's info.json, or a plain file's ID note. */
async function fileId(path: string): Promise<string | null> {
  if (path.toLowerCase().endsWith(".highland")) {
    const ours = (await readBundle(path)).bundle.info[INFO_KEY] as { documentId?: unknown } | undefined;
    return typeof ours?.documentId === "string" ? ours.documentId : null;
  }
  return noteId(await readFile(path, "utf8"));
}
