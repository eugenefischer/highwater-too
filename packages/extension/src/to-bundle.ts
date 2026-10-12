import { createDocument, HighlandBundle, type DocumentMode } from "@highwater/bundle";
import type { DocumentFiles } from "@highwater/history";
import { relinkAssets, withoutIdNote } from "./extras-folder.ts";

/** Our key in info.json: { documentId } ties a .highland file to its branch in the history. */
const INFO_KEY = "highwaterToo";

/**
 * A .highland file rebuilt from a save: the whole file as saved (from 0.1.3), or a new one with the
 * save's text, Bin, Scratchpad, images and template. Carries the document ID.
 */
export function toBundle(files: DocumentFiles, id: string): HighlandBundle {
  const mode: DocumentMode = files.scriptName.endsWith(".fountain") ? "fountain" : files.scriptName.endsWith(".txt") ? "plain" : "markdown";
  let b: HighlandBundle;
  if (files.others?.some((o) => o.path === "info.json")) b = HighlandBundle.fromEntries("Untitled.textbundle", [...files.others.map((o): [string, Uint8Array] => [o.path, o.data]), [files.scriptName, files.script]]);
  else {
    // A plain file's save: images were in a folder beside it, the template in its settings.
    const settings = files.settings ?? {};
    const chosen = typeof settings.templateName === "string" ? settings.templateName : null;
    const template = chosen ?? (mode === "fountain" ? "Screenplay" : mode === "markdown" ? "Manuscript" : "Plain Text");
    let text = withoutIdNote(files.script);
    if (typeof settings.assetsFolder === "string") text = relinkAssets(text, settings.assetsFolder, "assets");
    b = createDocument({ mode, template, text });
    for (const o of files.others ?? []) if (o.path.startsWith("assets/")) b.set(o.path, o.data);
  }
  if (files.bin?.length) b.setBinItems(files.bin);
  if (files.scratchpad !== undefined) b.scratchpad = files.scratchpad;
  const info = { ...b.info };
  const ours = { ...((info[INFO_KEY] as object | undefined) ?? {}) } as Record<string, unknown>;
  ours.documentId = id;
  b.setInfo({ ...info, [INFO_KEY]: ours });
  return b;
}

