/* git.ts — git helpers via child_process.execFile (no shell). */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileP = promisify(execFile);
const GIT_TIMEOUT = 30_000;

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd, timeout: GIT_TIMEOUT, encoding: "utf8" });
  return stdout;
}

/** Verify that dir is inside a git repository. */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--git-dir"], dir);
    return true;
  } catch {
    return false;
  }
}

/** Get the merge base of HEAD and the default branch (origin/main, then main). */
export async function mergeBase(repoDir: string): Promise<string | null> {
  const candidates: string[][] = [
    ["merge-base", "HEAD", "origin/main"],
    ["merge-base", "HEAD", "main"],
    ["rev-parse", "HEAD"],
  ];
  for (const args of candidates) {
    try {
      const out = (await runGit(args, repoDir)).trim();
      if (out) return out;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Parse one `git status --porcelain` line into the changed paths it refers to.
 * Handles untracked ("?? path"), renames ("R  old -> new"), and ignored
 * entries ("!! ...") which are skipped.
 */
function parsePorcelainLine(line: string): string[] {
  if (line.length < 4) return [];
  const codes = line.slice(0, 2);
  const rest = line.slice(3);
  if (codes === "!!") return [];
  if (codes[0] === "R" || codes[0] === "C") {
    const parts = rest.split(" -> ");
    return parts.length >= 2 ? [parts[0], parts[1]] : [rest];
  }
  return [rest];
}

/** Changed files in a worktree relative to a base ref, plus uncommitted changes. */
export async function changedFiles(worktreeDir: string, base: string | null): Promise<string[]> {
  const files = new Set<string>();

  if (base) {
    try {
      const committed = await runGit(["diff", "--name-only", `${base}..HEAD`], worktreeDir);
      for (const line of committed.split("\n")) {
        const name = line.trim();
        if (name) files.add(name);
      }
    } catch {
      // base..HEAD failed (divergent history) — fall through to status only
    }
  }

  try {
    const status = await runGit(["status", "--porcelain"], worktreeDir);
    for (const line of status.split("\n")) {
      if (!line.trim()) continue;
      for (const path of parsePorcelainLine(line)) {
        if (path.trim()) files.add(path.trim());
      }
    }
  } catch {
    // not a git worktree — return what we have
  }

  return Array.from(files);
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/** `git worktree list --porcelain` for a repo: maps branch -> worktree path. */
export async function worktreeList(repoDir: string): Promise<WorktreeEntry[]> {
  const entries: WorktreeEntry[] = [];
  try {
    const out = await runGit(["worktree", "list", "--porcelain"], repoDir);
    let path = "";
    let branch: string | null = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      } else if (line.trim() === "") {
        if (path) entries.push({ path, branch });
        path = "";
        branch = null;
      }
    }
    if (path) entries.push({ path, branch });
  } catch {
    // not a repo
  }
  return entries;
}
