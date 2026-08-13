/* overlap-core public API */

export {
  baseUrl,
  defaultDataDir,
  DaemonError,
  listSessions,
  listProjects,
  sessionPr,
  sessionWorktreeDir,
  sessionProject,
} from "./ao.js";
export type { RawSession } from "./ao.js";
export { changedFiles, isGitRepo, mergeBase, worktreeList } from "./git.js";
export type { WorktreeEntry } from "./git.js";
export { detectOverlaps, planMergeOrder, buildReport, leastLoadedSession, worstCi, worstMergeability } from "./engine.js";
export { extractSpecifiers, isLocalSpec, resolveLocalSpec, collectImportEdges } from "./imports.js";
export type {
  SessionFiles,
  OverlapAlert,
  ProjectInfo,
  MergeRecord,
  Severity,
  AlertKind,
  ImportGraph,
  PrInfo,
  CiState,
  MergeabilityState,
} from "./types.js";
