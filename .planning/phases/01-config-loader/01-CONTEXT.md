# Phase 1: Config Loader - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Parse, validate, and export a typed configuration from `nanoclaw.config.jsonc` at project root. The config must handle JSONC (comments, trailing commas), validate with Zod, merge sensible defaults, and export a typed singleton. When the config file is absent, the app runs in container mode with zero behavioral change. This phase delivers the config foundation — later phases wire it to the runner, MCP servers, and per-group overrides.

</domain>

<decisions>
## Implementation Decisions

### Validation strictness
- Unknown fields are treated as errors and stop startup — catches typos like "executonMode" immediately
- Invalid values (e.g., `executionMode: "docker"`) are hard errors — app won't start, must be fixed
- Missing fields use sensible defaults — all fields are optional
- Warn on missing recommended fields (e.g., if `executionMode` is set to `"host"` but no MCP servers configured)
- Error collection strategy: Claude's discretion (fail-fast vs collect-all)

### Error message style
- Config errors displayed as boxed ASCII banners — prominent, impossible to miss
- Each error includes: field name + expected value + actual value + fix hint (e.g., "Did you mean 'container'?")
- When config file is absent: info-level log "No nanoclaw.config.jsonc found, using defaults" — visible on every start, hints to new users the config exists
- On successful load: info-level summary "Config loaded: executionMode=host, 3 MCP servers configured"

### Integration point
- Config loads as the very first thing in startup — before database, before WhatsApp/Slack connection — fail fast if broken
- Exported singleton pattern matching existing `src/config.ts` convention (`import { config } from './config-loader'`)
- Config wiring scope: Claude's discretion — may just load+validate, or may also wire `executionMode` check to runner with a "not yet implemented" guard for host mode

### Claude's Discretion
- Error collection approach (fail-fast vs collect-all errors)
- Whether Phase 1 wires `executionMode` to the runner or stays load+validate only
- Exact Zod schema design and field grouping
- Choice between `strip-json-comments` (already in dep tree) or `jsonc-parser` (Microsoft, more robust) for JSONC parsing

</decisions>

<specifics>
## Specific Ideas

- Config should feel like a first-class feature — "this is how you customize NanoClaw"
- The boxed ASCII error banner should look similar to the existing `ensureContainerSystemRunning` fatal error pattern in the codebase
- Research noted `strip-json-comments` may already be in `node_modules` as a transitive dependency — prefer it if so to avoid adding a new dep

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-config-loader*
*Context gathered: 2026-02-07*
