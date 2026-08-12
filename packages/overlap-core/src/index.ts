/* overlap-core public API */

export {
  baseUrl,
  defaultDataDir,
  DaemonError,
  listSessions,
  listProjects,
  sessionWorktreeDir,
  sessionProject,
} from "./ao.js";
export type { RawSession } from "./ao.js";
export { changedFiles, isGitRepo, mergeBase, worktreeList } from "./git.js";
export type { WorktreeEntry } from "./git.js";
export { detectOverlaps, planMergeOrder, buildReport } from "./engine.js";
export type { SessionFiles, OverlapAlert, ProjectInfo, MergeRecord, Severity, AlertKind } from "./types.js";
