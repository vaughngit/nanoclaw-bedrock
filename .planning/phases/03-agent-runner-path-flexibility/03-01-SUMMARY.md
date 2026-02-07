---
phase: 03-agent-runner-path-flexibility
plan: 01
subsystem: agent-runner
tags: [env-vars, path-config, ipc, container, typescript]

# Dependency graph
requires:
  - phase: 02-config-template-and-env-expansion
    provides: config template with executionMode field and env var expansion
provides:
  - "resolvePathVar() helper for env-var-backed path constants with absolute-path validation"
  - "Environment-configurable GROUP_DIR, GLOBAL_DIR, IPC_DIR, NANOCLAW_MODE constants"
  - "IPC directory injection via createIpcMcp() parameter"
  - "Mode-driven settingSources (host mode includes user settings)"
  - "Auto-directory creation for GROUP_DIR at startup"
  - "Path env var documentation in nanoclaw.config.jsonc"
  - "Rebuilt container image with refactored agent-runner"
affects:
  - 04-host-runner (sets NANOCLAW_* env vars when spawning agent-runner)
  - 05-host-mode-security (sandbox interacts with host-mode paths)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolvePathVar() pattern: env var -> absolute check -> fallback default"
    - "IPC directory injection via parameter instead of module-level constant"
    - "Mode-driven SDK configuration (settingSources varies by NANOCLAW_MODE)"

key-files:
  created: []
  modified:
    - container/agent-runner/src/index.ts
    - container/agent-runner/src/ipc-mcp.ts
    - nanoclaw.config.jsonc

key-decisions:
  - "resolvePathVar() rejects relative paths with warning, falls back to default"
  - "IPC directory passed as parameter to createIpcMcp() rather than ipc-mcp.ts reading env directly"
  - "Non-container mode logs all resolved paths for debugging visibility"
  - "Tool description made path-agnostic (references IPC directory generically, not /workspace/ literally)"

patterns-established:
  - "resolvePathVar(envVar, default): canonical way to read NANOCLAW_* path env vars"
  - "NANOCLAW_ prefix: all NanoClaw-specific env vars use this prefix (except CLAUDE_CONFIG_DIR)"
  - "Mode-driven config: use NANOCLAW_MODE to select behavior variations between container/host"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 3 Plan 1: Agent-Runner Path Flexibility Summary

**Environment-variable-backed path constants with resolvePathVar() helper, IPC directory injection, and mode-driven settingSources -- container mode unchanged, host mode ready**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T22:54:44Z
- **Completed:** 2026-02-07T22:57:57Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Replaced all 5 hardcoded `/workspace/*` paths with env-var-backed constants that fall back to current defaults
- Made IPC directory injectable via `createIpcMcp()` parameter instead of hardcoded module constant
- Added mode-driven `settingSources` so host mode can inherit user MCP servers
- Added `resolvePathVar()` helper with absolute-path validation and warning on relative paths
- Documented all path env vars in nanoclaw.config.jsonc for reference
- Container image rebuilt successfully -- TypeScript compiles inside Docker build

## Task Commits

Each task was committed atomically:

1. **Task 1: Make agent-runner paths environment-configurable** - `12db9a3` (feat)
2. **Task 2: Document path env vars in config and rebuild container** - `120af8b` (docs)

## Files Created/Modified
- `container/agent-runner/src/index.ts` - Added resolvePathVar(), path constants (GROUP_DIR, GLOBAL_DIR, IPC_DIR, NANOCLAW_MODE), mode logging, settingSources, auto-directory creation, ipcDir injection
- `container/agent-runner/src/ipc-mcp.ts` - Added ipcDir to IpcMcpContext interface, removed hardcoded IPC_DIR/MESSAGES_DIR/TASKS_DIR constants, derive from injected ipcDir parameter
- `nanoclaw.config.jsonc` - Added commented reference section for NANOCLAW_GROUP_DIR, NANOCLAW_GLOBAL_DIR, NANOCLAW_IPC_DIR, NANOCLAW_MODE, CLAUDE_CONFIG_DIR

## Decisions Made
- **resolvePathVar() rejects relative paths**: Returns fallback default with warning log. Relative paths would resolve unpredictably depending on CWD.
- **IPC dir injected via parameter, not env read**: ipc-mcp.ts does not read env vars directly. index.ts reads NANOCLAW_IPC_DIR and passes the resolved value to createIpcMcp(). Single point of env var resolution.
- **Tool description made path-agnostic**: Changed `/workspace/project/data/registered_groups.json` to generic "available_groups.json in the IPC directory" to avoid misleading the AI agent in host mode.
- **Non-container mode logging**: Path values only logged when NANOCLAW_MODE is not "container" to keep container output identical to pre-refactor.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered
- Agent-runner node_modules not installed locally (SDK only available during Docker build). Resolved by running `npm install` in the agent-runner directory to enable local `tsc --noEmit` verification. The installed node_modules is gitignored.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- Agent-runner is now path-configurable and ready for Phase 4 (Host Runner) to set NANOCLAW_* env vars when spawning subprocesses
- Container mode behavior is identical to pre-refactor (all defaults are /workspace/*)
- CLAUDE_CONFIG_DIR is documented but not set by agent-runner -- Phase 4's host runner will set it

---
*Phase: 03-agent-runner-path-flexibility*
*Completed: 2026-02-07*
