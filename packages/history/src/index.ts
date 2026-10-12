/**
 * @highwater/history: Per-document git writing history (milestone M7).
 * Must not import "vscode" (see spec, Code layout).
 */
export const PACKAGE_NAME = "@highwater/history";
export { CommitBatcher } from "./batch.ts";
export { git, gitBytes, GitError } from "./git.ts";
export { commitMessage, computerName, FILE_TRAILER, FORM_TRAILER, formOf, History, ID_TRAILER, isForm, textHash, readme, moveHistory, REPO_NAME, wordCount, type CommitInfo, type DocumentFiles, type Form, type SaveMeta, type IndexEntry, type SaveKind, type CopyCandidate, type Recognition, type WorkInfo } from "./history.ts";
export { addDeletion, addSave, mergeMain, readCatalog, slugOf, type CatalogEntry, type CatalogInfo, type DeletedEntry, type MainFiles } from "./catalog.ts";
export { defaultHistoryFolder, syncedFolder } from "./location.ts";
export { failureKind, Mirror, parseRemote, type FailureKind, type PullResult, type PushResult, type RemoteInfo } from "./mirror.ts";
