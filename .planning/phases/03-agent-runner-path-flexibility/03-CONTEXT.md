# Phase 3: Agent-Runner Path Flexibility - Context

**Gathered:** 2026-02-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the agent-runner code path-configurable via environment variables so the same codebase runs inside containers (with `/workspace/*` defaults) or on the host (with absolute macOS paths). This is a backward-compatible refactor -- container mode must work identically after changes. No new execution modes are added (that's Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Path variable design
- Claude determines which paths need to be configurable by examining the agent-runner codebase (at minimum: IPC dir, group dir, global dir, CLAUDE_HOME)
- Claude determines naming convention based on codebase patterns
- Claude determines whether host runner (Phase 4) sets vars explicitly or agent-runner reads from process.env
- Path env vars should be documented in nanoclaw.config.jsonc as a commented section explaining how host mode uses them

### Default fallback strategy
- When env vars are unset, fall back to /workspace/* paths (container defaults) -- backward compatibility is non-negotiable
- If a configured path doesn't exist, create it automatically (mkdir -p) -- reduces friction for first-time host mode setup

### IPC directory behavior
- Claude determines whether to use per-group subdirectories or flat structure based on current implementation
- Claude determines scope: this phase makes IPC path configurable, per-group isolation logic may defer to Phase 5 (Security) if appropriate
- Claude determines whether file-based IPC is optimal for both modes or if a better mechanism exists for host mode

### Container rebuild scope
- Agent-runner TypeScript compilation must be verified separately (not just main app tsc)

### Claude's Discretion
- Which specific paths need env vars (examine agent-runner code to determine full list)
- Naming convention for env vars (NANOCLAW_ prefix vs other)
- How env vars are passed (host runner sets them vs process.env inheritance)
- Path validation approach (absolute-only vs accept relative)
- Logging strategy for fallback defaults (silent vs log notice)
- Whether container rebuild happens in this phase or defers to Phase 4
- Whether Dockerfile/build.sh need changes
- Testing approach for backward compatibility (manual vs automated)
- IPC directory structure and isolation scope

</decisions>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches. User wants Claude to examine the agent-runner codebase and make implementation decisions based on what the code actually needs.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 03-agent-runner-path-flexibility*
*Context gathered: 2026-02-07*
