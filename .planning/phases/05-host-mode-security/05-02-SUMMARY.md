---
phase: 05-host-mode-security
plan: 02
subsystem: security
tags: [sandbox, seatbelt, permissions, tool-allowlist, ipc-validation, host-mode, claude-agent-sdk]

# Dependency graph
requires:
  - phase: 05-host-mode-security
    provides: "HostSecuritySchema, ContainerInput.security field, HostSecurityConfig type"
  - phase: 04-runner-abstraction-and-host-runner
    provides: "host-runner subprocess model, ContainerInput IPC contract"
provides:
  - "Security-differentiated query options in agent-runner (sandbox, permissions, tools)"
  - "IPC write path validation (defense in depth against cross-group writes)"
  - "PreToolUse hook for non-main permission denial messaging"
  - "settingSources isolation for non-main groups"
affects:
  - 05-host-mode-security  # Plan 03 depends on security being enforced
  - 08-per-group-overrides  # Per-group security overrides will modify these options

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional spread for query option differentiation (...(!isMain ? {...} : {}))"
    - "Defense-in-depth IPC path validation using path.resolve() + startsWith()"
    - "PreToolUse hook for runtime permission denial messaging"

key-files:
  created: []
  modified:
    - container/agent-runner/src/index.ts
    - container/agent-runner/src/ipc-mcp.ts

key-decisions:
  - "tools (not allowedTools) for non-main groups -- tools restricts availability, allowedTools only auto-approves"
  - "mcp__nanoclaw__* always included via wildcard -- ensures IPC communication regardless of tool restrictions"
  - "settingSources ['project'] only for non-main -- prevents shared ~/.claude user settings from leaking across groups"
  - "sandbox only enabled in host mode (NANOCLAW_MODE === 'host') -- container mode has its own isolation"
  - "allowUnsandboxedCommands: false -- prevents model from bypassing sandbox via dangerouslyDisableSandbox"

patterns-established:
  - "Security differentiation via isMain flag: main=unrestricted, non-main=restricted"
  - "IPC write validation as defense-in-depth layer alongside OS sandbox"

# Metrics
duration: 4min
completed: 2026-02-09
---

# Phase 5 Plan 2: Agent-Runner Security Enforcement Summary

**Security-differentiated query options with sandbox/permissions/tool-allowlist for non-main groups, IPC path validation, and permission denial PreToolUse hook**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-09T04:34:34Z
- **Completed:** 2026-02-09T04:38:32Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Agent-runner differentiates security between main and non-main groups via isMain flag
- Non-main groups get: permissionMode 'default', tools allowlist (positive restriction), sandbox enabled in host mode, settingSources ['project'] only
- Main group gets: permissionMode 'bypassPermissions', no tool restrictions (SDK defaults), no sandbox, settingSources ['project', 'user']
- IPC writeIpcFile validates target directory is within authorized namespace (defense in depth)
- PreToolUse hook instructs non-main agents to explain permission denials via mcp__nanoclaw__send_message
- NanoClaw MCP tools (mcp__nanoclaw__*) always available regardless of tool allowlist

## Task Commits

Each task was committed atomically:

1. **Task 1: Security-differentiated query options in agent-runner** - `df7ce62` (feat)
2. **Task 2: IPC write path validation in ipc-mcp.ts** - `32601e5` (feat)

## Files Created/Modified
- `container/agent-runner/src/index.ts` - Security-aware query options: sandbox, permissionMode, tools, settingSources, PreToolUse hook, security logging
- `container/agent-runner/src/ipc-mcp.ts` - writeIpcFile with baseIpcDir parameter and path.resolve() validation, all 7 callers updated

## Decisions Made
- Used `tools` (positive allowlist restricting tool availability) instead of `allowedTools` (which only auto-approves without restricting). Critical distinction from SDK research.
- NanoClaw MCP tools included via `mcp__nanoclaw__*` wildcard in non-main tool list -- agents always need IPC communication tools regardless of security restrictions.
- settingSources for non-main is `['project']` (no `'user'`) to prevent shared ~/.claude user settings from leaking permissions across groups. Main gets both `['project', 'user']`.
- Sandbox only applies in host mode (`NANOCLAW_MODE === 'host'`) since container mode has its own filesystem isolation via Apple Containers.
- `allowUnsandboxedCommands: false` prevents the model from setting `dangerouslyDisableSandbox: true` on Bash tool calls to escape the Seatbelt sandbox.
- IPC path validation uses `path.resolve()` for normalization and `startsWith(base + path.sep)` for containment check -- prevents path traversal attacks.

## Deviations from Plan

None - plan executed exactly as written.

Note: Uncommitted host-runner security context wiring (commit `804bfc4`, labeled 05-03) was discovered in the working tree but had already been committed by a concurrent process. No action needed.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Security enforcement is active in agent-runner for all query options
- IPC writes are validated against authorized namespace
- Ready for Plan 03 (end-to-end verification and integration testing)
- Host-runner already wires security context through to agent-runner (commit 804bfc4)
- All verification criteria pass: build clean, code review confirms correct security differentiation

---
*Phase: 05-host-mode-security*
*Completed: 2026-02-09*
