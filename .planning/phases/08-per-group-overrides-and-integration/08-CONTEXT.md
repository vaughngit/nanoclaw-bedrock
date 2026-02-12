# Phase 8: Per-Group Overrides and Integration - Context

**Gathered:** 2026-02-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Individual WhatsApp groups can override the global execution mode (container vs host), the system communicates clearly about its running configuration at startup, and the full system works end-to-end with mixed modes. This phase does NOT add new execution modes or new group registration capabilities.

</domain>

<decisions>
## Implementation Decisions

### Override resolution
- Claude's discretion on WHERE per-group overrides live (registered_groups.json vs nanoclaw.config.jsonc) — pick based on codebase patterns
- If a group requests host mode but host security config is missing: **block startup** with a clear error — safety-first, no silent fallbacks
- Claude's discretion on whether per-group overrides support more than just executionMode (e.g., per-group MCP servers)
- Per-group mode resolved **at message-processing time**, not cached at startup — enables hot-reloading group config without restart

### Startup banner
- Banner only appears **when at least one group uses host mode** — no banner when all groups are in container mode (the safe default)
- Claude's discretion on banner location (logs only vs logs + WhatsApp) and prominence (ASCII box vs colored log line)
- Claude's discretion on banner content detail level (group names, security status, MCP server counts)

### Mixed-mode behavior
- If container system is down but host mode works: **start with host groups only** — container-mode groups get an error response explaining the container is unavailable
- Include a **subtle WhatsApp hint** in responses indicating host mode — Claude's discretion on format (emoji prefix, text tag, etc.)
- Claude's discretion on cross-mode resource isolation (whether host and container groups can IPC to each other)

### End-to-end verification
- Both a **built-in health command** and **manual WhatsApp testing** for full verification
- Health command reports: execution mode, active MCP servers, and security config (sandbox status, permission mode, tool allow-list)
- Health command available to **main group only** — system info stays out of other groups
- Claude's discretion on trigger mechanism (slash command vs natural language vs other)

### Claude's Discretion
- Where per-group overrides are stored (registered_groups.json vs config file)
- Whether overrides support more than executionMode
- Banner location, prominence, and content detail
- WhatsApp mode hint format
- Cross-mode IPC isolation policy
- Health command trigger mechanism

</decisions>

<specifics>
## Specific Ideas

- User wants safety-first approach: block startup rather than silently degrading when security config is missing for host mode
- Mode resolution must be dynamic (at message time) to allow config changes without restart
- Health command is an operator tool, not user-facing — restricted to main group
- Container unavailability should not prevent host-mode groups from working

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-per-group-overrides-and-integration*
*Context gathered: 2026-02-11*
