<div align="center">

# Overlap

**Collision radar for parallel agent fleets.**

[![Live demo](https://img.shields.io/badge/●_live-dashboard--six--fawn--62.vercel.app-34d399)](https://dashboard-six-fawn-62.vercel.app)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-34d399.svg)](LICENSE)
![Tests](https://img.shields.io/badge/tests-24%20passing-3fb950)
![Stack](https://img.shields.io/badge/Next.js%20·%20React%2019%20·%20TypeScript-1f1f23)
![AO](https://img.shields.io/badge/Agent%20Orchestrator-native-5865F2)

### Detect cross-session file overlap in Agent Orchestrator worktrees before it costs a merge.

Overlap watches the sessions running under [Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator), computes the changed-file set of every session's git worktree, and flags collisions before they break a merge. It also advises a merge order that minimizes shared-file conflicts and reports which sessions collided after merges. The core is deterministic git analysis — no LLM calls.

### ▶ Live at **[dashboard-six-fawn-62.vercel.app](https://dashboard-six-fawn-62.vercel.app)**

**[ Live demo ↗ ](https://dashboard-six-fawn-62.vercel.app)** · **[ Repo ↗ ](https://github.com/subheeksh5599/overlap)** · **[ Architecture ↓ ](#architecture)** · **[ Run it locally ↓ ](#run-it-locally)**

Built for **The Orchestra** — Agent Orchestrator's first online hackathon. Apache-2.0 licensed.

</div>

---

## Table of contents

- [See it in one command](#-see-it-in-one-command)
- [The problem Overlap solves](#the-problem-overlap-solves)
- [How Overlap works](#how-overlap-works)
  - [1 · Read — sessions from the AO daemon](#1--read--sessions-from-the-ao-daemon)
  - [2 · Diff — changed-file sets per worktree](#2--diff--changed-file-sets-per-worktree)
  - [3 · Detect — overlap alerts](#3--detect--overlap-alerts)
  - [4 · Plan — merge order](#4--plan--merge-order)
  - [5 · Report — post-merge collisions](#5--report--post-merge-collisions)
- [Architecture](#architecture)
  - [Component by component](#component-by-component)
- [Engineering decisions — the hard problems](#engineering-decisions--the-hard-problems)
- [What's real vs pending — the honesty table](#whats-real-vs-pending--the-honesty-table)
- [Tests](#tests)
- [Run it locally](#run-it-locally)
- [Configuration](#configuration)
- [Deploy](#deploy)
- [Project layout](#project-layout)
- [Tech stack](#tech-stack)
- [What's next](#whats-next)
- [License](#license)

---

## ▶ See it in one command

```bash
git clone https://github.com/subheeksh5599/overlap.git
cd overlap
npm install && npm run build && npm test
```

Then, with an AO daemon running, point the radar at it:

```bash
$ npm run cli -- status
=== Overlap ===
Daemon: http://127.0.0.1:3001
Projects: overlap
Active sessions with worktrees: 2

--- engine-cli (overlap-17) ---
  branch:   ao/overlap-17/root
  files:    packages/overlap-core/src/cli.ts

--- dash-json (overlap-18) ---
  branch:   ao/overlap-18/root
  files:    packages/overlap-core/src/cli.ts

Overlap alerts: 1
  [HIGH] SAME FILE: packages/overlap-core/src/cli.ts (sessions: overlap-17, overlap-18)
```

Two parallel agents edited the same file — the radar caught it live during the build, the reviewer session confirmed it, and the merge followed the advised order.

---

## The problem Overlap solves

Running agents in parallel is the point of AO — each session gets an isolated git worktree. But parallelism has a coordination cost:

- **Two sessions touch the same file** — the second PR arrives with a conflict you have to untangle by hand
- **No visibility into who is editing what** — you find out at merge time, not before
- **Merge order matters** — merging the wrong PR first turns a clean sequence into a conflict cascade
- **No post-mortem** — after a collision you don't know which sessions collided, on what, or why

Existing tools work *after* the merge: git's conflict markers, GitHub's mergeability check. Overlap works *before* — it watches the live worktrees and flags the overlap while the agents are still editing.

---

## How Overlap works

Six stages, all deterministic, all local.

### 1 · Read — sessions from the AO daemon

The daemon exposes `GET /api/v1/sessions?active=true` and `GET /api/v1/projects` on loopback (no auth). Overlap reads both:

```ts
const projects = await listProjects();
const raw = await listSessions();
```

### 2 · Diff — changed-file sets per worktree

Session JSON does not carry a worktree path, so Overlap derives it from the AO data layout — `<AO_DATA_DIR>/data/worktrees/<projectId>/<sessionId>` — then computes the file set with git:

```bash
git diff --name-only <merge-base>..HEAD        # committed changes
git status --porcelain                          # uncommitted: modified, untracked, renames
```

### 3 · Detect — overlap alerts

Deterministic rules, no LLM:

| Severity | Kind | Rule |
|---|---|---|
| high | same-file | the same path is touched by 2+ sessions |
| medium | same-dir | 2+ sessions touch files in the same directory, no same-file alert there |
| medium | dep-import | a session's changed file imports a module another session is editing (path-level import graph) |
| low | same-module | the same basename appears in 2+ sessions in different directories, no same-file alert on it |

Every alert also carries the **worst CI state and mergeability among the sessions involved**, read from the daemon's per-session PR facts — so "collides AND CI failing" outranks "collides but green", and the CLI prints `[CI FAILING]` / `[MERGE CONFLICTING]` badges:

```bash
$ npm run cli -- status
Overlap alerts: 2
  [HIGH] SAME FILE: packages/overlap-core/src/cli.ts (sessions: overlap-24, overlap-27) [CI FAILING] [MERGE BLOCKED]
  [MEDIUM] DEP IMPORT: packages/overlap-core/src/engine.ts (imported by packages/overlap-core/src/cli.ts) (sessions: overlap-27, overlap-24) [CI FAILING] [MERGE BLOCKED]
```

### 4 · Plan — merge order

A greedy planner repeatedly picks the remaining session whose file set shares the fewest files with the others, so shared-file merges happen last:

```ts
const order = planMergeOrder(sessions);
// 1. engine-cli   — touches cli.ts alone
// 2. dash-json    — touches cli.ts + package-lock.json (shared)
```

### 5 · Report — post-merge collisions

```bash
$ npm run cli -- report merges.json
Post-merge report:
branch-a: no conflicting files
branch-b: src/x.ts
```

### 6 · Route — fix routing

```bash
$ npm run cli -- route
Routing resolution to least-loaded session: demo-b2 (1 files touched)

Fix task for AO session "demo-b2" (overlap-27)
Collisions involving this session (ao/overlap-27/root):
  [HIGH] SAME FILE: packages/overlap-core/src/cli.ts — sessions overlap-24, overlap-27 [CI FAILING]
Resolution:
  Rebase ao/overlap-27/root onto the current base, resolve the conflicts in the
  files above (keep both features), rebuild, and re-run the full test suite.
  Push the resolved branch so the PR updates.
```

The radar picks the least-loaded session involved in an alert (fewest touched files) and emits a deterministic resolution task — rebase, resolve the flagged files, rebuild, re-run tests — ready to paste into the AO session.

---

## Architecture

```
┌──────────────┐   GET /api/v1/sessions?active=true    ┌──────────────────┐
│  AO daemon   │──────────────────────────────────────▶│  @overlap/core   │
│  127.0.0.1   │◀─── worktrees under ~/.ao/data/ ──────│  ao.ts · git.ts  │
└──────────────┘                                       │  engine.ts · cli  │
                                                       └────────┬─────────┘
                                                                │ sessions + files
                                                                ▼
┌──────────────────────────────────────────────────────────────┐
│  apps/dashboard (Next.js)                                    │
│  landing + radar on one URL · /api/state · live refresh      │
└──────────────────────────────────────────────────────────────┘
```

### Component by component

| Component | Technology | Responsibility |
|---|---|---|
| ao.ts | TypeScript, fetch | AO daemon client: sessions, projects, worktree derivation |
| git.ts | Node child_process (execFile) | merge-base, changed-file sets, worktree list — no shell |
| engine.ts | TypeScript, pure functions | `detectOverlaps` (CI/mergeability-aware ranking), `planMergeOrder`, `buildReport`, `leastLoadedSession` |
| imports.ts | TypeScript, pure functions | path-level import extraction for `dep-import` alerts |
| cli.ts | Node | `overlap status` / `watch` / `report` / `export` / `route`; `--json` / `--stats` / `--project <id>` |
| apps/dashboard | Next.js 15, React 19 | landing + radar UI; `/api/state` composes live daemon data |

---

## Engineering decisions — the hard problems

**1. Session JSON has no worktree path.** The daemon's session object exposes id, branch, status — but not where the worktree lives. Overlap derives it deterministically from the AO data layout (`AO_DATA_DIR/data/worktrees/{projectId}/{sessionId}`) and verifies it with `git rev-parse` before reading. This pins Overlap to the default layout, stated in the README's limitations.

**2. `git status --porcelain` parsing is not a regex.** Untracked files (`?? path`), renames (`R  old -> new`), and ignored entries (`!!`) each have different shapes. A naive regex drops untracked files — the most common source of agent collisions. The parser handles all four shapes explicitly.

**3. Alert dedup must not over-suppress.** Early versions suppressed the low (same-module) alert whenever *any* session in it had a higher-severity alert elsewhere — so an unrelated collision hid a real one. The final rules suppress only within the same file/directory: same-file subsumes same-dir on that file; a same-module alert survives unless a same-file alert exists on that basename. A unit test locks this in.

**4. Merge-order planning is greedy and deterministic.** Ties are broken by iteration order, which is stable for a given session list — the planner's output is reproducible, which matters when the dashboard renders it.

**5. Headless operation.** The AO desktop app (Electron) is heavy on low-RAM machines and can die under load, taking agent sessions with it. Overlap's daemon client works against the headless Go daemon, so the radar keeps working while the app is closed. The build itself ran headless with three parallel agents.

---

## What's real vs pending — the honesty table

| Feature | Status | Detail |
|---|---|---|
| Overlap detection | ✅ Real | high/medium/low rules incl. dep-import, 24 unit tests |
| CLI (`status`/`watch`/`report`, `--json`) | ✅ Real | verified live against the daemon |
| Merge-order planner | ✅ Real | used for the real merge sequence in the build |
| Reviewer confirmation | ✅ Real | a reviewer session confirmed the cli.ts collision the radar predicted |
| CI-aware alerts | ✅ Real | reads daemon per-session PR facts (ci, mergeability, failing checks); badges in CLI + dashboard |
| dep-import detection | ✅ Real | path-level import graph — a change importing a module another session edits is flagged medium |
| Fix routing (`route`) | ✅ Real | emits a deterministic fix task for the least-loaded session |
| Multi-project (`--project`) | ✅ Real | status / watch / export / route scoped to one registered AO project |
| Live dashboard | ✅ Real | deployed; `/api/state` reads the real daemon (honest error when it's down) |
| Fresh-clone build | ✅ Real | `npm install && npm run build && npm test` verified on a clean clone |
| Conflict *prediction* | ⚠️ Path-level | overlap detection is path + import-graph heuristics, not full semantic analysis — two agents editing different parts of the same file still count as a collision |
| Daemon API stability | ⚠️ Internal | the AO `/api/v1` surface may change between AO releases |

---

## Tests

24/24 passing — `node:test` over two suites: the engine (detection rules, dedup, planner, report builder) and the roadmap features (dep-import, CI-aware ranking, fix routing, import extraction). Full output:

```
✔ detectOverlaps: same file touched by two sessions -> high same-file
✔ detectOverlaps: same directory, different files -> medium same-dir
✔ detectOverlaps: same basename in different dirs -> low same-module
✔ detectOverlaps: same-file suppresses same-dir for the same directory
✔ detectOverlaps: unrelated low alert not suppressed by a different high alert
✔ detectOverlaps: sessions with no files produce no alerts
✔ detectOverlaps: output is deterministically ordered
✔ planMergeOrder: disjoint session first (least shared files)
✔ planMergeOrder: single session
✔ planMergeOrder: empty input
✔ buildReport: lists conflicting files per merged branch
✔ extractSpecifiers: ESM, export-from, require, dynamic import
✔ isLocalSpec: only relative specifiers
✔ resolveLocalSpec: resolves relative paths and strips extensions
✔ collectImportEdges: maps changed files to resolved local deps only
✔ collectImportEdges: read errors contribute no edges
✔ detectOverlaps: session importing a module another session edits -> medium dep-import
✔ detectOverlaps: dep-import suppressed when a same-file alert covers the module
✔ detectOverlaps: dep-import is deduped per module and session pair
✔ detectOverlaps: package specifiers never create dep-import alerts
✔ detectOverlaps: collides AND ci failing outranks collides but green
✔ detectOverlaps: mergeability conflicting outranks mergeable at equal CI
✔ worstCi / worstMergeability: worst-of across sessions
✔ leastLoadedSession: fewest files, then name
```

---

## Run it locally

```bash
git clone https://github.com/subheeksh5599/overlap.git
cd overlap
npm install
npm run build
npm test
```

CLI (requires an AO daemon running):

```bash
npm run cli -- status          # per-session file sets + alerts + suggested merge order
npm run cli -- watch           # poll every 5s, print new alerts
npm run cli -- report m.json   # post-merge report from a merge-records file
npm run cli -- route           # fix task for the least-loaded session in an alert
npm run cli -- export out.json # full radar state as JSON (sessions, alerts, merge order)
npm run cli -- status --project <id>  # scope to one registered AO project
npm run cli -- status --json   # machine-readable output
```

Dashboard:

```bash
npm run dev:dashboard          # http://localhost:3000 — landing + radar
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AO_DAEMON_URL` | `http://127.0.0.1:3001` | AO daemon base URL |
| `AO_DATA_DIR` | `~/.ao` | AO data directory (worktrees live under `<data>/data/worktrees`) |

---

## Deploy

```bash
vercel --prod --yes            # repo root; build runs core + dashboard
```

The project is configured as a monorepo: `buildCommand: npm run build`, `outputDirectory: apps/dashboard/.next`. The deployed `/api/state` reports an explicit daemon-unreachable error when no local AO daemon exists — it never fabricates data.

---

## Project layout

```
overlap/
├── packages/overlap-core/
│   ├── src/                   # ao.ts, git.ts, engine.ts, imports.ts, cli.ts, index.ts, types.ts
│   └── test/                  # engine.test.js + roadmap.test.js (node:test, 24 tests)
├── apps/dashboard/
│   └── src/
│       ├── app/               # page.tsx (landing + radar), api/state/route.ts
│       └── components/        # Dashboard.tsx (radar UI)
├── README.md
└── package.json               # npm workspaces: packages/*, apps/*
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Core | Node.js, TypeScript 5, `node:test` |
| Git access | `child_process.execFile` (no shell) |
| Dashboard | Next.js 15, React 19, App Router |
| Deploy | Vercel (monorepo build, free tier) |
| Target | Agent Orchestrator daemon `/api/v1` (loopback, no auth) |

---

## What's next

The four original roadmap items are shipped: dep-import (semantic overlap), CI-aware alerts, multi-project view, and fix routing. Honest next steps:

- **Full semantic overlap** — real module-graph resolution (tsconfig paths, index resolution, package entry points) instead of path-level imports
- **Automated routing** — inject the fix task into the least-loaded session through the daemon's conversation API instead of printing it
- **CI-run source** — surface per-check state (which check failed, with a link) from GitHub check-runs rather than aggregate PR state
- **Watchdog mode** — `overlap watch` pushing the first collision alert to a desktop notification / webhook

The radar stays deterministic — no LLM calls anywhere in the pipeline.

---

## License

Apache-2.0 — built for The Orchestra, Agent Orchestrator's first online hackathon, August 2026.
