---
phase: 05-host-mode-security
verified: 2026-02-09T05:45:00Z
status: passed
score: 19/19 must-haves verified
---

# Phase 5: Host Mode Security Verification Report

**Phase Goal:** Host mode agents run within macOS Seatbelt sandbox boundaries, with IPC authorization preventing cross-group access and permission controls matching the safety properties that containers provided

**Verified:** 2026-02-09T05:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Config with hostSecurity section parses and validates correctly | ✓ VERIFIED | HostSecuritySchema in config-loader.ts (lines 17-27), sandbox field with default true, tools array with min(1) validation |
| 2 | Config with invalid hostSecurity fields produces actionable Zod error | ✓ VERIFIED | z.strictObject rejects unknown keys (line 17), min(1) validation on tools array (line 26) |
| 3 | Config without hostSecurity section continues to work (backward compatible) | ✓ VERIFIED | hostSecurity field is optional (line 31), config loads with defaults when absent (lines 179-181) |
| 4 | ContainerInput type includes optional security field for agent-runner consumption | ✓ VERIFIED | container-runner.ts lines 42-46 define security field with sandbox (boolean) and tools (string array) |
| 5 | Config template documents all hostSecurity fields with inline comments | ✓ VERIFIED | nanoclaw.config.jsonc lines 89-146 contain comprehensive documentation for sandbox and tools with usage examples |
| 6 | Non-main groups use permissionMode 'default' instead of 'bypassPermissions' | ✓ VERIFIED | agent-runner/src/index.ts line 347: `permissionMode: isMain ? 'bypassPermissions' as const : 'default' as const` |
| 7 | Non-main groups run with SDK sandbox enabled when security.sandbox is true | ✓ VERIFIED | agent-runner/src/index.ts lines 353-361: sandbox enabled when `!isMain && NANOCLAW_MODE === 'host' && securityConfig?.sandbox !== false` |
| 8 | Non-main groups have tool availability restricted to security.tools when configured | ✓ VERIFIED | agent-runner/src/index.ts lines 325-331: nonMainTools built from securityConfig.tools, applied via `tools` option (lines 342-344) |
| 9 | NanoClaw MCP tools (mcp__nanoclaw__*) are always available regardless of tool allowlist | ✓ VERIFIED | agent-runner/src/index.ts line 326: `'mcp__nanoclaw__*'` always included in nonMainTools array |
| 10 | IPC write operations validate the target directory is within the agent's own IPC namespace | ✓ VERIFIED | ipc-mcp.ts lines 19-26: path.resolve() normalization and startsWith() validation before every write |
| 11 | Non-main groups use settingSources: ['project'] only (no user settings leakage) | ✓ VERIFIED | agent-runner/src/index.ts lines 320-321: `settingSources: isMain ? ['project', 'user'] : ['project']` |
| 12 | Non-main agents explain permission restrictions to the group chat | ✓ VERIFIED | agent-runner/src/index.ts lines 255-264: createPermissionDenialHook() instructs model to use mcp__nanoclaw__send_message for denials (lines 371-373 apply to non-main) |
| 13 | Host-runner passes security config to agent-runner for non-main groups | ✓ VERIFIED | host-runner.ts lines 181-194: security config attached to input.security before stdin write (line 227) |
| 14 | Host-runner does NOT pass security config for main group (main is unrestricted) | ✓ VERIFIED | host-runner.ts line 181: `if (!isMain && securityCtx?.hostSecurity)` — main group gets no security field |
| 15 | Sandbox violation errors in host agent output trigger WhatsApp alert to main group | ✓ VERIFIED | host-runner.ts lines 44-54: isSandboxViolation() pattern matching; lines 341-347: sendSandboxAlert() called on detection |
| 16 | Sandbox violations are logged to the group's log file for audit trail | ✓ VERIFIED | host-runner.ts lines 67-79: writes sandbox-violation-*.log to group's logs directory with timestamp, group, and error |
| 17 | Main group JID is resolved from registeredGroups for alert delivery | ✓ VERIFIED | index.ts lines 328-330: mainGroupJid resolved via `Object.entries(registeredGroups).find(([, g]) => g.folder === MAIN_GROUP_FOLDER)?.[0]` |
| 18 | Security config flows from config to host-runner via index.ts | ✓ VERIFIED | index.ts line 327: `hostSecurity: config.hostSecurity` passed to runHostAgent |
| 19 | Security context passed for scheduled tasks | ✓ VERIFIED | task-scheduler.ts lines 104-117: same security context pattern with hostSecurity and mainGroupJid |

