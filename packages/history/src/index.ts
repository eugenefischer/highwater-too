/**
 * @highwater/history: Per-document git writing history (milestone M7).
 * Must not import "vscode" (see spec, Code layout).
 */
export const PACKAGE_NAME = "@highwater/history";
export { CommitBatcher } from "./batch.ts";
export { git, gitBytes, GitError } from "./git.ts";
export { commitMessage, History, ID_TRAILER, readme, moveHistory, MATCH_THRESHOLD, REPO_NAME, similarity, wordCount, type CommitInfo, type DocumentFiles, type IndexEntry, type SaveKind, type WorkInfo } from "./history.ts";
export { defaultHistoryFolder, syncedFolder } from "./location.ts";
export { failureKind, Mirror, parseRemote, type FailureKind, type PullResult, type PushResult, type RemoteInfo } from "./mirror.ts";
