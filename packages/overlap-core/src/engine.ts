/* engine.ts — pure deterministic overlap engine, no LLM calls. */

import type { MergeRecord, OverlapAlert, SessionFiles } from "./types.js";

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
 */
export function detectOverlaps(sessions: SessionFiles[]): OverlapAlert[] {
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
      alerts.push({ sessionIds: Array.from(ids), file, severity: "high", kind: "same-file" });
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
      alerts.push({ sessionIds: Array.from(ids), file: dir, severity: "medium", kind: "same-dir" });
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
      alerts.push({ sessionIds: Array.from(allIds), file: base, severity: "low", kind: "same-module" });
    }
  }

  // Stable ordering: severity desc, then file, then sessions — deterministic output.
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  alerts.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
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
