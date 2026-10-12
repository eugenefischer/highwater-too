import { createDocument, HIGHLAND_KEY, HighlandBundle, type DocumentMode } from "@highwater/bundle";
import type { DocumentFiles } from "@highwater/history";
import { detectAssetsFolder, relinkAssets, withoutIdNote, type ExtrasFiles } from "./extras-folder.ts";

/**
 * Converting a work between a .highland file and a plain file. What the history records is the
 * same in both forms — the text file, Bin, Scratchpad, info.json and the rest at the same paths,
 * images under assets/ — so a conversion leaves every file as it was; only a plain file's image
 * paths in the text differ, pointing at the folder beside it. No VS Code dependency, so it is
 * unit-tested.
 */

/** Our key in info.json: { documentId } ties a .highland file to its branch in the history. */
const INFO_KEY = "highwaterToo";

const isImage = (path: string) => /^assets\/[^/]+$/.test(path);

/**
 * A .highland file from a save or a plain file: the whole file as recorded when it has a complete
 * info.json (it was a .highland file once), else a new one with the recorded parts laid over it.
 * Carries the document ID.
 */
export function toBundle(files: DocumentFiles, id: string): HighlandBundle {
  const mode: DocumentMode = files.scriptName.endsWith(".fountain") ? "fountain" : files.scriptName.endsWith(".txt") ? "plain" : "markdown";
  const others = files.others ?? [];
  const infoEntry = others.find((o) => o.path === "info.json");
  const info = infoEntry ? parseJson(infoEntry.data) : null;
  // A plain file's images were in a folder beside it; inside, they are in assets/.
  let text = withoutIdNote(files.script);
  const folder = detectAssetsFolder(text, others.filter((o) => isImage(o.path)).map((o) => o.path.slice("assets/".length)));
  if (folder && folder !== "assets") text = relinkAssets(text, folder, "assets");
  let b: HighlandBundle;
  if (info && "type" in info) b = HighlandBundle.fromEntries("Untitled.textbundle", [...others.map((o): [string, Uint8Array] => [o.path, o.data]), [files.scriptName, text]]);
  else {
    const template = (info?.[HIGHLAND_KEY] as { templateName?: unknown } | undefined)?.templateName;
    b = createDocument({ mode, template: typeof template === "string" && template ? template : mode === "fountain" ? "Screenplay" : mode === "markdown" ? "Manuscript" : "Plain Text", text });
    for (const o of others) if (o.path !== "info.json") b.set(o.path, o.data);
    if (info) {
      // A plain file's own info.json holds only its settings: lay them over the new file's.
      const created = b.info;
      const merged: Record<string, unknown> = { ...created, ...info };
      for (const key of [HIGHLAND_KEY, INFO_KEY]) {
        const a = created[key] as Record<string, unknown> | undefined;
        const c = info[key] as Record<string, unknown> | undefined;
        if (a || c) merged[key] = { ...(a ?? {}), ...(c ?? {}) };
      }
      b.setInfo(merged);
    }
  }
  if (files.bin?.length) b.setBinItems(files.bin);
  if (files.scratchpad !== undefined) b.scratchpad = files.scratchpad;
  const ours = { ...((b.info[INFO_KEY] as object | undefined) ?? {}) } as Record<string, unknown>;
  if (ours.documentId !== id) {
    ours.documentId = id;
    b.setInfo({ ...b.info, [INFO_KEY]: ours });
  }
  return b;
}

export interface PlainParts {
  /** The text, its image paths pointing at the assets folder. */
  text: string;
  /** Bin, Scratchpad and the rest of the .highland file, for the extras folder. */
  extras: ExtrasFiles;
  /** Images for the folder beside the file, by name. */
  assets: { name: string; data: Uint8Array }[];
}

/** A .highland file taken apart as a plain file, its images to go in `assetsFolder` beside it. */
export function toPlain(b: HighlandBundle, assetsFolder: string): PlainParts {
  // Images directly in assets/ go beside the file; anything deeper stays with the rest.
  const assets = b.paths.filter(isImage).map((p) => ({ name: p.slice("assets/".length), data: b.get(p)! }));
  const document = b.paths
    .filter((p) => p !== b.textPath && p !== "scratchpad.txt" && !/^bin\/\d+\.txt$/.test(p) && !isImage(p) && !p.endsWith("/"))
    .map((p) => ({ path: p, data: p === "info.json" ? withoutSavedText(b.get(p)!) : b.get(p)! }));
  const extras: ExtrasFiles = { bin: b.binItems };
  if (b.scratchpad !== undefined) extras.scratchpad = b.scratchpad;
  if (document.length) extras.document = document;
  return { text: assets.length ? relinkAssets(b.text, "assets", assetsFolder) : b.text, extras, assets };
}

/**
 * info.json as the history records it: without `highwaterToo.savedText`, which names the save the
 * file was last written from and so would change with every save. Untouched if it has none.
 */
export function withoutSavedText(data: Uint8Array): Uint8Array {
  const info = parseJson(data);
  const ours = info?.[INFO_KEY] as Record<string, unknown> | undefined;
  if (!info || !ours || !("savedText" in ours)) return data;
  const rest = { ...ours };
  delete rest.savedText;
  return new TextEncoder().encode(JSON.stringify({ ...info, [INFO_KEY]: rest }));
}

function parseJson(data: Uint8Array): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(data)) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
