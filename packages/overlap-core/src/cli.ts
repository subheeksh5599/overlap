#!/usr/bin/env node
/* cli.ts — bin `overlap`: status, watch, merge-order. */

import { baseUrl, listProjects, listSessions, sessionProject, sessionWorktreeDir } from "./ao.js";
import type { RawSession } from "./ao.js";
import { changedFiles, isGitRepo, mergeBase } from "./git.js";
import { detectOverlaps, planMergeOrder, buildReport } from "./engine.js";
import type { OverlapAlert, SessionFiles, ProjectInfo, MergeRecord } from "./types.js";
import { readFile } from "fs/promises";

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

async function cmdStatus(): Promise<void> {
  const { sessions, projects } = await loadSessions();
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

  printAlerts(detectOverlaps(sessions));

  if (sessions.length >= 2) {
    const order = planMergeOrder(sessions);
    console.log("Suggested merge order (least shared files first):");
    order.forEach((s, i) => console.log(`  ${i + 1}. ${s.name} (${s.branch})`));
    console.log();
  }
}

async function cmdWatch(): Promise<void> {
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

async function main(): Promise<void> {
  const command = process.argv[2];
  try {
    if (command === "status") await cmdStatus();
    else if (command === "watch") await cmdWatch();
    else if (command === "report") await cmdReport(process.argv[3]);
    else {
      console.error("Usage: overlap <status|watch|report>");
      process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    console.error(`Is the AO daemon running at ${baseUrl}?`);
    process.exit(1);
  }
}

main();
