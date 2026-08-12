import { NextResponse } from "next/server";
import {
  baseUrl,
  DaemonError,
  changedFiles,
  detectOverlaps,
  isGitRepo,
  listProjects,
  listSessions,
  mergeBase,
  planMergeOrder,
  sessionProject,
  sessionWorktreeDir,
} from "@overlap/core";
import type { OverlapAlert, ProjectInfo, SessionFiles } from "@overlap/core";

export const dynamic = "force-dynamic";

interface ApiState {
  daemon: string;
  projects: ProjectInfo[];
  sessions: (SessionFiles & { harness?: string; status?: string })[];
  alerts: OverlapAlert[];
  mergeOrder: string[];
  generatedAt: string;
  error: string | null;
}

export async function GET(): Promise<NextResponse<ApiState>> {
  const generatedAt = new Date().toISOString();
  try {
    const projects = await listProjects();
    const raw = await listSessions();
    const sessions: ApiState["sessions"] = [];

    for (const s of raw) {
      const project = sessionProject(s, projects);
      const worktreeDir = sessionWorktreeDir(s);
      if (!project || !worktreeDir) continue;
      if (!(await isGitRepo(worktreeDir))) continue;
      const base = await mergeBase(project.path);
      const files = await changedFiles(worktreeDir, base);
      sessions.push({
        sessionId: s.id,
        name: s.displayName || s.name || s.id,
        worktreeDir,
        branch: s.branch || "unknown",
        files,
        harness: s.harness || "",
        status: s.status || "",
      });
    }

    const alerts = detectOverlaps(sessions);
    const mergeOrder = planMergeOrder(sessions).map((s) => `${s.name} (${s.branch})`);

    return NextResponse.json({
      daemon: baseUrl,
      projects,
      sessions,
      alerts,
      mergeOrder,
      generatedAt,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof DaemonError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      daemon: baseUrl,
      projects: [],
      sessions: [],
      alerts: [],
      mergeOrder: [],
      generatedAt,
      error: message,
    });
  }
}
