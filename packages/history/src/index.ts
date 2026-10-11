/**
 * @highwater/history: Per-document git writing history (milestone M7).
 * Must not import "vscode" (see spec, Code layout).
 */
export const PACKAGE_NAME = "@highwater/history";
export { CommitBatcher } from "./batch.ts";
export { git, GitError } from "./git.ts";
export { commitMessage, History, ID_TRAILER, moveHistory, MATCH_THRESHOLD, REPO_NAME, similarity, wordCount, type CommitInfo, type DocumentFiles, type IndexEntry, type SaveKind } from "./history.ts";
export { defaultHistoryFolder, syncedFolder } from "./location.ts";
export { Mirror, parseRemote, type PullResult, type PushResult, type RemoteInfo } from "./mirror.ts";
