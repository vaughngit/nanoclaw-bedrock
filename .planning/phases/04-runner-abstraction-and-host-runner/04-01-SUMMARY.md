---
phase: 04-runner-abstraction-and-host-runner
plan: 01
subsystem: infra
tags: [child_process, spawn, subprocess, host-runner, agent-runner, typescript]

# Dependency graph
requires:
  - phase: 03-agent-runner-path-flexibility
    provides: NANOCLAW_* env var resolution and mode-aware path handling in agent-runner
provides:
  - runHostAgent() function for native subprocess agent execution
  - build:agent npm script for local agent-runner compilation
  - GroupQueue/SchedulerDependencies type-safe null containerName support
affects:
  - 04-runner-abstraction-and-host-runner (plan 02 will wire host-runner into routing)
  - 05-host-mode-security (sandbox will wrap host-runner subprocess)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Allowlist-based env var filtering for subprocess security"
    - "host-runner mirrors container-runner structure for consistency"
    - "Null containerName signals host mode in GroupQueue"

key-files:
  created:
    - src/host-runner.ts
  modified:
    - package.json
    - src/group-queue.ts
    - src/task-scheduler.ts

key-decisions:
  - "Allowlist approach for subprocess env vars rather than passing entire process.env"
  - "Shared ~/.claude via CLAUDE_CONFIG_DIR (not isolated per group like container mode)"
  - "No output size limits in host mode (higher trust than container mode)"

patterns-established:
  - "host- prefix for log files (vs container- prefix)"
  - "onProcess(proc, null) signals host mode to GroupQueue"
  - "build:agent script for local compilation of agent-runner"

# Metrics
duration: 3min
completed: 2026-02-08
---

# Phase 4 Plan 1: Host Runner Module Summary

**Native subprocess host-runner with allowlist env filtering, build:agent script, and null-containerName type safety**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-09T01:33:31Z
- **Completed:** 2026-02-09T01:36:03Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Created host-runner.ts as a parallel module to container-runner.ts for native subprocess execution
- Added build:agent npm script that compiles agent-runner TypeScript locally
- Fixed GroupQueue.registerProcess and SchedulerDependencies.onProcess to accept null containerName
- Host runner uses allowlist-based env var filtering (security) and no output size truncation (trust)

## Task Commits

Each task was committed atomically:

1. **Task 1a: Add agent-runner local build script** - `5121061` (chore)
2. **Task 1b: Fix GroupQueue and SchedulerDependencies type signatures** - `29fd334` (fix)
3. **Task 2: Create src/host-runner.ts** - `ec0608e` (feat)

## Files Created/Modified
- `src/host-runner.ts` - runHostAgent() spawning agent-runner as native subprocess with allowlist env, sentinel output parsing, SIGTERM/SIGKILL timeout, host- prefixed logs
- `package.json` - Added build:agent script for local agent-runner compilation
- `src/group-queue.ts` - registerProcess accepts string | null for containerName
- `src/task-scheduler.ts` - SchedulerDependencies.onProcess callback accepts string | null

## Decisions Made
- **Allowlist env vars:** Subprocess gets only explicitly listed env vars (PATH, HOME, auth keys, etc.) plus NANOCLAW_* vars, rather than inheriting entire process.env. Security boundary without container isolation.
- **Shared ~/.claude:** Host mode shares the real ~/.claude directory via CLAUDE_CONFIG_DIR, unlike container mode which isolates per-group sessions. This is the user decision documented in the plan.
- **No output limits:** Host mode does not truncate stdout/stderr (no CONTAINER_MAX_OUTPUT_SIZE). Higher trust environment than containers.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- host-runner.ts exists and is callable but not yet wired into app routing
- Plan 04-02 will create the runner abstraction and routing logic to choose between container-runner and host-runner based on executionMode config
- Container mode is completely unchanged (backward compatible)

---
*Phase: 04-runner-abstraction-and-host-runner*
*Completed: 2026-02-08*
