// demo-a2 module scene
/* engine.ts — pure deterministic overlap engine, no LLM calls. */

import type { CiState, ImportGraph, MergeabilityState, MergeRecord, OverlapAlert, SessionFiles } from "./types.js";

function fileDir(file: string): string {
  const lastSep = file.lastIndexOf("/");
  if (lastSep <= 0) return "";
  return file.substring(0, lastSep);
}

function fileBasename(file: string): string {
  const lastSep = file.lastIndexOf("/");
  return lastSep < 0 ? file : file.substring(lastSep + 1);
}

function keyOf(sessionIds: string[]): string {
  return Array.from(new Set(sessionIds)).sort().join(",");
}

const EXT_RE = /\.(tsx?|jsx?|mjs|cjs|json)$/;
function extless(p: string): string {
  return p.replace(EXT_RE, "");
}

/* --- CI / mergeability context ---------------------------------------- */

const CI_RANK: Record<CiState, number> = { failing: 0, pending: 1, passing: 2, unknown: 3 };
const MERGE_RANK: Record<MergeabilityState, number> = {
  conflicting: 0,
  blocked: 1,
  unstable: 2,
  mergeable: 3,
  unknown: 4,
};

function sessionCi(s: SessionFiles): CiState {
  return s.pr?.ci ?? "unknown";
}

function sessionMergeability(s: SessionFiles): MergeabilityState {
  return s.pr?.mergeability ?? "unknown";
}

/** Worst state across the involved sessions: failing beats pending beats passing. */
export function worstCi(sessions: SessionFiles[], ids: string[]): CiState {
  const byId = new Map(sessions.map((s) => [s.sessionId, s] as const));
  let worst: CiState = "unknown";
  for (const id of ids) {
    const ci = byId.get(id) ? sessionCi(byId.get(id)!) : "unknown";
    if (CI_RANK[ci] < CI_RANK[worst]) worst = ci;
  }
  return worst;
}

/** Worst mergeability across the involved sessions: conflicting beats blocked. */
export function worstMergeability(sessions: SessionFiles[], ids: string[]): MergeabilityState {
  const byId = new Map(sessions.map((s) => [s.sessionId, s] as const));
  let worst: MergeabilityState = "unknown";
  for (const id of ids) {
    const m = byId.get(id) ? sessionMergeability(byId.get(id)!) : "unknown";
    if (MERGE_RANK[m] < MERGE_RANK[worst]) worst = m;
  }
  return worst;
}

/**
 * Detect overlap alerts across sessions.
 *
 * Rules (deterministic):
 *   high   same-file   — the same path is touched by 2+ sessions
 *   medium same-dir    — 2+ sessions touch files in the same directory,
 *                        with no same-file alert in that directory
 *   low    same-module — the same basename appears in 2+ sessions in
 *                        different directories, with no same-file alert
 *                        on that basename
 *   medium dep-import  — a session's changed file imports a module another
 *                        session is editing (path-level import graph, v1)
 *
 * Every alert carries the worst CI state and mergeability among the
 * sessions involved, and ordering is: severity, then CI (failing first),
 * then mergeability (conflicting first), then file, then session key —
 * fully deterministic.
 */
