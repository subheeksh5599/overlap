/* Types used across the overlap-core package. */

export interface SessionFiles {
  sessionId: string;
  name: string;
  worktreeDir: string;
  branch: string;
  files: string[];
}

export type Severity = "high" | "medium" | "low";
export type AlertKind = "same-file" | "same-dir" | "same-module";

export interface OverlapAlert {
  sessionIds: string[];
  file: string;
  severity: Severity;
  kind: AlertKind;
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
