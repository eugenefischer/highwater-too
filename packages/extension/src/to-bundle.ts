import { createDocument, HighlandBundle, type DocumentMode } from "@highwater/bundle";
import type { DocumentFiles } from "@highwater/history";
import { relinkAssets, withoutIdNote, type ExtrasFiles, type ExtrasSettings } from "./extras-folder.ts";

/**
 * Converting a work between a .highland file and a plain file. Both directions keep what the
 * history records the same — the text file, Bin, Scratchpad, images under assets/ and the rest
 * of the .highland file — so a conversion's commit shows only what really changed (a plain file's
 * settings.json). No VS Code dependency, so it is unit-tested.
 */

/** Our key in info.json: { documentId } ties a .highland file to its branch in the history. */
const INFO_KEY = "highwaterToo";

/**
 * A .highland file from a save or a plain file: the whole file as saved (from 0.1.3, or a plain
 * file converted from one), else a new one; with the text, Bin, Scratchpad, images and template.
 * Carries the document ID.
 */
export function toBundle(files: DocumentFiles, id: string): HighlandBundle {
  const mode: DocumentMode = files.scriptName.endsWith(".fountain") ? "fountain" : files.scriptName.endsWith(".txt") ? "plain" : "markdown";
  const settings = files.settings ?? {};
  const chosen = typeof settings.templateName === "string" ? settings.templateName : null;
  // A plain file's images were in a folder beside it; inside, they are in assets/.
  let text = withoutIdNote(files.script);
  if (typeof settings.assetsFolder === "string") text = relinkAssets(text, settings.assetsFolder, "assets");
  let b: HighlandBundle;
  if (files.others?.some((o) => o.path === "info.json")) b = HighlandBundle.fromEntries("Untitled.textbundle", [...files.others.map((o): [string, Uint8Array] => [o.path, o.data]), [files.scriptName, text]]);
  else {
    b = createDocument({ mode, template: chosen ?? (mode === "fountain" ? "Screenplay" : mode === "markdown" ? "Manuscript" : "Plain Text"), text });
    for (const o of files.others ?? []) if (o.path.startsWith("assets/")) b.set(o.path, o.data);
  }
  if (chosen && b.highlandSettings.templateName !== chosen) b.setHighlandSettings({ ...b.highlandSettings, templateName: chosen });
  if (files.bin?.length) b.setBinItems(files.bin);
  if (files.scratchpad !== undefined) b.scratchpad = files.scratchpad;
  const info = { ...b.info };
  const ours = { ...((info[INFO_KEY] as object | undefined) ?? {}) } as Record<string, unknown>;
  ours.documentId = id;
  b.setInfo({ ...info, [INFO_KEY]: ours });
  return b;
}

export interface PlainParts {
  /** The text, its image paths pointing at the assets folder. */
  text: string;
  /** Bin, Scratchpad, settings and the rest of the .highland file, for the extras folder. */
  extras: ExtrasFiles;
  /** Images for the folder beside the file, by name. */
  assets: { name: string; data: Uint8Array }[];
}

/** A .highland file taken apart as a plain file, its images to go in `assetsFolder` beside it. */
export function toPlain(b: HighlandBundle, assetsFolder: string): PlainParts {
  // Images directly in assets/ go beside the file; anything deeper stays with the rest.
  const image = (p: string) => /^assets\/[^/]+$/.test(p);
  const assets = b.paths.filter(image).map((p) => ({ name: p.slice("assets/".length), data: b.get(p)! }));
  const document = b.paths
    .filter((p) => p !== b.textPath && p !== "scratchpad.txt" && !/^bin\/\d+\.txt$/.test(p) && !image(p) && !p.endsWith("/"))
    .map((p) => ({ path: p, data: b.get(p)! }));
  const settings: ExtrasSettings = {};
  const template = b.highlandSettings.templateName;
  if (typeof template === "string" && template) settings.templateName = template;
  if (assets.length) settings.assetsFolder = assetsFolder;
  const extras: ExtrasFiles = { bin: b.binItems };
  if (b.scratchpad !== undefined) extras.scratchpad = b.scratchpad;
  if (Object.keys(settings).length) extras.settings = settings;
  if (document.length) extras.document = document;
  return { text: assets.length ? relinkAssets(b.text, "assets", assetsFolder) : b.text, extras, assets };
}