**Score:** 19/19 truths verified (100%)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config-loader.ts` | HostSecurity Zod schema, expanded NanoClawConfig type | ✓ VERIFIED | Lines 17-27: HostSecuritySchema with sandbox/tools; line 31: optional field in NanoClawConfigSchema; line 35: exported type |
| `src/container-runner.ts` | Extended ContainerInput with security field | ✓ VERIFIED | Lines 42-46: security field with sandbox boolean and tools array, inline comment explaining purpose |
| `nanoclaw.config.jsonc` | Uncommented hostSecurity section with documentation | ✓ VERIFIED | Lines 89-146: live hostSecurity section with sandbox: true, comprehensive inline comments explaining sandbox, tools, and usage patterns |
| `container/agent-runner/src/index.ts` | Security-differentiated query options, PreToolUse hook | ✓ VERIFIED | Lines 308-379: security-aware queryOptions with conditional sandbox, tools, permissionMode, settingSources; lines 255-264: createPermissionDenialHook() |
| `container/agent-runner/src/ipc-mcp.ts` | IPC write path validation (defense in depth) | ✓ VERIFIED | Lines 19-26: writeIpcFile validates with path.resolve() and startsWith(); all 7 callers updated (lines 65, 93, 172, 252, 278, 303, 343) |
| `src/host-runner.ts` | Security config resolution, violation detection, alerting | ✓ VERIFIED | Lines 20-24: HostRunnerSecurityContext interface; lines 44-54: isSandboxViolation(); lines 61-112: sendSandboxAlert(); lines 181-194: security config attachment; lines 341-347: violation detection |
| `src/index.ts` | Main group JID passed to host-runner, config.hostSecurity access | ✓ VERIFIED | Lines 327-332: security context with hostSecurity and mainGroupJid passed to runHostAgent |
| `src/task-scheduler.ts` | Same security context for scheduled tasks | ✓ VERIFIED | Lines 102-117: HostRunnerSecurityContext built and passed to runHostAgent |

**Status:** All artifacts exist, are substantive (not stubs), and are wired correctly.

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| src/config-loader.ts | nanoclaw.config.jsonc | Zod schema validates hostSecurity section | ✓ WIRED | HostSecuritySchema.optional() parses config file hostSecurity section |
| src/container-runner.ts | container/agent-runner/src/index.ts | ContainerInput.security flows via stdin | ✓ WIRED | ContainerInput interface matches on both sides, host-runner writes to stdin (line 227), agent-runner reads from stdin (line 271) |
| src/index.ts | src/host-runner.ts | runHostAgent receives hostSecurity config and mainGroupJid | ✓ WIRED | Lines 327-332 pass security context as fourth parameter, host-runner accepts it (line 118) |
| src/host-runner.ts | container/agent-runner/src/index.ts | ContainerInput.security passed via stdin JSON | ✓ WIRED | Lines 181-194 attach security to input, line 227 writes JSON to stdin, agent-runner parses on line 271 |
| src/host-runner.ts | IPC messages directory (main group) | Writes sandbox alert JSON file | ✓ WIRED | Lines 82-100 write atomic IPC message to main group's messages directory for WhatsApp delivery |
| container/agent-runner/src/index.ts | @anthropic-ai/claude-agent-sdk | SDK query() options: sandbox, tools, permissionMode | ✓ WIRED | Lines 333-379 build queryOptions with security-differentiated fields, passed to query() on line 387 |
| container/agent-runner/src/ipc-mcp.ts | container/agent-runner/src/index.ts | IPC directory passed from main to createIpcMcp | ✓ WIRED | IPC_DIR passed to createIpcMcp on line 286, used for validation on line 22 |

**Status:** All critical links verified and wired correctly.

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| SEC-01: Host mode tool allow-list configurable in config | ✓ SATISFIED | None — config-loader.ts validates tools array, agent-runner applies it |
| SEC-02: IPC authorization (agents only write to own IPC directory) | ✓ SATISFIED | None — ipc-mcp.ts validates all writes against authorized directory |
| SEC-03: Non-main groups do not receive bypassPermissions | ✓ SATISFIED | None — agent-runner uses 'default' mode for non-main (line 347) |
| EXEC-06: Config exposes macOS Seatbelt sandbox settings | ✓ SATISFIED | None — hostSecurity.sandbox field in config, passed to SDK |
| EXEC-07: Sandbox settings prominently documented | ✓ SATISFIED | None — nanoclaw.config.jsonc lines 100-114 explain sandbox with examples |

**Status:** All Phase 5 requirements satisfied.

### Anti-Patterns Found

**No anti-patterns or stub code detected.**

All implementations are substantive:
- Config schema: Full Zod validation with strictObject, type exports, error handling
- Agent-runner: Complete security differentiation with all SDK options configured
- Host-runner: Full violation detection and alerting with atomic IPC writes
- IPC validation: Defense-in-depth path checking on all 7 write operations

### Code Quality Observations

**Positive patterns:**
- Defense-in-depth: IPC validation works alongside OS-level sandbox
- Separation of concerns: Security config in config-loader, enforcement in agent-runner, wiring in host-runner
- Type safety: HostSecurityConfig type shared across modules
- Backward compatibility: Optional hostSecurity field, graceful defaults
- Comprehensive logging: Security config logged on agent startup (agent-runner lines 311-316)
- Atomic operations: IPC alerts use temp+rename pattern (host-runner lines 98-100)
- Clear security boundaries: Main group explicitly exempt, non-main explicitly restricted

**Architecture verification:**
- Security pipeline: config-loader → index.ts → host-runner → agent-runner (via stdin) ✓
- Alert pipeline: host-runner → IPC messages (main group) → existing IPC poller → WhatsApp ✓
- IPC isolation: Each group has own IPC directory, writes validated against base ✓

## Verification Summary

**All 19 must-haves verified:**
- **05-01 (Config Schema):** 5/5 verified
- **05-02 (Agent-Runner Security):** 7/7 verified
- **05-03 (Host-Runner Wiring):** 7/7 verified

**Phase goal achieved:** Host mode agents run within security boundaries. Non-main groups are sandboxed, have tool restrictions, use default permissions, and are isolated via IPC authorization. Violations trigger real-time WhatsApp alerts to the main group with audit trail logging. Main group remains unrestricted for administrative control.

**Implementation quality:** Production-ready. No stubs, no anti-patterns, complete error handling, comprehensive logging, defense-in-depth security layers.

---

_Verified: 2026-02-09T05:45:00Z_  
_Verifier: Claude (gsd-verifier)_
