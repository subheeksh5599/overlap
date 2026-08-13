// demo-b2 radar scene
#!/usr/bin/env node
/* cli.ts — bin `overlap`: status, watch, report, export, route. */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import { baseUrl, listProjects, listSessions, sessionPr, sessionProject, sessionWorktreeDir } from "./ao.js";
import type { RawSession } from "./ao.js";
import { changedFiles, isGitRepo, mergeBase } from "./git.js";
import { buildReport, detectOverlaps, leastLoadedSession, planMergeOrder } from "./engine.js";
import { collectImportEdges } from "./imports.js";
import type { ImportGraph, OverlapAlert, ProjectInfo, SessionFiles } from "./types.js";

const SEV_LABEL: Record<string, string> = { high: "HIGH", medium: "MEDIUM", low: "LOW" };
const KIND_LABEL: Record<string, string> = {
  "same-file": "SAME FILE",
  "same-dir": "SAME DIRECTORY",
  "same-module": "SAME MODULE",
  "dep-import": "DEP IMPORT",
};
const CI_LABEL: Record<string, string> = { failing: "CI FAILING", pending: "CI PENDING", passing: "ci passing", unknown: "" };
const MERGE_LABEL: Record<string, string> = {
  conflicting: "MERGE CONFLICTING",
  blocked: "MERGE BLOCKED",
  unstable: "MERGE UNSTABLE",
  mergeable: "",
  unknown: "",
};

interface LoadedSessions {
  sessions: SessionFiles[];
  projects: ProjectInfo[];
  raw: RawSession[];
  imports: ImportGraph;
}

async function loadSessions(projectFilter = ""): Promise<LoadedSessions> {
  const projects = await listProjects();
  let raw = await listSessions();
  if (projectFilter) raw = raw.filter((s) => s.projectId === projectFilter);

  const sessions: SessionFiles[] = [];
  const imports: ImportGraph = {};
  for (const s of raw) {
    const project = sessionProject(s, projects);
    const worktreeDir = sessionWorktreeDir(s);
    if (!project || !worktreeDir) {
      // Session has no derivable worktree yet (spawning / scratch) — skip quietly.
      continue;
    }
    if (!(await isGitRepo(worktreeDir))) continue;
    const base = await mergeBase(project.path);
    const files = await changedFiles(worktreeDir, base);
    const session: SessionFiles = {
      sessionId: s.id,
      name: s.displayName || s.name || s.id,
      worktreeDir,
      branch: s.branch || "unknown",
      files,
      projectId: s.projectId,
      pr: sessionPr(s),
    };
    sessions.push(session);
    imports[session.sessionId] = await collectImportEdges(files, (f) => readFile(join(worktreeDir, f), "utf8"));
  }
  return { sessions, projects, raw, imports };
}

function prLine(s: SessionFiles): string {
  const pr = s.pr;
  if (!pr || pr.number === 0) return "";
  const ci = pr.ci === "unknown" ? "" : `ci: ${pr.ci}`;
  const merge = pr.mergeability === "unknown" ? "" : `mergeability: ${pr.mergeability}`;
  const bits = [ci, merge].filter(Boolean).join(", ");
  return `  pr:      #${pr.number} (${pr.state}${bits ? ` — ${bits}` : ""})${pr.failingChecks.length ? ` — failing: ${pr.failingChecks.map((c) => c.name).join(", ")}` : ""}`;
}

function printAlerts(alerts: OverlapAlert[]): void {
  if (alerts.length === 0) {
    console.log("No overlap alerts.\n");
    return;
  }
  console.log(`Overlap alerts: ${alerts.length}\n`);
  for (const a of alerts) {
    const badges = [
      a.ci ? CI_LABEL[a.ci] : "",
      a.mergeability ? MERGE_LABEL[a.mergeability] : "",
    ]
      .filter(Boolean)
      .map((b) => `[${b}]`)
      .join(" ");
    const importer = a.kind === "dep-import" && a.importer ? ` (imported by ${a.importer})` : "";
    console.log(
      `  [${SEV_LABEL[a.severity]}] ${KIND_LABEL[a.kind]}: ${a.file}${importer} (sessions: ${a.sessionIds.join(", ")})${badges ? ` ${badges}` : ""}`,
    );
  }
  console.log();
}

