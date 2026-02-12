---
phase: 07-mcp-inheritance-and-health-checks
verified: 2026-02-11T22:45:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 7: MCP Inheritance and Health Checks Verification Report

**Phase Goal:** Host mode agents inherit the user's full MCP ecosystem from global settings, and startup reports the health of all configured servers

**Verified:** 2026-02-11T22:45:00Z

**Status:** passed

**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Host mode main group agents load global MCP servers from ~/.claude/settings.json via SDK settingSources | ✓ VERIFIED | settingSources set to ['project', 'user'] for main groups (line 345-346), ['project'] for non-main. SDK loads global servers automatically. |
| 2 | Startup logs show config servers and global servers in separate sections | ✓ VERIFIED | logMcpServerSources() called at line 341, logs "Config (nanoclaw.config.jsonc)" and "Global (~/.claude/settings.json)" separately |
| 3 | Startup logs show per-server health status (connected/failed) from SDK init message | ✓ VERIFIED | init handler (lines 421-438) logs mcp_servers with [OK]/[FAIL]/status labels per server |
| 4 | Health check timing is logged | ✓ VERIFIED | queryStartMs captured at line 411, initMs computed at line 422, logged in health header: "MCP Server Health (XXXms)" |
| 5 | Health checks do not block startup | ✓ VERIFIED | Health status logged from SDK init message (async event in query loop), agent continues processing after logging. No blocking probe code exists. |
| 6 | Non-main groups do NOT get global MCP server inheritance | ✓ VERIFIED | Global reading conditional at line 336: `(isMain && NANOCLAW_MODE === 'host')`. Non-main groups get empty globalServerNames array. settingSources for non-main is ['project'] only. |
| 7 | Config servers take precedence over global servers on name collision | ✓ VERIFIED | logMcpServerSources() computes overriddenNames (line 145) and logs "Overridden by config" section. SDK behavior: mcpServers option takes precedence over settingSources-loaded servers. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `container/agent-runner/src/mcp-filter.ts` | Exports readGlobalMcpServerNames() and logMcpServerSources() | ✓ VERIFIED | 169 lines, exports at lines 109 and 136. Reads settings.json, logs config vs global sources with override detection. No stubs/TODOs. |
| `container/agent-runner/src/index.ts` | Global server reading, source logging, health status logging from init | ✓ VERIFIED | 512 lines, imports new functions (line 10), calls readGlobalMcpServerNames (line 337), logMcpServerSources (line 341), logs mcp_servers from init (lines 421-438). No stubs/TODOs. |

**Artifact Verification Details:**

**mcp-filter.ts (169 lines)**
- Level 1 (Exists): ✓ EXISTS
- Level 2 (Substantive): ✓ SUBSTANTIVE (169 lines, no stub patterns, exports readGlobalMcpServerNames and logMcpServerSources)
- Level 3 (Wired): ✓ WIRED (imported and called by index.ts line 10, 337, 341)

**index.ts (512 lines)**
- Level 1 (Exists): ✓ EXISTS
- Level 2 (Substantive): ✓ SUBSTANTIVE (512 lines, no stub patterns, full implementation)
- Level 3 (Wired): ✓ WIRED (imports from mcp-filter, reads global servers, logs sources, captures SDK init message)

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| index.ts | mcp-filter.ts | import readGlobalMcpServerNames, logMcpServerSources | ✓ WIRED | Line 10: `import { filterMcpServersByMode, readGlobalMcpServerNames, logMcpServerSources, NanoClawMcpServer } from './mcp-filter.js'` |
| index.ts | ~/.claude/settings.json | readGlobalMcpServerNames() | ✓ WIRED | Line 337 calls readGlobalMcpServerNames(), which reads CLAUDE_CONFIG_DIR/settings.json (mcp-filter.ts line 112). Conditional: only main+host mode. |
| index.ts | SDK init message | message.mcp_servers | ✓ WIRED | Line 423 type-casts message to extract mcp_servers field, lines 424-438 log per-server health with timing |

**Additional Wiring Checks:**

**Global inheritance restricted to main+host:**
```typescript
const globalServerNames = (isMain && NANOCLAW_MODE === 'host')
  ? readGlobalMcpServerNames()
  : [];
```
Verified at lines 334-338. Non-main groups get empty array.

