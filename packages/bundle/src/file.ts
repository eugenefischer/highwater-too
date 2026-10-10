import { createHash, randomBytes } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { HighlandBundle } from "./bundle.ts";

/** What a save compares against to notice that another program changed the file. */
export interface DiskFingerprint {
  size: number;
  mtimeMs: number;
  sha256: string;
}

export async function fingerprint(path: string): Promise<DiskFingerprint> {
  const [info, data] = await Promise.all([stat(path), readFile(path)]);
  return { size: info.size, mtimeMs: info.mtimeMs, sha256: createHash("sha256").update(data).digest("hex") };
}

/** True when the file on disk still matches the fingerprint (content hash decides; size/time are a fast path). */
export async function unchangedSince(path: string, before: DiskFingerprint): Promise<boolean> {
  const info = await stat(path);
  if (info.size === before.size && info.mtimeMs === before.mtimeMs) return true;
  return (await fingerprint(path)).sha256 === before.sha256;
}

export class ExternalChangeError extends Error {
  override name = "ExternalChangeError";
}

export async function readBundle(path: string): Promise<{ bundle: HighlandBundle; fingerprint: DiskFingerprint }> {
  const data = await readFile(path);
  const print = { ...(await fingerprint(path)) };
  return { bundle: HighlandBundle.fromZip(new Uint8Array(data)), fingerprint: print };
}

export interface WriteOptions {
  /** If given, refuse to write when the file on disk no longer matches (another program saved it). */
  expected?: DiskFingerprint;
}

/**
 * Saves a bundle safely: writes `.<name>.saving` next to the target, flushes it, re-reads it to
 * confirm the text survives, then renames it over the original. On any failure the original is
 * untouched and the temporary file is removed.
 */
export async function writeBundle(path: string, bundle: HighlandBundle, options: WriteOptions = {}): Promise<DiskFingerprint> {
  if (options.expected) {
    const exists = await stat(path).then(() => true, () => false);
    if (exists && !(await unchangedSince(path, options.expected))) {
      throw new ExternalChangeError(`${basename(path)} was changed on disk by another program`);
    }
  }
  const bytes = bundle.toZip(basename(path));
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString("hex")}.saving`);
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const check = HighlandBundle.fromZip(new Uint8Array(await readFile(temp)));
    if (check.text !== bundle.text) throw new Error("Verification failed: the saved text does not read back identically");
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return fingerprint(path);
}
