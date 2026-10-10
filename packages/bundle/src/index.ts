/**
 * @highwater/bundle: .highland ZIP read/write with unknown-entry passthrough (milestone M1).
 * Must not import "vscode" (see spec, Code layout).
 */
export const PACKAGE_NAME = "@highwater/bundle";
export {
  BundleError,
  HIGHLAND_KEY,
  HighlandBundle,
  MODE_UTI,
  TEXT_FILES,
  stripHighlandExtension,
  type DocumentMode,
} from "./bundle.ts";
export { DEFAULT_NAVIGATOR_FILTERS, createDocument, type NewDocumentOptions } from "./create.ts";
export {
  ExternalChangeError,
  fingerprint,
  readBundle,
  unchangedSince,
  writeBundle,
  type DiskFingerprint,
  type WriteOptions,
} from "./file.ts";
