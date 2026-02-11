---
phase: 06-mcp-server-configuration-and-filtering
plan: 01
subsystem: config
tags: [zod, mcp, config-schema, mode-filtering, claude-agent-sdk]

# Dependency graph
requires:
  - phase: 01-config-loader
    provides: "z.strictObject() config schema, expandEnvVars(), config singleton"
  - phase: 02-config-template-and-env-expansion
    provides: "nanoclaw.config.jsonc template with commented mcpServers section"
provides:
  - "McpServerSchema with z.strictObject() and superRefine validation"
  - "mcpServers field in NanoClawConfigSchema (Record<string, McpServer>)"
  - "NanoClawMcpServer exported type for downstream modules"
  - "filterMcpServersByMode() in mcp-filter.ts"
  - "translateToSdkFormat() converting NanoClaw config to SDK types"
  - "Config template with real Context7 MCP server example"
affects:
  - 06-mcp-server-configuration-and-filtering (plan 02 wires into runner pipeline)
  - 07-mcp-health-checks (health check layer wraps around MCP server configs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "superRefine for multi-field mutual exclusivity validation"
    - "Separate NanoClaw MCP format with translation layer to SDK types"
    - "Local interface duplication for cross-build-target type sharing"

key-files:
  created:
    - container/agent-runner/src/mcp-filter.ts
  modified:
    - src/config-loader.ts
    - nanoclaw.config.jsonc

key-decisions:
  - "superRefine over refine for dynamic error messages (Zod 4 refine only takes static params)"
  - "Local NanoClawMcpServer interface in mcp-filter.ts (agent-runner is separate build target)"
  - "Reserved name 'nanoclaw' logged and skipped, not included in active or filtered sets"

patterns-established:
  - "superRefine for cross-field validation: Zod 4 .refine() only takes static message strings; use .superRefine() with ctx.addIssue() for dynamic error messages based on field values"
  - "Cross-build-target type sharing: duplicate interface locally rather than importing across build targets"

# Metrics
duration: 4min
completed: 2026-02-11
---

# Phase 6 Plan 01: MCP Server Schema and Filtering Summary

**Zod schema for mode-tagged MCP servers with z.strictObject(), superRefine mutual exclusivity, and standalone mcp-filter.ts translating to SDK format**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-11T04:46:15Z
- **Completed:** 2026-02-11T04:50:19Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- McpServerSchema validates stdio/sse/http server definitions with z.strictObject() catching typos
- superRefine enforces mutual exclusivity: stdio requires command (no url), sse/http requires url (no command)
- filterMcpServersByMode() filters by execution mode, translates to SDK McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig
- Config template ships with real, uncommented Context7 MCP server example
- Startup log shows mcpServers count when servers are configured

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend Zod schema with mcpServers field and uncomment config template** - `a05f208` (feat)
2. **Task 2: Create mcp-filter.ts with filtering and SDK translation** - `97398ca` (feat)

## Files Created/Modified
- `src/config-loader.ts` - Added McpServerSchema, mcpServers field, NanoClawMcpServer type export, updated startup log
- `nanoclaw.config.jsonc` - Uncommented mcpServers section with real Context7 example, added reserved name warning
- `container/agent-runner/src/mcp-filter.ts` - New module with filterMcpServersByMode(), translateToSdkFormat(), reserved name detection

## Decisions Made
- **superRefine over refine:** Zod 4's `.refine()` only accepts static string/object as error params (not a callback). Used `.superRefine()` with `ctx.addIssue()` for dynamic error messages that include the server type.
- **Local interface duplication:** NanoClawMcpServer interface is defined locally in mcp-filter.ts rather than imported from config-loader.ts, because agent-runner is a separate build target with its own tsconfig and dependencies.
- **Reserved name handling:** "nanoclaw" servers are logged as warnings and completely skipped (not added to active or filtered sets), preventing override of the IPC MCP server.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Zod 4 `.refine()` API differs from Zod 3: second parameter is `string | $ZodCustomParams` (static), not a function receiving the value. Switched to `.superRefine()` with `ctx.addIssue()` for dynamic error messages. This was a minor adaptation, not a plan deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Schema and filter module ready for Plan 02 to wire into runner pipeline
- ContainerInput needs mcpServers field added (Plan 02)
- Host-runner and container-runner need to pass filtered servers (Plan 02)
- Agent-runner query() needs to merge config servers with IPC server (Plan 02)

---
*Phase: 06-mcp-server-configuration-and-filtering*
*Completed: 2026-02-11*
