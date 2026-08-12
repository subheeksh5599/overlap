# Overlap

Collision radar for parallel agent fleets.

Overlap watches the sessions running under [Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) (AO), computes the changed-file set of every session's git worktree, and flags cross-session collisions before they cost a merge. It also suggests a merge order that minimizes shared-file conflicts and reports which sessions collided after merges. The core is deterministic git analysis — no LLM calls.

## How it works

1. **Daemon client** — reads active sessions and projects from the AO daemon REST API (`GET /api/v1/sessions?active=true`, `GET /api/v1/projects`). Loopback only, no auth required.
2. **Worktree resolution** — the daemon's session JSON does not carry a worktree path, so Overlap derives it deterministically: `$AO_DATA_DIR/data/worktrees/<projectId>/<sessionId>` (default `~/.ao`), and confirms it is a git worktree.
3. **File sets** — for each worktree, `git diff --name-only <merge-base>..HEAD` plus `git status --porcelain` (untracked, renames, and modified files included).
4. **Overlap detection** — deterministic rules:
   - `high` — the same file is touched by 2+ sessions (`same-file`)
   - `medium` — 2+ sessions touch files in the same directory, no same-file alert there (`same-dir`)
   - `low` — the same basename appears in 2+ sessions in different directories, no same-file alert on it (`same-module`)
5. **Merge-order planning** — greedy planner that repeatedly picks the remaining session whose file set shares the fewest files with the others, so shared-file merges happen last.
6. **Post-merge report** — `buildReport()` summarizes which branches collided on which files.

## Architecture

```
packages/overlap-core   engine, daemon client, git helpers, CLI (TypeScript, tsc -> dist/)
apps/dashboard          Next.js app — landing + radar dashboard on one URL
```

- `packages/overlap-core/src/ao.ts` — AO daemon client (`AO_DAEMON_URL` env, default `http://127.0.0.1:3001`; `AO_DATA_DIR` env, default `~/.ao`)
- `packages/overlap-core/src/git.ts` — git helpers (execFile only, no shell)
- `packages/overlap-core/src/engine.ts` — pure engine: `detectOverlaps`, `planMergeOrder`, `buildReport`
- `packages/overlap-core/src/cli.ts` — `overlap status` / `overlap watch`
- `apps/dashboard/src/app/api/state/route.ts` — server route composing sessions + files + alerts + merge order
- `apps/dashboard/src/components/Dashboard.tsx` — radar UI (session table, file sets, alerts, merge order)

## Quickstart

```bash
npm install
npm run build          # core + dashboard
npm test               # engine unit tests (node:test)
```

CLI (requires the AO daemon running):

```bash
npm run cli -- status   # per-session file sets + alerts + suggested merge order
npm run cli -- watch    # poll every 5s, print new alerts
```

Dashboard:

```bash
npm run dev:dashboard   # http://localhost:3000 — landing + radar
```

Environment:

- `AO_DAEMON_URL` — AO daemon base URL (default `http://127.0.0.1:3001`)
- `AO_DATA_DIR` — AO data directory (default `~/.ao`)

## Limitations

- The AO daemon API is internal and may change between AO releases; Overlap pins to the current `/api/v1` surface.
- Overlap detection is file-level heuristics (paths, directories, basenames), not semantic analysis — two sessions editing different parts of the same file still count as a same-file collision.
- Worktree resolution assumes the default AO layout (`<AO_DATA_DIR>/data/worktrees/<projectId>/<sessionId>`).
- The dashboard's `/api/state` returns an explicit error when the daemon is unreachable; it does not fabricate data.

## License

Apache-2.0
