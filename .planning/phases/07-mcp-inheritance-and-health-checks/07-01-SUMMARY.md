---
phase: 07-mcp-inheritance-and-health-checks
plan: 01
subsystem: mcp
tags: [mcp, health-check, settings-json, agent-runner, startup-logging]

# Dependency graph
requires:
  - phase: 06-mcp-server-configuration-and-filtering
    provides: MCP server filtering pipeline, filterMcpServersByMode, config MCP server passing
  - phase: 05-host-mode-security
    provides: settingSources split (main vs non-main), security boundary for non-main groups
provides:
  - readGlobalMcpServerNames() for logging visibility into ~/.claude/settings.json MCP servers
  - logMcpServerSources() for config vs global server source breakdown
  - MCP server health status logging from SDK init message with timing
  - Global MCP inheritance restricted to main+host only (security boundary preserved)
affects: [08-per-group-overrides]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Logging-only file reads: read settings.json separately from SDK loading for log visibility"
    - "SDK init message inspection: capture mcp_servers status from init system message"
    - "Non-blocking health checks: health status logged from SDK init, never blocks agent startup"

key-files:
  created: []
  modified:
    - container/agent-runner/src/mcp-filter.ts
    - container/agent-runner/src/index.ts

key-decisions:
  - "Read ~/.claude/settings.json for logging only; SDK settingSources handles actual server loading"
  - "settingSources unchanged: main keeps ['project','user'], non-main keeps ['project']"
  - "Health status from SDK init message, not custom probes (avoids spawning servers twice)"
  - "Global inheritance restricted to isMain && NANOCLAW_MODE === 'host' (security boundary)"
  - "Reserved name 'nanoclaw' filtered from global server list"

patterns-established:
  - "Init message inspection: type cast mcp_servers field from SDK init message for health logging"
  - "Source-separated logging: config vs global servers shown separately with override detection"

# Metrics
duration: 2min
completed: 2026-02-12
---

# Phase 7 Plan 1: MCP Inheritance and Health Checks Summary

**Global MCP server inheritance visibility via settings.json reading with per-server health status logging from SDK init message**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-12T04:00:46Z
- **Completed:** 2026-02-12T04:02:38Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `readGlobalMcpServerNames()` to read ~/.claude/settings.json for logging visibility (SDK handles actual loading)
- Added `logMcpServerSources()` to log config vs global servers in separate sections with override detection
- Added MCP server health status logging from SDK init message with per-server OK/FAIL labels and timing
- Preserved security boundary: global inheritance only for main group in host mode

## Task Commits

Each task was committed atomically:

1. **Task 1: Add global server reading and source logging to mcp-filter.ts** - `c5bb921` (feat)
2. **Task 2: Wire global inheritance logging and health status into agent-runner** - `6f2394d` (feat)

## Files Created/Modified
- `container/agent-runner/src/mcp-filter.ts` - Added readGlobalMcpServerNames() and logMcpServerSources() exports
- `container/agent-runner/src/index.ts` - Wired global reading, source logging, and init message health status

## Decisions Made
- **Logging-only approach for settings.json:** Read ~/.claude/settings.json separately from SDK loading purely for logging which servers come from where. The SDK's `settingSources: ['user']` handles actual server loading. This avoids the pitfall of removing 'user' from settingSources (which would disable global permissions, hooks, etc.).
- **settingSources unchanged:** Main group keeps `['project', 'user']`, non-main keeps `['project']`. No modification needed.
- **SDK init message for health status:** Instead of building custom MCP probes (which would spawn servers twice), captured `mcp_servers` from the SDK's init system message. This provides per-server status immediately after query() initialization, before prompt processing.
- **Type assertion for mcp_servers:** Used `(message as { mcp_servers?: ... }).mcp_servers` since the SDK TypeScript types may not expose the field directly on the message union type.
- **Reserved name filtering in logMcpServerSources:** The "nanoclaw" name is filtered from the global server list inside `logMcpServerSources()` itself (not requiring the caller to filter).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- MCP inheritance and health logging complete
- Phase 7 is a single-plan phase; phase is complete
- Ready for Phase 8 (Per-Group Overrides) when planned
- Global MCP servers visible in startup logs; health status available at agent init time

---
*Phase: 07-mcp-inheritance-and-health-checks*
*Completed: 2026-02-12*
