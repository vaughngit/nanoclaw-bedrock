---
phase: 04-runner-abstraction-and-host-runner
plan: 02
subsystem: infra
tags: [routing, mode-switching, index, task-scheduler, end-to-end, host-mode]

# Dependency graph
requires:
  - phase: 04-runner-abstraction-and-host-runner
    plan: 01
    provides: runHostAgent() function and GroupQueue null-containerName support
provides:
  - Mode-routed agent invocation in index.ts (runHostAgent vs runContainerAgent)
  - Mode-routed task execution in task-scheduler.ts
  - Conditional container system startup (only in container mode)
  - End-to-end verified host mode agent execution
affects:
  - 05-host-mode-security (sandbox will wrap host-runner subprocess invocations wired here)
  - 06-mcp-server-configuration (MCP filtering will apply at the routing points established here)
  - 08-per-group-overrides (per-group mode will override the config.executionMode checks wired here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ternary routing based on config.executionMode at each agent invocation site"
    - "Conditional ensureContainerSystemRunning() gated on container mode"
    - "Agent-runner retry-without-session for cross-mode session incompatibility"

key-files:
  modified:
    - src/index.ts
    - src/task-scheduler.ts
    - container/agent-runner/src/index.ts

key-decisions:
  - "Ternary inline routing (not strategy pattern) -- minimal abstraction for two modes"
  - "Retry agent without session on resume failure -- handles container-to-host session incompatibility"
  - "Startup logs execution mode immediately after loadState() for debugging visibility"

patterns-established:
  - "config.executionMode === 'host' ? runHostAgent(...) : runContainerAgent(...) at each callsite"
  - "runQuery(sessionId) helper with catch-and-retry for graceful session resume degradation"

# Metrics
duration: ~45min (includes debugging WhatsApp connection + session resume fix)
completed: 2026-02-09
---

# Phase 4 Plan 2: Wire Mode Routing Summary

**Mode-routed agent invocation in index.ts and task-scheduler.ts, with end-to-end verification and session resume fix**

## Performance

- **Duration:** ~45 min (includes checkpoint debugging)
- **Started:** 2026-02-09T01:38:00Z
- **Completed:** 2026-02-09T02:30:00Z
- **Tasks:** 2 (1 auto + 1 human checkpoint)
- **Files modified:** 3

## Accomplishments
- Wired host-runner into index.ts with config-based routing (runHostAgent vs runContainerAgent)
- Wired host-runner into task-scheduler.ts with identical routing pattern
- Gated ensureContainerSystemRunning() behind container mode check
- Added execution mode startup log for debugging visibility
- Fixed agent-runner session resume crash: retry without session when resume fails (cross-mode compatibility)
- End-to-end verified: WhatsApp message -> host-runner -> agent-runner subprocess -> response

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire mode routing** - `5fe9af7` (feat)
2. **Deviation fix: Session resume retry** - `fa73506` (fix)

## Files Modified
- `src/index.ts` - Added config/host-runner imports, conditional container startup, ternary mode routing in runAgent(), execution mode log
- `src/task-scheduler.ts` - Added config/host-runner imports, ternary mode routing in runTask()
- `container/agent-runner/src/index.ts` - Extracted runQuery() helper, added catch-and-retry without session for resume failures

## Decisions Made
- **Ternary routing:** Simple inline ternary rather than strategy pattern or abstraction layer. Two modes, two runners, no need for more complexity.
- **Session resume retry:** When `query({ resume: sessionId })` fails (e.g., session transcript file doesn't exist on host), retry with `undefined` to start a fresh session. This handles the common case of switching from container mode (sessions stored in container FS) to host mode (sessions on host FS).

## Deviations from Plan

1. **Session resume retry (fa73506):** During end-to-end verification, discovered that container-mode session IDs stored in the database don't have corresponding transcript files on the host filesystem. The Claude Code SDK crashes with exit code 1 when trying to resume a non-existent session. Added retry-without-resume logic to agent-runner/src/index.ts to gracefully handle this cross-mode incompatibility.

## Issues Encountered

1. **WhatsApp conflict:replaced loop:** Multiple stale NanoClaw processes from prior sessions were competing for the WhatsApp connection, causing an infinite reconnect loop (reason 440). Resolved by killing zombie processes.
2. **Claude Code exit code 1 on session resume:** Root cause was cross-mode session incompatibility (container session IDs → missing host transcript files). Fixed with retry logic.

## User Setup Required

None - the session resume retry is automatic and transparent.

## Next Phase Readiness
- Host mode is fully functional end-to-end
- Container mode is unchanged (backward compatible)
- Phase 5 (Host Mode Security) can now wrap the host-runner subprocess with macOS Seatbelt sandbox
- Phase 6 (MCP Config) can add mode-aware filtering at the routing points established here

---
*Phase: 04-runner-abstraction-and-host-runner*
*Completed: 2026-02-09*