**settingSources unchanged:**
```typescript
const settingSources: ('project' | 'user')[] =
  isMain ? ['project', 'user'] : ['project'];
```
Verified at lines 345-346. Main groups keep ['project', 'user'] for SDK global loading, non-main stay ['project'] only.

**Health status from SDK init, not custom probes:**
No custom MCP connection code exists. Health status comes entirely from SDK's init message (line 423: `message.mcp_servers`), which is non-blocking (captured in async query loop).

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| MCP-04: Host mode uses settingSources: ['user', 'project'] to inherit global MCP servers | ✓ SATISFIED | settingSources set to ['project', 'user'] for main groups (line 345-346). SDK loads servers from ~/.claude/settings.json automatically. readGlobalMcpServerNames() reads separately for logging visibility only. |
| MCP-06: Startup attempts to connect to each configured MCP server and reports status without blocking | ✓ SATISFIED | SDK init message mcp_servers field logged (lines 421-438) with per-server status (connected/failed/pending). Timing logged (initMs). Logging happens in async loop, does not block agent startup. Agent continues even if servers fail. |

### Anti-Patterns Found

No blocking anti-patterns found.

**Checked patterns:**
- TODO/FIXME comments: None in modified files
- Placeholder content: None
- Empty implementations (return null/{}): Intentional fallback in readGlobalMcpServerNames() (returns [] on file-not-found or parse error, which is correct error handling)
- Console.log only: No stub handlers

**Build verification:**
- TypeScript compilation: ✓ Clean (npx tsc --noEmit passed)
- Built files: ✓ Up-to-date (dist/ timestamp Feb 11 22:02, source Feb 11 22:01)
- Exports present: ✓ readGlobalMcpServerNames and logMcpServerSources exported from mcp-filter.ts

### Human Verification Required

None. All truths are structurally verifiable from code inspection:

1. **settingSources configuration** — hardcoded constant, verified in source
2. **Separate logging sections** — logMcpServerSources() implementation inspected, section headers confirmed
3. **Per-server health status** — init handler code inspected, status logging loop confirmed
4. **Timing** — queryStartMs and initMs calculation verified in source
5. **Non-blocking** — no await/blocking probe code exists, health logged from async SDK message
6. **Non-main restriction** — conditional checked: `(isMain && NANOCLAW_MODE === 'host')`
7. **Config precedence** — SDK behavior (mcpServers option overrides settingSources), override detection in logMcpServerSources()

**Note:** Functional testing (actually running in host mode and observing logs) would confirm runtime behavior, but structural verification shows all required code exists and is wired correctly. The phase goal is achieved at the code level.

### Summary

Phase 7 goal fully achieved. All must-haves verified:

**Inheritance:**
- Host mode main groups use settingSources: ['project', 'user'] to load global MCP servers from ~/.claude/settings.json via SDK
- readGlobalMcpServerNames() reads settings.json separately for logging visibility (not for loading — SDK handles that)
- Non-main groups restricted to ['project'] only (security boundary preserved from Phase 5)
- Global reading conditional: `(isMain && NANOCLAW_MODE === 'host')`

**Logging:**
- logMcpServerSources() logs config vs global servers in separate sections
- Override detection: global servers shadowed by same-named config servers logged as "Overridden by config"
- Mode-filtered servers logged with reason

**Health checks:**
- SDK init message mcp_servers field captured and logged with per-server status
- Status labels: 'connected' → [OK], others → [FAIL]/[PENDING]/uppercase status
- Timing logged: query start to init message (initMs)
- Summary line: "All X servers connected" or "Warning: X/Y MCP servers not connected"
- Non-blocking: logged in async query loop, agent continues on failure

**Security:**
- Non-main groups do not get global inheritance (security boundary maintained)
- settingSources for non-main stays ['project'] only
- Reserved name "nanoclaw" filtered from global list in logMcpServerSources()

All code compiles cleanly, builds successfully, and has no stub patterns. Phase 7 complete.

---

*Verified: 2026-02-11T22:45:00Z*

*Verifier: Claude (gsd-verifier)*
