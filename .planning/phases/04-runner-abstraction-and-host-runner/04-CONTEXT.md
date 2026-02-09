# Phase 4: Runner Abstraction and Host Runner - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Spawn Claude agents directly on macOS as Node.js subprocesses when `executionMode` is `"host"`, using the same stdin/stdout/sentinel protocol and queue integration as container mode. Container mode remains unchanged. Security (sandbox, permissions) is Phase 5 — this phase is about getting the process spawning and IPC working.

</domain>

<decisions>
## Implementation Decisions

### Runner interface design
- Create a separate `host-runner.ts` module alongside `container-runner.ts` (not a shared abstraction)
- Mode-routing logic (which runner to call) is Claude's discretion — can live at call site in index.ts or in a thin router module
- Type naming (ContainerInput/Output vs generic RunnerInput/Output) is Claude's discretion — pick the pragmatic option
- Agent-runner directory location (keep in `container/` vs move) is Claude's discretion — minimize churn

### Process lifecycle
- Timeout behavior is Claude's discretion — determine appropriate timeout strategy for host mode
- Shutdown strategy is Claude's discretion — choose the most reliable approach for Node.js subprocess management
- Crash recovery is Claude's discretion — determine based on how container mode handles it today
- Output size limits: use higher or no limits for host mode (not the same CONTAINER_MAX_OUTPUT_SIZE) — local processes are less constrained on memory

### Environment setup
- Auth credentials: Claude's discretion on how to pass credentials to the subprocess (inherit vs filtered env)
- Working directory: Claude's discretion — determine based on how main vs non-main group mounts work today in container mode
- Claude config directory: share the user's real `~/.claude` (not isolated per group like container mode) — host mode agents inherit the user's global MCP servers and settings
- Directory creation (IPC dirs, etc.): Claude's discretion — determine what's needed for clean startup vs what agent-runner already handles

### Logging and diagnostics
- Per-run log files: Claude's discretion
- Log content emphasis: Claude's discretion — determine what's useful for debugging host mode
- Stderr handling: Claude's discretion — stream vs buffer based on current container behavior
- Mode tagging in logs: Claude's discretion

### Claude's Discretion
Claude has significant flexibility in this phase. The user's key locked decisions are:
1. **Separate module** — `host-runner.ts` alongside `container-runner.ts`, not a shared abstraction
2. **Higher output limits** — host mode should not be constrained by CONTAINER_MAX_OUTPUT_SIZE
3. **Shared ~/.claude** — host mode agents share the user's real Claude config directory

Everything else (routing, types, timeouts, shutdown, logging) can be determined based on codebase patterns and best practices.

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. The core success criteria from the roadmap are clear:
1. `executionMode: "host"` spawns `node container/agent-runner/dist/index.js` directly
2. Same stdin/stdout/sentinel protocol as container-runner
3. Registers with GroupQueue via `onProcess` callback
4. End-to-end: message in host mode produces agent response

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-runner-abstraction-and-host-runner*
*Context gathered: 2026-02-08*
