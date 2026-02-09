# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Users can toggle between container isolation and host-native execution via a single config file
**Current focus:** Phase 4 complete, ready for Phase 5

## Current Position

Phase: 4 of 8 (Runner Abstraction and Host Runner) -- COMPLETE
Next: Phase 5 (Host Mode Security)
Status: Phase 4 verified, ready for Phase 5
Last activity: 2026-02-09 -- Completed Phase 4 (all plans verified)

Progress: [████████░░░░░░░░] ~50%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: 11.5 min
- Total execution time: 69 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-config-loader | 2/2 | 13 min | 6.5 min |
| 02-config-template-and-env-expansion | 1/1 | 3 min | 3 min |
| 03-agent-runner-path-flexibility | 1/1 | 3 min | 3 min |
| 04-runner-abstraction-and-host-runner | 2/2 | 48 min | 24 min |

**Recent Trend:**
- Last 5 plans: 02-01 (3 min), 03-01 (3 min), 04-01 (3 min), 04-02 (~45 min)
- Note: 04-02 included human checkpoint, WhatsApp debugging, and session resume fix

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

### Pending Todos

None.

### Blockers/Concerns

- Phase 5 (Host Mode Security): sandbox-runtime integration needs deep research before implementation -- flagged by research summary as MEDIUM confidence area
- Phase 7 (MCP Health Checks): Agent SDK mcpServerStatus() API existence unverified -- may need alternative approach
- ESM pattern note: Any future module-level singletons that log at import time must use process.stderr.write, not pino logger (async transport timing issue)
- Cross-mode sessions: Container-mode session IDs don't have transcript files on host filesystem. Agent-runner now retries without session, but database still stores stale session IDs until overwritten by new sessions.

## Session Continuity

Last session: 2026-02-09T02:30:00Z
Stopped at: Phase 4 complete and verified. Ready for Phase 5 (Host Mode Security).
Resume file: None
