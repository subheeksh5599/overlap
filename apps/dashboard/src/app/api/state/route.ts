import { NextResponse } from "next/server";
import {
  baseUrl,
  DaemonError,
  changedFiles,
  collectImportEdges,
  detectOverlaps,
  isGitRepo,
  listProjects,
  listSessions,
  mergeBase,
  planMergeOrder,
  sessionPr,
  sessionProject,
  sessionWorktreeDir,
} from "@overlap/core";
import type { ImportGraph, OverlapAlert, PrInfo, ProjectInfo, SessionFiles } from "@overlap/core";
import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

interface ApiSession extends SessionFiles {
  harness?: string;
  status?: string;
}

interface ApiState {
  daemon: string;
  projects: ProjectInfo[];
  sessions: ApiSession[];
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
    const sessions: ApiSession[] = [];
    const imports: ImportGraph = {};

    for (const s of raw) {
      const project = sessionProject(s, projects);
      const worktreeDir = sessionWorktreeDir(s);
      if (!project || !worktreeDir) continue;
      if (!(await isGitRepo(worktreeDir))) continue;
      const base = await mergeBase(project.path);
      const files = await changedFiles(worktreeDir, base);
      const session: ApiSession = {
        sessionId: s.id,
        name: s.displayName || s.name || s.id,
        worktreeDir,
        branch: s.branch || "unknown",
        files,
        projectId: s.projectId,
        pr: sessionPr(s) as PrInfo | null | undefined,
        harness: s.harness || "",
        status: s.status || "",
      };
      sessions.push(session);
      imports[session.sessionId] = await collectImportEdges(files, (f) =>
        readFile(join(worktreeDir, f), "utf8"),
      );
    }

    const alerts = detectOverlaps(sessions, imports);
    const mergeOrder = planMergeOrder(sessions).map((s) => s.sessionId);

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
