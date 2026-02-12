---
phase: 08-per-group-overrides-and-integration
plan: 01
subsystem: config
tags: [execution-mode, per-group, sqlite, startup-validation, mixed-mode]

# Dependency graph
requires:
  - phase: 01-config-loader
    provides: NanoClawConfig schema with executionMode and hostSecurity
  - phase: 04-runner-abstraction-and-host-runner
    provides: runHostAgent/runContainerAgent routing pattern
  - phase: 05-host-mode-security
    provides: HostSecurityConfig schema and sandbox enforcement
provides:
  - RegisteredGroup.executionMode optional field for per-group mode override
  - execution_mode column in SQLite registered_groups table
  - resolveExecutionMode() function for per-group or global fallback resolution
  - Startup validation blocking launch when hostSecurity missing for host-mode groups
  - Boxed ASCII banner for host mode visibility
  - Conditional container system check (only when needed)
  - Mixed-mode graceful degradation (container down, host still works)
  - Per-group routing in runAgent() and runTask()
  - Host-mode [host] tag in response messages
  - register_group IPC accepts optional executionMode
affects: [08-02-per-group-overrides-and-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-group mode resolution at message-processing time (not cached at startup)"
    - "Safety-first: block startup when security config missing for host-mode"
    - "Mixed-mode graceful degradation: container failure doesn't prevent host-mode groups"

key-files:
  created: []
  modified:
    - src/types.ts
    - src/db.ts
    - src/config-loader.ts
    - src/index.ts
    - src/task-scheduler.ts

key-decisions:
  - "resolveExecutionMode() called at message-processing time, not cached at startup -- supports dynamic group registration and future config reload"
  - "Startup reordered: initDatabase/loadState before container check -- need registered groups to determine which modes are needed"
  - "Mixed-mode: container system failure logged as warning, not fatal -- host-mode groups can still operate"
  - "Host-mode responses tagged with [host] prefix for visibility in chat"

patterns-established:
  - "Per-group resolution: resolveExecutionMode(group) replaces config.executionMode for all routing decisions"
  - "Startup mode scanning: Object.values(registeredGroups).some() to determine which infrastructure is needed"

# Metrics
duration: 3min
completed: 2026-02-12
---

# Phase 8 Plan 1: Per-Group Execution Mode Overrides Summary

**Per-group executionMode field on RegisteredGroup with SQLite persistence, resolveExecutionMode() resolution function, startup safety validation + host-mode banner, and per-group routing in runAgent/runTask**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-12T04:51:57Z
- **Completed:** 2026-02-12T04:54:47Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RegisteredGroup type extended with optional executionMode field, persisted to SQLite with NULL default
- resolveExecutionMode() function exported from config-loader.ts resolves per-group override or global fallback
- Startup reordered to load database and groups before container check, enabling mode-aware infrastructure decisions
- Safety validation blocks startup with clear error when any group needs host mode but hostSecurity is missing
- Boxed ASCII banner at startup shows host/container group split, sandbox status, and tool restrictions
- Container system check now conditional -- only runs when at least one group actually needs container mode
- Mixed-mode graceful degradation: container failure logged as warning while host-mode groups continue working
- runAgent() and runTask() both use per-group mode resolution instead of global config
- register_group IPC passes through optional executionMode for new group registration
- Host-mode responses include [host] tag for visibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Add executionMode to RegisteredGroup type, DB, and resolution function** - `dd70264` (feat)
2. **Task 2: Startup validation, banner, conditional container check, and per-group routing** - `09ce2fd` (feat)

## Files Created/Modified
- `src/types.ts` - Added optional executionMode field to RegisteredGroup interface
- `src/db.ts` - Added execution_mode column migration, updated get/set/getAll to handle field
- `src/config-loader.ts` - Added resolveExecutionMode() function and ExecutionMode type export
- `src/index.ts` - Rewrote main() startup sequence, per-group routing in runAgent/processGroupMessages, IPC executionMode support
- `src/task-scheduler.ts` - Per-group routing in runTask(), host-mode message prefix

## Decisions Made
- resolveExecutionMode() called at message-processing time, not cached at startup -- supports dynamic group registration and future config reload
- Startup reordered: initDatabase/loadState before container check -- need registered groups to determine which modes are needed
- Mixed-mode: container system failure logged as warning, not fatal -- host-mode groups can still operate
- Host-mode responses tagged with [host] prefix for visibility in chat

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Per-group execution mode infrastructure complete
- Ready for Phase 8 Plan 2: integration tests and CLI/IPC tooling for setting per-group modes
- All success criteria verified: type + DB + resolution + validation + banner + routing all working

---
*Phase: 08-per-group-overrides-and-integration*
*Completed: 2026-02-12*
