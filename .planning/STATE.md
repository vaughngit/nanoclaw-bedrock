# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Users can toggle between container isolation and host-native execution via a single config file
**Current focus:** Phase 8 plan 1 complete. Ready for Phase 8 Plan 2 (Integration and IPC tooling).

## Current Position

Phase: 8 of 8 (Per-Group Overrides and Integration)
Plan: 1 of 2 in phase
Status: In progress
Last activity: 2026-02-12 -- Completed 08-01-PLAN.md

Progress: [███████████████░] ~93%

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Average duration: 6.9 min
- Total execution time: 90 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-config-loader | 2/2 | 13 min | 6.5 min |
| 02-config-template-and-env-expansion | 1/1 | 3 min | 3 min |
| 03-agent-runner-path-flexibility | 1/1 | 3 min | 3 min |
| 04-runner-abstraction-and-host-runner | 2/2 | 48 min | 24 min |
| 05-host-mode-security | 3/3 | 10 min | 3.3 min |
| 06-mcp-server-configuration-and-filtering | 2/2 | 6 min | 3 min |
| 07-mcp-inheritance-and-health-checks | 1/1 | 2 min | 2 min |
| 08-per-group-overrides-and-integration | 1/2 | 3 min | 3 min |

**Recent Trend:**
- Last 5 plans: 06-01 (4 min), 06-02 (2 min), 07-01 (2 min), 08-01 (3 min)
- Consistent ~2-4 min for focused pipeline/wiring plans

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8-phase structure derived from 24 requirements across 5 categories
- [Roadmap]: Security (Phase 5) follows host runner (Phase 4) -- sandbox is mandatory, not optional hardening
- [Roadmap]: Per-group overrides deferred to Phase 8 after security and MCP are solid
- [01-01]: Used z.strictObject() over z.object() to reject unknown keys and catch typos
- [01-01]: Error output via boxed ASCII banners + process.exit(1), not thrown exceptions
- [01-01]: Config singleton is Object.freeze()d for runtime immutability
- [01-01]: Collect-all error strategy (Zod default) so users see all problems at once
- [01-02]: Side-effect import (`import './config-loader.js'`) to prevent esbuild/tsx import elision of unused bindings
- [01-02]: process.stderr.write() for module-level startup messages (pino async transport not ready during ESM evaluation)
- [02-01]: Hand-rolled expandEnvVars() instead of adding a dependency -- trivial on parsed JSON
- [02-01]: Empty env var treated as unset for :- syntax (bash convention)
- [02-01]: Future config fields commented out in template to avoid z.strictObject() rejection
- [02-01]: Expansion runs after JSON.parse, before Zod -- comments not expanded, expanded values validated
- [03-01]: resolvePathVar() rejects relative paths with warning, falls back to default
- [03-01]: IPC directory passed as parameter to createIpcMcp() -- single point of env var resolution in index.ts
- [03-01]: Tool description made path-agnostic (references IPC directory generically, not /workspace/ literally)
- [03-01]: Non-container mode logging of resolved paths for debugging visibility
- [04-01]: Allowlist-based env var filtering for subprocess security (not full process.env passthrough)
- [04-01]: Shared ~/.claude via CLAUDE_CONFIG_DIR in host mode (not per-group isolation like container mode)
- [04-01]: No stdout/stderr size limits in host mode (higher trust than container mode)
- [04-02]: Ternary inline routing (not strategy pattern) for two execution modes
- [04-02]: Retry agent without session on resume failure (cross-mode session incompatibility)
- [04-02]: Startup logs execution mode immediately after loadState() for debugging visibility
- [05-01]: HostSecuritySchema uses z.strictObject -- consistent with existing pattern, catches typos
- [05-01]: Field named `tools` (not `allowedTools`) -- maps to SDK `tools` query option (availability restriction)
- [05-01]: tools min(1) when present -- prevents accidentally disabling all tools
- [05-01]: ContainerInput.security optional -- undefined means no restrictions (main group)
- [05-02]: tools (not allowedTools) for non-main -- tools restricts availability, allowedTools only auto-approves
- [05-02]: mcp__nanoclaw__* always included via wildcard -- agents always need IPC communication
- [05-02]: settingSources ['project'] only for non-main -- prevents shared ~/.claude leaks
- [05-02]: sandbox only in host mode -- container mode has its own isolation
- [05-02]: allowUnsandboxedCommands: false -- prevents model from escaping sandbox
- [05-03]: Unified sandbox detection before log file write -- covers both error and success paths in single block
- [05-03]: Broad Seatbelt pattern matching -- 5 patterns cover known macOS sandbox error formats
- [05-03]: Sandbox alerts via IPC -- reuses existing IPC poller for WhatsApp delivery to main group
- [05-03]: Atomic write for alerts -- temp file + rename prevents partial reads by IPC poller
- [06-01]: superRefine over refine for dynamic error messages (Zod 4 .refine() only takes static params)
- [06-01]: Local NanoClawMcpServer interface in mcp-filter.ts (agent-runner is separate build target)
- [06-01]: Reserved name "nanoclaw" logged and skipped (not in active or filtered sets)
- [06-02]: Filter in agent-runner not host-runner: single filter point, no cross-build-target imports
- [06-02]: IPC MCP listed first in spread operator: defense-in-depth against config override of "nanoclaw"
- [06-02]: No tools allowlist changes: non-main MCP access controlled by admin hostSecurity.tools config
- [07-01]: Read ~/.claude/settings.json for logging only; SDK settingSources handles actual loading
- [07-01]: settingSources unchanged: main keeps ['project','user'], non-main keeps ['project']
- [07-01]: Health status from SDK init message, not custom probes (avoids double server spawning)
- [07-01]: Global inheritance restricted to isMain && host mode only (preserves Phase 5 security boundary)
- [08-01]: resolveExecutionMode() called at message-processing time, not cached at startup -- supports dynamic group registration
- [08-01]: Startup reordered: initDatabase/loadState before container check -- need registered groups to determine which modes are needed
- [08-01]: Mixed-mode: container system failure logged as warning, not fatal -- host-mode groups can still operate
- [08-01]: Host-mode responses tagged with [host] prefix for visibility in chat

### Pending Todos

None.

### Blockers/Concerns

- ESM pattern note: Any future module-level singletons that log at import time must use process.stderr.write, not pino logger (async transport timing issue)
- Cross-mode sessions: Container-mode session IDs don't have transcript files on host filesystem. Agent-runner now retries without session, but database still stores stale session IDs until overwritten by new sessions.

## Session Continuity

Last session: 2026-02-12T04:54:47Z
Stopped at: Completed 08-01-PLAN.md. Phase 8 plan 1 complete. Next: 08-02-PLAN.md (integration and IPC tooling).
Resume file: None
