---
phase: 06-mcp-server-configuration-and-filtering
plan: 02
subsystem: agent-pipeline
tags: [mcp, container-input, host-runner, agent-runner, mode-filtering, claude-agent-sdk]

# Dependency graph
requires:
  - phase: 06-mcp-server-configuration-and-filtering
    provides: "McpServerSchema, filterMcpServersByMode(), translateToSdkFormat() in mcp-filter.ts"
  - phase: 04-runner-abstraction-and-host-runner
    provides: "ContainerInput interface, host-runner.ts, agent-runner stdin pipeline"
provides:
  - "ContainerInput.mcpServers field for passing MCP server configs through stdin"
  - "Host-runner reads config.mcpServers and passes to agent input"
  - "Agent-runner filters by mode, logs active/filtered, merges with IPC MCP in query()"
  - "End-to-end MCP server pipeline: config -> host-runner -> stdin -> agent-runner -> SDK query()"
affects:
  - 07-mcp-health-checks (health check layer wraps around active MCP servers)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pass raw config to agent-runner, filter at single point (no DRY violation)"
    - "IPC MCP always first in spread (defense-in-depth against config override)"

key-files:
  created: []
  modified:
    - src/container-runner.ts
    - src/host-runner.ts
    - container/agent-runner/src/index.ts

key-decisions:
  - "Filter in agent-runner not host-runner: single filter point, no cross-build-target imports"
  - "IPC MCP listed first in spread operator: defense-in-depth (mcp-filter already excludes 'nanoclaw')"
  - "No tools allowlist changes: non-main MCP access controlled by admin hostSecurity.tools config"

patterns-established:
  - "MCP server pipeline: config.mcpServers -> ContainerInput.mcpServers -> agent-runner filterMcpServersByMode -> query() mcpServers merge"
  - "Startup logging pattern: log active servers by name, filtered servers with modes and reason"

# Metrics
duration: 2min
completed: 2026-02-11
---

# Phase 6 Plan 02: MCP Server Runner Pipeline Wiring Summary

**End-to-end MCP server flow from config through host-runner stdin to agent-runner, with mode filtering and IPC MCP merge in query() options**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-11T04:53:06Z
- **Completed:** 2026-02-11T04:55:06Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- ContainerInput extended with optional mcpServers field carrying raw server configs
- Host-runner reads config.mcpServers and passes to agent input (agent-runner filters by mode)
- Agent-runner filters servers via filterMcpServersByMode(), logs active/filtered at startup
- Config servers merged with IPC MCP in query() options (nanoclaw always first, cannot be overridden)
- Both build targets compile cleanly with all changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ContainerInput and pass MCP servers from runners** - `7341b75` (feat)
2. **Task 2: Agent-runner receives, filters, merges MCP servers with startup logging** - `2ecc1d9` (feat)

## Files Created/Modified
- `src/container-runner.ts` - Added optional mcpServers field to ContainerInput interface
- `src/host-runner.ts` - Imports config singleton, passes config.mcpServers to agent input when servers exist
- `container/agent-runner/src/index.ts` - Imports filterMcpServersByMode, filters by NANOCLAW_MODE, logs active/filtered, merges with IPC MCP in queryOptions

## Decisions Made
- **Filter in agent-runner, not host-runner:** Keeps filtering at a single point (agent-runner), avoids cross-build-target imports, and lets the agent-runner use NANOCLAW_MODE env var it already has. Host-runner passes raw configs as-is.
- **IPC MCP first in spread:** `nanoclaw: ipcMcp` is listed before `...configMcpServers` in the spread so even if mcp-filter.ts somehow fails to exclude "nanoclaw", the IPC server cannot be overridden. Defense-in-depth.
- **No tools allowlist changes:** Non-main groups have tool restrictions via `hostSecurity.tools`. Config MCP server tools are accessible to main group (no tools restriction). Non-main groups would need explicit `mcp__servername__*` patterns in their tools config -- this is the secure default.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Full MCP server pipeline is operational: config -> filtering -> SDK query()
- Phase 06 (MCP Server Configuration and Filtering) is complete
- Ready for Phase 07 (MCP Health Checks) to add health monitoring around active servers

---
*Phase: 06-mcp-server-configuration-and-filtering*
*Completed: 2026-02-11*
