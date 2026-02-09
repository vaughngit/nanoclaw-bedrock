# Phase 5: Host Mode Security - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Enforce macOS Seatbelt sandbox, IPC authorization, and permission boundaries so host-mode agents can't access files or tools they shouldn't. Main group is exempt from all restrictions. Non-main groups are sandboxed with configurable tool allow-lists. Sandbox violations produce real-time alerts.

</domain>

<decisions>
## Implementation Decisions

### Sandbox strictness
- Denylist approach (permissive baseline): allow everything by default, block known-sensitive paths
- Blocked path categories:
  - Credentials: `~/.ssh`, `~/.aws`, `~/.gnupg`
  - Project secrets: `.env`, `*.pem`, `*.key`
  - System config: `~/.config`, `~/Library`
- Main group is exempt from sandbox entirely (runs unsandboxed, same as today)
- Sandbox is opt-out (enabled by default for non-main groups). Users disable explicitly if needed

### Permission model
- Main group keeps `bypassPermissions` in host mode (same as container mode today)
- Non-main groups do NOT get `bypassPermissions`
- When a non-main agent hits a restriction, it explains to the group chat that it couldn't complete the action due to permissions and suggests contacting admin
- Sandbox violations trigger immediate WhatsApp alert to main group (not batched)
- Violations also logged to group log files for audit trail

### Tool allow-list design
- Two-tier configuration: global default in `nanoclaw.config.jsonc` + per-group override in `registered_groups.json`
- Default tool set for non-main groups: full Claude Code tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch) — no restrictions by default
- Config template lists all available tools with inline comments explaining each, so users can comment out what they want to block
- Per-group overrides in `registered_groups.json` can restrict or expand the global default

### IPC isolation
- Both layers: OS-level Seatbelt sandbox rules restrict filesystem writes to own IPC directory AND application-level validation double-checks (defense in depth)

### Claude's Discretion
- Whether NanoClaw MCP tools (mcp__nanoclaw__*) follow the allow-list or are always available
- Whether IPC cross-group violations trigger WhatsApp alerts or just log (likely just log since these are bugs, not malicious)
- Whether main group can access all groups' IPC directories (likely yes, consistent with main-exempt)
- Whether non-main agents can read other groups' files (likely own-group-only, consistent with denylist sandbox)
- Exact Seatbelt sandbox profile syntax and implementation approach
- How to surface the "explain to group" message when permissions block an action

</decisions>

<specifics>
## Specific Ideas

- User wants visibility into what's being blocked — "any kind of notification so that I know to make changes to the Sandbox"
- Alerts should go to main group chat via WhatsApp so admin sees them in real-time without checking logs
- The agent should tell the group it can't do something, not just silently fail — users need to understand why their request wasn't fulfilled

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-host-mode-security*
*Context gathered: 2026-02-09*