export function detectOverlaps(sessions: SessionFiles[], imports: ImportGraph = {}): OverlapAlert[] {
  const active = sessions.filter((s) => s.files.length > 0);
  const alerts: OverlapAlert[] = [];

  // --- same-file (high) ---
  const fileToSessions = new Map<string, Set<string>>();
  for (const s of active) {
    for (const f of new Set(s.files)) {
      if (!fileToSessions.has(f)) fileToSessions.set(f, new Set());
      fileToSessions.get(f)!.add(s.sessionId);
    }
  }
  const highFiles = new Map<string, string>(); // file -> session key
  for (const [file, ids] of fileToSessions) {
    if (ids.size >= 2) {
      const key = keyOf(Array.from(ids));
      highFiles.set(file, key);
      alerts.push({
        sessionIds: Array.from(ids),
        file,
        severity: "high",
        kind: "same-file",
        ci: worstCi(sessions, Array.from(ids)),
        mergeability: worstMergeability(sessions, Array.from(ids)),
      });
    }
  }

  // --- same-dir (medium) ---
  const dirToSessions = new Map<string, Set<string>>();
  const dirHasHigh = new Map<string, boolean>();
  for (const s of active) {
    const dirs = new Set(s.files.map(fileDir).filter((d) => d !== ""));
    for (const d of dirs) {
      if (!dirToSessions.has(d)) dirToSessions.set(d, new Set());
      dirToSessions.get(d)!.add(s.sessionId);
      if (s.files.some((f) => fileDir(f) === d && highFiles.has(f))) {
        dirHasHigh.set(d, true);
      }
    }
  }
  for (const [dir, ids] of dirToSessions) {
    if (ids.size >= 2 && !dirHasHigh.get(dir)) {
      alerts.push({
        sessionIds: Array.from(ids),
        file: dir,
        severity: "medium",
        kind: "same-dir",
        ci: worstCi(sessions, Array.from(ids)),
        mergeability: worstMergeability(sessions, Array.from(ids)),
      });
    }
  }

  // --- same-module (low): same basename, different directories ---
  const baseToDirToSessions = new Map<string, Map<string, Set<string>>>();
  for (const s of active) {
    for (const f of new Set(s.files)) {
      const base = fileBasename(f);
      const d = fileDir(f);
      if (!baseToDirToSessions.has(base)) baseToDirToSessions.set(base, new Map());
      const dirMap = baseToDirToSessions.get(base)!;
      if (!dirMap.has(d)) dirMap.set(d, new Set());
      dirMap.get(d)!.add(s.sessionId);
    }
  }
  for (const [base, dirMap] of baseToDirToSessions) {
    if (dirMap.size < 2) continue; // needs ≥2 different directories
    // skip if a high (same-file) alert already exists on this basename
    if (Array.from(highFiles.keys()).some((f) => fileBasename(f) === base)) continue;
    const allIds = new Set<string>();
    for (const ids of dirMap.values()) for (const id of ids) allIds.add(id);
    if (allIds.size >= 2) {
      alerts.push({
        sessionIds: Array.from(allIds),
        file: base,
        severity: "low",
        kind: "same-module",
        ci: worstCi(sessions, Array.from(allIds)),
        mergeability: worstMergeability(sessions, Array.from(allIds)),
      });
    }
  }

  // --- dep-import (medium): session A edits a module session B imports ---
  const changedBySession = new Map<string, Set<string>>(); // sessionId -> extless changed paths
  const extlessToFile = new Map<string, string>(); // extless -> canonical path (first seen, sorted)
  for (const s of active) {
    const set = new Set<string>();
    for (const f of new Set(s.files)) {
      const el = extless(f);
      set.add(el);
      if (!extlessToFile.has(el)) extlessToFile.set(el, f);
    }
    changedBySession.set(s.sessionId, set);
  }
  const depKeys = new Set<string>(); // dedupe: `${moduleKey}|${sessionKey}`
  for (const s of active) {
    const sessionEdges = imports[s.sessionId] ?? {};
    for (const [fromFile, deps] of Object.entries(sessionEdges)) {
      for (const dep of deps) {
        // Which OTHER sessions edit a file matching this dependency?
        for (const [otherId, otherPaths] of changedBySession) {
          if (otherId === s.sessionId) continue;
          if (!otherPaths.has(dep)) continue;
          // Skip when the same-file alert already covers this module.
          const canonical = extlessToFile.get(dep)!;
          if (highFiles.has(canonical)) continue;
          const ids = [s.sessionId, otherId];
          const key = `${dep}|${keyOf(ids)}`;
          if (depKeys.has(key)) continue;
          depKeys.add(key);
          alerts.push({
            sessionIds: ids,
            file: canonical,
            severity: "medium",
            kind: "dep-import",
            importer: fromFile,
            ci: worstCi(sessions, ids),
            mergeability: worstMergeability(sessions, ids),
          });
        }
      }
    }
  }

  // Stable ordering: severity, then CI, then mergeability, then file, then sessions.
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  alerts.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    const aCi = CI_RANK[a.ci ?? "unknown"];
    const bCi = CI_RANK[b.ci ?? "unknown"];
    if (aCi !== bCi) return aCi - bCi;
    const aM = MERGE_RANK[a.mergeability ?? "unknown"];
    const bM = MERGE_RANK[b.mergeability ?? "unknown"];
    if (aM !== bM) return aM - bM;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return keyOf(a.sessionIds) < keyOf(b.sessionIds) ? -1 : 1;
  });
  return alerts;
}

/**
 * Greedy merge-order planner. Repeatedly picks the remaining session whose
 * file set shares the fewest files with the other remaining sessions, so
 * merges that touch shared files happen last (fewer live conflicts).
 */
export function planMergeOrder(sessions: SessionFiles[]): SessionFiles[] {
  const fileSets = new Map<string, Set<string>>();
  for (const s of sessions) fileSets.set(s.sessionId, new Set(s.files));

  const remaining = new Set(sessions.map((s) => s.sessionId));
  const ordered: SessionFiles[] = [];

  while (remaining.size > 0) {
    let bestId: string | null = null;
    let bestScore = Infinity;
    for (const id of remaining) {
      const mine = fileSets.get(id)!;
      let shared = 0;
      for (const other of remaining) {
        if (other === id) continue;
        for (const f of mine) if (fileSets.get(other)!.has(f)) shared++;
      }
      if (shared < bestScore) {
        bestScore = shared;
        bestId = id;
      }
    }
    const session = sessions.find((s) => s.sessionId === bestId)!;
    ordered.push(session);
    remaining.delete(session.sessionId);
  }
  return ordered;
}

/**
 * Least-loaded session: fewest touched files (tie-break: alphabetical name).
 * Used by `overlap route` to pick the session that should resolve a collision.
 */
export function leastLoadedSession(sessions: SessionFiles[]): SessionFiles | null {
  if (sessions.length === 0) return null;
  return sessions.reduce((a, b) => {
    if (a.files.length !== b.files.length) return a.files.length < b.files.length ? a : b;
    return a.name < b.name ? a : b;
  });
}

/** Build report lines summarizing which sessions collided on which files. */
export function buildReport(merges: MergeRecord[]): string[] {
  const lines: string[] = [];
  for (const { mergedBranch, files } of merges) {
    if (files.length === 0) {
      lines.push(`${mergedBranch}: no conflicting files`);
    } else {
      lines.push(`${mergedBranch}: ${files.join(", ")}`);
    }
  }
  return lines;
}
