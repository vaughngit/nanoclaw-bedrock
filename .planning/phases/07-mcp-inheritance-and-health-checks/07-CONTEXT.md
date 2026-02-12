# Phase 7: MCP Inheritance and Health Checks - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Host mode agents inherit the user's full MCP ecosystem from global settings (~/.claude/settings.json), merged with config-defined servers from nanoclaw.config.jsonc. Startup probes each configured MCP server and reports health status before passing them to the SDK. Health checks are non-blocking -- the agent always starts regardless of server failures.

</domain>

<decisions>
## Implementation Decisions

### Global MCP inheritance
- Merge both sources: config servers (nanoclaw.config.jsonc) AND global servers (~/.claude/settings.json) both load
- Config servers take precedence on name collision
- Global inheritance is for host mode (containers can't see ~/.claude)
- Log global and config servers in separate sections so the user can see where each comes from

### Health check behavior
- Pre-flight probing: independently spawn/connect each MCP server before passing to query()
- Probes run in parallel (total wait = slowest server, not sum of all)
- Failed servers are still passed to the SDK (report failure but let SDK try anyway -- server may recover)
- Non-blocking: agent always starts regardless of probe results

### Startup logging and reporting
- Config servers and global servers logged in separate sections for clarity
- Health results appear in agent-runner stderr (existing pattern)

### Failure handling
- Failed servers still passed to SDK (report-only, non-blocking)
- Agent always runs with at least the IPC MCP server, even if all others fail

### Claude's Discretion
- Probe timeout duration (balance between npx cold-starts and dead server detection)
- Whether to include timing info in health logs (e.g., "connected in 320ms")
- Log format (per-server lines vs summary table) -- fit existing agent-runner logging style
- Whether global MCP inheritance applies to non-main groups (security trade-off: non-main currently uses settingSources ['project'] only)
- Whether to use SDK settingSources or manual ~/.claude/settings.json reading for inheritance
- Whether container mode should also get global servers injected (future consideration)
- Whether MCP failures warrant WhatsApp alerts (security events vs infrastructure)
- Circuit breaker behavior for repeatedly failing servers
- Severity of total MCP failure (all servers down) -- log-only vs prominent warning
- Whether to pre-check binary existence on PATH for stdio servers before spawning

</decisions>

<specifics>
## Specific Ideas

- User wants visibility into which servers are healthy at startup -- not just "configured" but actually reachable
- Pre-flight probing chosen over passive SDK reporting because it gives explicit health status before the agent starts working
- Parallel probing chosen to minimize startup latency impact

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 07-mcp-inheritance-and-health-checks*
*Context gathered: 2026-02-10*
