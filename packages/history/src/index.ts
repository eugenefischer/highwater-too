/**
 * @highwater/history: Per-document git writing history (milestone M7).
 * Must not import "vscode" (see spec, Code layout).
 */
export const PACKAGE_NAME = "@highwater/history";
export { CommitBatcher } from "./batch.ts";
export { git, GitError } from "./git.ts";
export { commitMessage, History, MATCH_THRESHOLD, similarity, wordCount, type CommitInfo, type DocumentFiles, type IndexEntry, type SaveKind } from "./history.ts";
