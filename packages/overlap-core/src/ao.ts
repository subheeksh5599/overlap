/* ao.ts — minimal AO daemon client.
 *
 * Talks to the Agent Orchestrator daemon over loopback HTTP. The daemon
 * exposes /api/v1/* (see GET /api/v1/openapi.yaml on the daemon). No auth is
 * required for loopback clients. Session JSON does not carry a worktree path,
 * so the path is derived deterministically:
 *
 *   $AO_DATA_DIR/data/worktrees/<projectId>/<sessionId>
 *
 * (AO_DATA_DIR defaults to ~/.ao; see AO's installation docs.)
 */

import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { CiState, MergeabilityState, PrInfo, ProjectInfo } from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:3001";
export const baseUrl = (process.env.AO_DAEMON_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

export function defaultDataDir(): string {
  return process.env.AO_DATA_DIR || join(homedir(), ".ao");
}

export class DaemonError extends Error {
  constructor(public readonly status: number, url: string) {
    super(`AO daemon at ${url} returned HTTP ${status}`);
    this.name = "DaemonError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const url = `${baseUrl}${path}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new DaemonError(resp.status, url);
  return resp.json() as Promise<T>;
}

interface RawPrCi {
  state?: string;
  failingChecks?: { name?: string; url?: string }[];
}

interface RawPr {
  number?: number;
  state?: string;
  htmlUrl?: string;
  /** The daemon returns ci/mergeability as flat strings; keep object shape working too. */
  ci?: string | RawPrCi;
  mergeability?: string | { state?: string };
}

export interface RawSession {
  id: string;
  projectId: string;
  displayName?: string;
  name?: string;
  branch?: string;
  status?: string;
  harness?: string;
  /** PR facts observed by the AO daemon's SCM observer. */
  prs?: RawPr[];
  [key: string]: unknown;
}

function ciStateOf(pr: RawPr): CiState {
  const raw = pr.ci;
  const v = typeof raw === "string" ? raw : raw?.state;
  return v === "passing" || v === "failing" || v === "pending" ? v : "unknown";
}

function mergeabilityOf(pr: RawPr): MergeabilityState {
  const raw = pr.mergeability;
  const v = typeof raw === "string" ? raw : raw?.state;
  return v === "mergeable" || v === "conflicting" || v === "blocked" || v === "unstable" ? v : "unknown";
}

/** Map the daemon's first observed PR for a session into PrInfo (defensive). */
export function sessionPr(session: RawSession): PrInfo | null {
  const pr = session.prs?.[0];
  if (!pr) return null;
  const ci = ciStateOf(pr);
  const mergeability = mergeabilityOf(pr);
  const failingChecksRaw = typeof pr.ci === "string" ? undefined : pr.ci?.failingChecks;
  return {
    number: pr.number ?? 0,
    state: pr.state ?? "open",
    url: pr.htmlUrl ?? "",
    ci,
    failingChecks: (failingChecksRaw ?? [])
      .filter((c) => c?.name)
      .map((c) => ({ name: c.name!, url: c.url ?? "" })),
    mergeability,
  };
}

/** List active (non-terminated) sessions. Handles both envelope shapes. */
export async function listSessions(): Promise<RawSession[]> {
  const data = await getJson<RawSession[] | { sessions: RawSession[] }>("/api/v1/sessions?active=true");
  return Array.isArray(data) ? data : data.sessions ?? [];
}

/** List registered projects. */
export async function listProjects(): Promise<ProjectInfo[]> {
  const data = await getJson<{ projects: ProjectInfo[] }>("/api/v1/projects");
  return data.projects ?? [];
}

/** Derive the worktree directory for a session, if it exists on disk. */
export function sessionWorktreeDir(session: RawSession, dataDir = defaultDataDir()): string {
  if (!session.projectId || !session.id) return "";
  const dir = join(dataDir, "data", "worktrees", session.projectId, session.id);
  return existsSync(dir) ? dir : "";
}

/** Map a session to its project info (for the repo path / merge-base). */
export function sessionProject(session: RawSession, projects: ProjectInfo[]): ProjectInfo | undefined {
  return projects.find((p) => p.id === session.projectId);
}

