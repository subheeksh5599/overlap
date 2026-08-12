#!/usr/bin/env node
/* cli.ts — bin `overlap`: status, watch, merge-order. */

import { baseUrl, listProjects, listSessions, sessionProject, sessionWorktreeDir } from "./ao.js";
import type { RawSession } from "./ao.js";
import { changedFiles, isGitRepo, mergeBase } from "./git.js";
import { detectOverlaps, planMergeOrder, buildReport } from "./engine.js";
import type { OverlapAlert, SessionFiles, ProjectInfo, MergeRecord } from "./types.js";
import { readFile, writeFile } from "fs/promises";

const SEV_LABEL: Record<string, string> = { high: "HIGH", medium: "MEDIUM", low: "LOW" };
const KIND_LABEL: Record<string, string> = {
  "same-file": "SAME FILE",
  "same-dir": "SAME DIRECTORY",
  "same-module": "SAME MODULE",
};

interface LoadedSessions {
  sessions: SessionFiles[];
  projects: ProjectInfo[];
  raw: RawSession[];
}

async function loadSessions(): Promise<LoadedSessions> {
  const projects = await listProjects();
  const raw = await listSessions();
  const sessions: SessionFiles[] = [];
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
    sessions.push({
      sessionId: s.id,
      name: s.displayName || s.name || s.id,
      worktreeDir,
      branch: s.branch || "unknown",
      files,
    });
  }
  return { sessions, projects, raw };
}

function printAlerts(alerts: OverlapAlert[]): void {
  if (alerts.length === 0) {
    console.log("No overlap alerts.\n");
    return;
  }
  console.log(`Overlap alerts: ${alerts.length}\n`);
  for (const a of alerts) {
    console.log(
      `  [${SEV_LABEL[a.severity]}] ${KIND_LABEL[a.kind]}: ${a.file} (sessions: ${a.sessionIds.join(", ")})`,
    );
  }
  console.log();
}

function printJsonStatus(baseUrl: string, sessions: SessionFiles[], alerts: OverlapAlert[], mergeOrder: string[]): void {
  const sessionList = sessions.map((s) => ({
    sessionId: s.sessionId,
    name: s.name,
    branch: s.branch,
    worktreeDir: s.worktreeDir,
    files: s.files,
  }));
  const alertList = alerts.map((a) => ({
    sessionIds: a.sessionIds,
    file: a.file,
    severity: a.severity,
    kind: a.kind,
  }));
  console.log(JSON.stringify({ daemon: baseUrl, sessions: sessionList, alerts: alertList, mergeOrder: mergeOrder }));
}

async function cmdStatus(json: boolean, stats: boolean): Promise<void> {
  const { sessions, projects } = await loadSessions();
  const alerts = detectOverlaps(sessions);

  if (json) {
    const order = planMergeOrder(sessions);
    const mergeOrderIds = order.map((s) => s.sessionId);
    printJsonStatus(baseUrl, sessions, alerts, mergeOrderIds);
    return;
  }

  console.log(`=== Overlap ===`);
  console.log(`Daemon: ${baseUrl}`);
  console.log(`Projects: ${projects.map((p) => p.id).join(", ") || "(none)"}`);
  console.log(`Active sessions with worktrees: ${sessions.length}\n`);

  for (const s of sessions) {
    console.log(`--- ${s.name} (${s.sessionId}) ---`);
    console.log(`  branch:   ${s.branch}`);
    console.log(`  worktree: ${s.worktreeDir}`);
    console.log(`  files:    ${s.files.length ? s.files.join(", ") : "(none)"}\n`);
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

async function cmdWatch(json: boolean): Promise<void> {
  const seen = new Set<string>();
  console.log(`=== Overlap watch ===`);
  console.log(`Daemon: ${baseUrl} — polling every 5s. Ctrl-C to stop.\n`);
  for (;;) {
    try {
      const { sessions } = await loadSessions();
      const alerts = detectOverlaps(sessions);
      for (const a of alerts) {
        const key = `${a.kind}|${a.file}|${a.sessionIds.sort().join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`[${new Date().toISOString()}] [${SEV_LABEL[a.severity]}] ${KIND_LABEL[a.kind]}: ${a.file} (sessions: ${a.sessionIds.join(", ")})`);
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] poll error: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

async function cmdReport(mergesPath: string): Promise<void> {
  let merges: MergeRecord[];
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

async function cmdExport(outPath: string): Promise<void> {
  const { sessions } = await loadSessions();
  const alerts = detectOverlaps(sessions);
  const order = planMergeOrder(sessions);
  const mergeOrderIds = order.map((s) => s.sessionId);

  const data = {
    generatedAt: new Date().toISOString(),
    daemon: baseUrl,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      name: s.name,
      branch: s.branch,
      worktreeDir: s.worktreeDir,
      files: s.files,
    })),
    alerts: alerts.map((a) => ({
      sessionIds: a.sessionIds,
      file: a.file,
      severity: a.severity,
      kind: a.kind,
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

async function main(): Promise<void> {
  // Parse --json and --stats flags from any position in process.argv
  const hasJson = process.argv.includes("--json");
  const hasStats = process.argv.includes("--stats");
  // Filter out --json and --stats to reliably extract the subcommand
  const args = process.argv.filter(
    (arg) => arg !== "--json" && arg !== "--stats",
  );
  const command = args[2];

  try {
    if (command === "status") await cmdStatus(hasJson, hasStats);
    else if (command === "watch") await cmdWatch(hasJson);
    else if (command === "report") await cmdReport(args[3] ?? "");
    else if (command === "export") await cmdExport(args[3] ?? "");
    else {
      console.error("Usage: overlap <status|watch|report|export> [--json] [--stats]");
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error(`Is the AO daemon running at ${baseUrl}?`);
    process.exit(1);
  }
}

main();
