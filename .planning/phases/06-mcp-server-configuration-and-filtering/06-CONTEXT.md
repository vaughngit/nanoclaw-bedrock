# Phase 6: MCP Server Configuration and Filtering - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Configure MCP servers in `nanoclaw.config.jsonc` with execution mode tags (`modes` array), and filter them at agent startup so only mode-compatible servers are loaded. The NanoClaw IPC MCP server remains hardcoded and always injected separately. MCP health checks and global inheritance are Phase 7.

</domain>

<decisions>
## Implementation Decisions

### Server definition format
- Named object format: `"serverName": { ... }` -- matches Claude settings.json naming convention
- Separate NanoClaw format (not a copy of Claude's MCP format) -- own structure translated to Claude format at runtime
- Top-level `mcpServers` key in config, same level as `executionMode` and `hostSecurity`
- Config template ships with commented-out examples showing real MCP servers (Context7, filesystem) with mode tags

### Filtering and logging behavior
- Both active and filtered servers shown at startup -- clear visibility into what's loaded and what's skipped (with reason)
- If a server fails to start (bad command, missing binary, timeout), agent continues without it -- log the failure, proceed with remaining servers
- If ALL configured servers are filtered out for the current mode, warn and continue -- agent just won't have extra MCP tools
- Failures are non-fatal: agent should always be able to operate even with zero additional MCP servers

### Default mode assignment
- Servers without a `modes` field default to `["host", "container"]` -- available in both modes unless explicitly restricted
- Modes field accepts open string enum -- validate known modes ("host", "container") but accept any string for future-proofing
- NanoClaw IPC MCP server (`mcp__nanoclaw`) always injected separately -- NOT configurable via mcpServers config
- Env var expansion in MCP server args: Claude's discretion

### Server types and scope
- Support both stdio servers (local commands via stdin/stdout) and network/SSE servers (remote via URL)
- Config servers are ADDITIONAL to the user's global Claude MCP servers (~/.claude/settings.json), not replacements
- All groups get the same MCP server config (filtered only by execution mode)
- Example servers for template: Context7 (docs), filesystem tools

### Claude's Discretion
- Startup log format (structured pino JSON vs human-readable summary) -- fit existing logging style
- Env var expansion for MCP server args/command -- whether to reuse Phase 2's ${VAR} expansion or keep fields literal
- Per-group MCP differentiation for now (global config applies to all groups; per-group overrides can come in Phase 8)
- Exact NanoClaw-specific fields in server definition (beyond command, args, modes)
- How to translate NanoClaw MCP format to Claude SDK format at runtime

</decisions>

<specifics>
## Specific Ideas

- User plans to configure Context7 (library documentation MCP) and filesystem tools as real use cases
- Both stdio and network/SSE servers need to be supported from the start
- The format should be NanoClaw's own, not a copy of Claude's settings.json format -- gives freedom to add mode tags and other metadata without being constrained by Claude's schema

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 06-mcp-server-configuration-and-filtering*
*Context gathered: 2026-02-08*
