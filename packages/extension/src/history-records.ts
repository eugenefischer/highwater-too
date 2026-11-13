import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import type { CommitInfo, DocumentFiles, History } from "@highwater/history";
import type { PlainExtras } from "./extras.ts";
import { ID_NOTE, idNote, noteId } from "./extras-folder.ts";
import type { BundleStore } from "./store.ts";
import { withoutSavedText } from "./to-bundle.ts";
import { INFO_KEY } from "./history-location.ts";

/** One entry of a .highland file as an editor holds it (not as on disk). */
export interface Instead {
  entry: string;
  text: string;
}

/** What the writing history records for a document, read from its file (and its extras). */
export function historyRecords(deps: { store: BundleStore; extras: PlainExtras; history: () => History }) {
  const { store, extras, history } = deps;
  /**
   * Reads what the history records for a document, and its stored ID. `instead`: one entry's text
   * as it is in the editor rather than on disk (unsaved changes being set aside).
   */
  async function snapshot(key: string, instead?: Instead): Promise<{ id: string | null; files: DocumentFiles }> {
    if (key.toLowerCase().endsWith(".highland")) {
      const b = await store.snapshot(key);
      const info = b.info[INFO_KEY] as { documentId?: unknown } | undefined;
      const id = typeof info?.documentId === "string" ? info.documentId : null;
      // Everything else in the file too (settings, assets, …): the commit is the file unpacked.
      const others = b.paths
        .filter((p) => p !== b.textPath && p !== "scratchpad.txt" && !/^bin\/\d+\.txt$/.test(p) && !p.endsWith("/"))
        .map((p) => ({ path: p, data: p === "info.json" ? withoutSavedText(b.get(p)!) : b.get(p)! }));
      const files: DocumentFiles = { scriptName: b.textPath.split("/").pop()!, script: b.text, bin: [...b.binItems], ...(b.scratchpad !== undefined ? { scratchpad: b.scratchpad } : {}), others };
      if (instead) {
        // (The store's bundle is shared and read-only: the change goes into this copy of its parts.)
        const bin = /^bin\/(\d+)\.txt$/.exec(instead.entry);
        if (instead.entry === "") files.script = instead.text;
        else if (instead.entry === "scratchpad.txt") files.scratchpad = instead.text;
        else if (bin) files.bin![Number(bin[1])] = instead.text;
      }
      return { id, files };
    }
    const ext = extname(key).toLowerCase();
    const scriptName = ext === ".fountain" || ext === ".spmd" ? "text.fountain" : ext === ".txt" ? "text.txt" : "text.md";
    const script = await readFile(key, "utf8");
    // Its Bin, Scratchpad, settings and images, kept outside the file.
    return { id: noteId(script), files: { scriptName, script, ...(await extras.historyFiles(key)) } };
  }

  async function resolve(key: string, instead?: Instead) {
    const { id, files } = await snapshot(key, instead);
    const resolved = await history().resolve({ id, path: key, text: files.script });
    // Highland drops keys it does not know when it saves; put the ID back (or the new one, for a
    // copy kept as a separate work). A copy is not written to until the writer decides.
    if (key.toLowerCase().endsWith(".highland") && resolved.id !== id && !resolved.copyOf) {
      await store.update(key, (b) => {
        b.setInfo({ ...b.info, [INFO_KEY]: { ...((b.info[INFO_KEY] as object | undefined) ?? {}), documentId: resolved.id } });
        return ["info.json"];
      });
    }
    // A plain file's ID note naming another work (a copy kept separate) names its own work now.
    if (!key.toLowerCase().endsWith(".highland") && id && resolved.id !== id && !resolved.copyOf) {
      const text = await readFile(key, "utf8");
      const now = text.replace(ID_NOTE, idNote(resolved.id));
      if (now !== text) {
        await writeFile(key, now);
        files.script = files.script.replace(ID_NOTE, idNote(resolved.id));
      }
    }
    return { ...resolved, files };
  }

  /** Looks a document's history up without creating anything (viewing must not write files). */
  async function lookup(key: string) {
    const { id, files } = await snapshot(key);
    return history().find({ id, path: key, text: files.script });
  }

  /** For showing the history (the panels, the status bar): as it is now, not after a pull in progress. */
  async function peek(key: string) {
    const { id, files } = await snapshot(key);
    return history().find({ id, path: key, text: files.script }, { wait: false });
  }

  async function latest(key: string): Promise<CommitInfo | undefined> {
    try {
      const found = await peek(key);
      return found ? (await history().log(found.id, 1))[0] : undefined;
    } catch {
      return undefined;
    }
  }

  return { snapshot, resolve, lookup, peek, latest };
}

export type HistoryRecords = ReturnType<typeof historyRecords>;