async function cmdStatus(projectFilter: string, json: boolean, stats: boolean): Promise<void> {
  const { sessions, projects, imports } = await loadSessions(projectFilter);
  const alerts = detectOverlaps(sessions, imports);

  if (json) {
    const order = planMergeOrder(sessions);
    const mergeOrderIds = order.map((s) => s.sessionId);
    printJsonStatus(baseUrl, sessions, alerts, mergeOrderIds);
    return;
  }

  const shownProjects = projectFilter ? projects.filter((p) => p.id === projectFilter) : projects;
  console.log(`=== Overlap ===`);
  console.log(`Daemon: ${baseUrl}`);
  console.log(`Projects: ${shownProjects.map((p) => p.id).join(", ") || "(none)"}`);
  console.log(`Active sessions with worktrees: ${sessions.length}\n`);

  const byProject = new Map<string, SessionFiles[]>();
  for (const s of sessions) {
    const key = s.projectId || "(unknown project)";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(s);
  }

  for (const [projectId, group] of byProject) {
    if (byProject.size > 1) console.log(`--- project: ${projectId} ---`);
    for (const s of group) {
      console.log(`--- ${s.name} (${s.sessionId}) ---`);
      console.log(`  branch:   ${s.branch}`);
      console.log(`  worktree: ${s.worktreeDir}`);
      const pr = prLine(s);
      if (pr) console.log(pr);
      console.log(`  files:    ${s.files.length ? s.files.join(", ") : "(none)"}\n`);
    }
  }

  printAlerts(alerts);

  if (sessions.length >= 2) {
    const order = planMergeOrder(sessions);
    console.log("Suggested merge order (least shared files first):");
    order.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} (${s.branch})`));
    console.log();
  }

  if (stats) {
    const totalFiles = sessions.reduce((sum, s) => sum + s.files.length, 0);
    console.log(`Sessions: ${sessions.length}`);
    console.log(`Files tracked: ${totalFiles}`);
    console.log(`Alerts: ${alerts.length}`);
  }
}

function printJsonStatus(baseUrl: string, sessions: SessionFiles[], alerts: OverlapAlert[], mergeOrder: string[]): void {
  const sessionList = sessions.map((s) => ({
    sessionId: s.sessionId,
    name: s.name,
    branch: s.branch,
    projectId: s.projectId ?? "",
    worktreeDir: s.worktreeDir,
    files: s.files,
    pr: s.pr
      ? {
          number: s.pr.number,
          state: s.pr.state,
          url: s.pr.url,
          ci: s.pr.ci,
          mergeability: s.pr.mergeability,
          failingChecks: s.pr.failingChecks,
        }
      : null,
  }));
  const alertList = alerts.map((a) => ({
    sessionIds: a.sessionIds,
    file: a.file,
    severity: a.severity,
    kind: a.kind,
    ci: a.ci ?? "unknown",
    mergeability: a.mergeability ?? "unknown",
    importer: a.importer ?? null,
  }));
  console.log(
    JSON.stringify({ daemon: baseUrl, sessions: sessionList, alerts: alertList, mergeOrder: mergeOrder }),
  );
}

async function cmdWatch(json: boolean, projectFilter: string): Promise<void> {
  const seen = new Set<string>();
  console.log(`=== Overlap watch ===`);
  console.log(`Daemon: ${baseUrl} — polling every 5s. Ctrl-C to stop.${projectFilter ? ` (project: ${projectFilter})` : ""}\n`);
  for (;;) {
    try {
      const { sessions, imports } = await loadSessions(projectFilter);
      const alerts = detectOverlaps(sessions, imports);
      for (const a of alerts) {
        const key = `${a.kind}|${a.file}|${a.sessionIds.sort().join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(
          `[${new Date().toISOString()}] [${SEV_LABEL[a.severity]}] ${KIND_LABEL[a.kind]}: ${a.file} (sessions: ${a.sessionIds.join(", ")})${a.ci === "failing" ? " [CI FAILING]" : ""}`,
        );
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll error: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

async function cmdReport(mergesPath: string): Promise<void> {
  let merges: { mergedBranch: string; files: string[] }[];
  try {
    const content = await readFile(mergesPath, "utf8");
    merges = JSON.parse(content);
  } catch (err) {
    console.error(`Error: failed to read or parse "${mergesPath}": ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const lines = buildReport(merges);
  console.log("Post-merge report:");
  for (const line of lines) {
    console.log(line);
  }
}

async function cmdExport(outPath: string, projectFilter: string): Promise<void> {
  const { sessions, imports } = await loadSessions(projectFilter);
  const alerts = detectOverlaps(sessions, imports);
  const order = planMergeOrder(sessions);
  const mergeOrderIds = order.map((s) => s.sessionId);

  const data = {
    generatedAt: new Date().toISOString(),
    daemon: baseUrl,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      branch: s.branch,
      projectId: s.projectId ?? "",
      worktreeDir: s.worktreeDir,
      files: s.files,
      pr: s.pr,
    })),
    alerts: alerts.map((a) => ({
      sessionIds: a.sessionIds,
      file: a.file,
      severity: a.severity,
      kind: a.kind,
      ci: a.ci ?? "unknown",
      mergeability: a.mergeability ?? "unknown",
      importer: a.importer ?? null,
    })),
    mergeOrder: mergeOrderIds,
  };

  try {
    await writeFile(outPath, JSON.stringify(data, null, 2));
    console.log(`wrote ${outPath}`);
  } catch (err) {
    console.error(`Error: failed to write "${outPath}": ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/** Emit the resolution task for the least-loaded session involved in alerts. */
async function cmdRoute(projectFilter: string): Promise<void> {
  const { sessions, imports } = await loadSessions(projectFilter);
  const alerts = detectOverlaps(sessions, imports);

  if (alerts.length === 0) {
    console.log("No overlap alerts — nothing to route.");
    return;
  }

  const involvedIds = new Set(alerts.flatMap((a) => a.sessionIds));
  const candidates = sessions.filter((s) => involvedIds.has(s.sessionId));
  const target = leastLoadedSession(candidates) ?? leastLoadedSession(sessions);
  if (!target) {
    console.log("No sessions to route to.");
    return;
  }

  const targetAlerts = alerts.filter((a) => a.sessionIds.includes(target.sessionId));
  const lines = [
    `Fix task for AO session "${target.name}" (${target.sessionId})`,
    `Generated by Overlap at ${new Date().toISOString()} — collision resolution routing`,
    "",
    `Collisions involving this session (${target.branch}):`,
    ...targetAlerts.map(
      (a) =>
        `  [${SEV_LABEL[a.severity]}] ${KIND_LABEL[a.kind]}: ${a.file} — sessions ${a.sessionIds.join(", ")}${a.ci === "failing" ? " [CI FAILING]" : ""}`,
    ),
    "",
    "Resolution:",
    `  Rebase ${target.branch} onto the current base, resolve the conflicts in the`,
    `  files above (keep both features), rebuild, and re-run the full test suite.`,
    "  Push the resolved branch so the PR updates.",
    "",
  ];
  const out = lines.join("\n");
  console.log(`Routing resolution to least-loaded session: ${target.name} (${target.files.length} files touched)`);
  console.log();
  console.log(out);

  const outPath = `overlap-route-${target.sessionId}.txt`;
  try {
    await writeFile(outPath, out);
    console.log(`wrote ${outPath}`);
  } catch {
    // stdout copy already delivered; file write is best-effort
  }
}

async function main(): Promise<void> {
  const hasJson = process.argv.includes("--json");
  const hasStats = process.argv.includes("--stats");
  let projectFilter = "";
  const args: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--json" || arg === "--stats") continue;
    if (arg === "--project") {
      projectFilter = process.argv[i + 1] ?? "";
      i++;
      continue;
    }
    args.push(arg);
  }
  const command = args[2];

  try {
    if (command === "status") await cmdStatus(projectFilter, hasJson, hasStats);
    else if (command === "watch") await cmdWatch(hasJson, projectFilter);
    else if (command === "report") await cmdReport(args[3] ?? "");
    else if (command === "export") await cmdExport(args[3] ?? "", projectFilter);
    else if (command === "route") await cmdRoute(projectFilter);
    else {
      console.error("Usage: overlap <status|watch|report|export|route> [--json] [--stats] [--project <id>]");
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error(`Is the AO daemon running at ${baseUrl}?`);
    process.exit(1);
  }
}

main();
