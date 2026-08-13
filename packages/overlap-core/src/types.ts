/* Types used across the overlap-core package. */

export interface PrFailingCheck {
  name: string;
  url: string;
}

export type CiState = "unknown" | "pending" | "passing" | "failing";
export type MergeabilityState = "unknown" | "mergeable" | "conflicting" | "blocked" | "unstable";

/** Per-session pull-request facts surfaced by the AO daemon (prs[0]). */
export interface PrInfo {
  number: number;
  state: string; // draft | open | merged | closed
  url: string;
  ci: CiState;
  failingChecks: PrFailingCheck[];
  mergeability: MergeabilityState;
}

export interface SessionFiles {
  sessionId: string;
  name: string;
  worktreeDir: string;
  branch: string;
  files: string[];
  projectId?: string;
  /** PR facts from the AO daemon, when the session has an open PR. */
  pr?: PrInfo | null;
}

export type Severity = "high" | "medium" | "low";
export type AlertKind = "same-file" | "same-dir" | "same-module" | "dep-import";

export interface OverlapAlert {
  sessionIds: string[];
  file: string;
  severity: Severity;
  kind: AlertKind;
  /** Worst CI state among the involved sessions (failing > pending > passing > unknown). */
  ci?: CiState;
  /** Worst mergeability among the involved sessions (conflicting > blocked > unstable > mergeable > unknown). */
  mergeability?: MergeabilityState;
  /** dep-import only: the changed file that imports `file`. */
  importer?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

export interface MergeRecord {
  mergedBranch: string;
  files: string[];
}

/**
 * Import edges per session: sessionId -> changed file -> resolved local
 * dependencies (extensionless, relative paths resolved). Collected by the
 * loader from worktree contents; consumed by detectOverlaps for dep-import.
 */
export type ImportGraph = Record<string, Record<string, string[]>>;
