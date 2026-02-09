---
phase: 04-runner-abstraction-and-host-runner
verified: 2026-02-08T20:30:00Z
status: passed
score: 10/10 must-haves verified
---

# Phase 4: Runner Abstraction and Host Runner Verification Report

**Phase Goal:** Users running in host mode get agents spawned directly on macOS as Node.js subprocesses, using the same IPC protocol and queue integration as container mode

**Verified:** 2026-02-08T20:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When `executionMode` is `"host"`, the app spawns `node container/agent-runner/dist/index.js` directly instead of launching a container | ✓ VERIFIED | index.ts:321-331 routes to runHostAgent(), host-runner.ts:108 spawns node with agentRunnerPath, conditional container check at index.ts:1002-1006 |
| 2 | Host runner uses the same stdin/stdout/sentinel protocol as container-runner for output parsing | ✓ VERIFIED | host-runner.ts:20-21 defines OUTPUT_START_MARKER/OUTPUT_END_MARKER, lines 124-126 send JSON via stdin, lines 264-276 parse sentinel-delimited stdout |
| 3 | Host runner registers spawned processes with GroupQueue for shutdown coordination (same `onProcess` callback pattern) | ✓ VERIFIED | host-runner.ts:119 calls onProcess(proc, null), GroupQueue.registerProcess:111 accepts string \| null for containerName, shutdown logic at group-queue.ts:269-273 handles null containerName with SIGTERM |
| 4 | A message sent to a registered group in host mode produces a response from the agent (end-to-end verification) | ✓ VERIFIED | User confirmed "its responding now", host logs show successful execution (host-2026-02-09T02-20-13-665Z.log exit code 0), multiple host-*.log files confirm subprocess execution |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/host-runner.ts` | runHostAgent() function mirroring runContainerAgent() signature | ✓ VERIFIED | 323 lines, exports runHostAgent (line 32), accepts RegisteredGroup/ContainerInput/onProcess callback, spawns node subprocess (line 108), sentinel parsing (lines 264-276), no stub patterns |
| `package.json` | build:agent script for local agent-runner compilation | ✓ VERIFIED | Line 15: "build:agent": "cd container/agent-runner && npm run build" |
| `container/agent-runner/dist/index.js` | Compiled agent-runner entry point | ✓ VERIFIED | File exists, confirmed via test -f |
| `src/index.ts` | Mode-routed agent invocation and conditional container startup | ✓ VERIFIED | Imports runHostAgent (line 33) and config (line 14), ternary routing at lines 321-331, conditional ensureContainerSystemRunning at lines 1002-1006, execution mode log at line 1010 |
| `src/task-scheduler.ts` | Mode-routed task execution | ✓ VERIFIED | Imports runHostAgent (line 15) and config (line 13), ternary routing at lines 103-113 |
| `src/group-queue.ts` | registerProcess accepts string \| null for containerName | ✓ VERIFIED | Line 111: registerProcess(groupJid: string, proc: ChildProcess, containerName: string \| null), shutdown logic at lines 258-273 handles null with SIGTERM/SIGKILL |
| `container/agent-runner/src/index.ts` | Session resume retry logic | ✓ VERIFIED | Lines 368-392: catch block retries without session on resume failure, handles cross-mode session incompatibility |

**All artifacts:** ✓ VERIFIED (7/7)

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| src/host-runner.ts | container/agent-runner/dist/index.js | child_process.spawn with path.resolve() | ✓ WIRED | Line 40: path.resolve(process.cwd(), 'container/agent-runner/dist/index.js'), line 108: spawn('node', [agentRunnerPath]) |
| src/host-runner.ts | src/container-runner.ts | shared ContainerInput/ContainerOutput types | ✓ WIRED | Line 15: import { ContainerInput, ContainerOutput } from './container-runner.js' |
| src/host-runner.ts | src/group-queue.ts | onProcess callback with null containerName | ✓ WIRED | Line 35: onProcess signature with containerName: null, line 119: onProcess(proc, null) |
| src/index.ts | src/host-runner.ts | import and conditional call based on config.executionMode | ✓ WIRED | Line 33: import { runHostAgent }, lines 321-331: config.executionMode === 'host' ? runHostAgent(...) : runContainerAgent(...) |
| src/index.ts | src/config-loader.ts | named import of config singleton | ✓ WIRED | Line 14: import { config } from './config-loader.js', used at lines 321, 1002, 1010 |
| src/task-scheduler.ts | src/host-runner.ts | import and conditional call | ✓ WIRED | Line 15: import { runHostAgent }, lines 103-113: config.executionMode === 'host' ? runHostAgent(...) : runContainerAgent(...) |
| src/index.ts | ensureContainerSystemRunning | conditional call gated on executionMode | ✓ WIRED | Lines 1002-1006: if (config.executionMode === 'container') { ensureContainerSystemRunning(); } else { logger.info(...) } |

**All key links:** ✓ WIRED (7/7)

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| EXEC-03: Host runner spawns claude directly on macOS as a subprocess | ✓ SATISFIED | None - verified via host-runner.ts spawn() call and mode routing |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | - | - | - |

**Scan results:**
- No TODO/FIXME comments in modified files
- No placeholder content in host-runner.ts
- No empty implementations
- No console.log-only handlers
- Host runner has substantive implementation (323 lines, complete spawn/IPC/timeout/logging logic)

### Human Verification Required

None. All success criteria are programmatically verifiable and have been verified.

End-to-end flow confirmed:
1. Config set to `"executionMode": "host"` in nanoclaw.config.jsonc (line 37)
2. App startup skips container check (index.ts:1002-1006)
3. Message to registered group triggers runHostAgent() (index.ts:321-331)
4. Host runner spawns node subprocess with NANOCLAW_* env vars (host-runner.ts:108)
5. Agent-runner executes with host-mode paths (agent-runner/src/index.ts:28-35)
6. Sentinel-delimited output parsed and returned (host-runner.ts:264-276)
7. Response sent to WhatsApp (confirmed by user: "its responding now")
8. Host logs written to groups/main/logs/host-*.log (multiple files with exit code 0)

### Must-Haves Verification

**Plan 04-01 must-haves:**

| Must-have | Status | Evidence |
|-----------|--------|----------|
| Agent-runner compiles locally via `npm run build:agent` producing container/agent-runner/dist/index.js | ✓ VERIFIED | package.json line 15, dist/index.js exists |
| host-runner.ts spawns node with NANOCLAW_* env vars and reads sentinel-delimited output | ✓ VERIFIED | Lines 75-79 set env vars, lines 264-276 parse sentinel output |
| Host runner has no output size truncation (unlike container runner's CONTAINER_MAX_OUTPUT_SIZE) | ✓ VERIFIED | No MAX_OUTPUT or truncation logic in host-runner.ts, stdout accumulates without limits (line 130) |
| Host runner registers spawned process with GroupQueue via onProcess callback with null containerName | ✓ VERIFIED | Line 119: onProcess(proc, null) |
| GroupQueue.registerProcess accepts string \| null for containerName without type errors | ✓ VERIFIED | group-queue.ts:111 signature, npx tsc --noEmit passes with no errors |

**Plan 04-02 must-haves:**

| Must-have | Status | Evidence |
|-----------|--------|----------|
| When executionMode is 'host', the app spawns node agent-runner directly instead of launching a container | ✓ VERIFIED | index.ts:321-331 ternary routing, task-scheduler.ts:103-113 ternary routing |
| When executionMode is 'container', behavior is identical to pre-Phase-4 (no regressions) | ✓ VERIFIED | Container branch unchanged in ternary, ensureContainerSystemRunning still runs when mode='container', TypeScript compiles cleanly |
| ensureContainerSystemRunning() only runs in container mode | ✓ VERIFIED | index.ts:1002-1006 gated behind config.executionMode === 'container' |
| Task scheduler uses host runner in host mode | ✓ VERIFIED | task-scheduler.ts:103-113 routes to runHostAgent when config.executionMode === 'host' |
| A message sent to a registered group in host mode produces a response from the agent | ✓ VERIFIED | User confirmed, host logs show successful execution (exit code 0) |

**All must-haves:** ✓ VERIFIED (10/10)

## Verification Details

### Level 1: Existence
All required files exist:
- ✓ src/host-runner.ts (323 lines)
- ✓ package.json (build:agent script)
- ✓ container/agent-runner/dist/index.js (compiled)
- ✓ src/index.ts (modified with routing)
- ✓ src/task-scheduler.ts (modified with routing)
- ✓ src/group-queue.ts (type signature updated)
- ✓ container/agent-runner/src/index.ts (session retry added)

### Level 2: Substantive
All files have real implementations:
- ✓ host-runner.ts: 323 lines, complete spawn/env/IPC/timeout/logging logic
- ✓ No stub patterns (TODO/FIXME/placeholder) found
- ✓ Allowlist-based env filtering (lines 24-30, 70-72)
- ✓ Sentinel output parsing (lines 264-276)
- ✓ Timeout handling with SIGTERM/SIGKILL (lines 146-164)
- ✓ Log file writing with host- prefix (lines 196-239)
- ✓ Error handling for spawn failures (lines 310-321)

### Level 3: Wired
All components are connected:
- ✓ host-runner imported by index.ts (line 33) and task-scheduler.ts (line 15)
- ✓ config imported by index.ts (line 14) and task-scheduler.ts (line 13)
- ✓ Ternary routing at both callsites (index.ts:321, task-scheduler.ts:103)
- ✓ Conditional container startup (index.ts:1002-1006)
- ✓ onProcess callback wired to GroupQueue.registerProcess with null containerName
- ✓ Session resume retry wired in agent-runner (lines 368-392)

### Execution Evidence
Host mode has executed successfully:
- Multiple host-*.log files in groups/main/logs/
- Most recent: host-2026-02-09T02-20-13-665Z.log (exit code 0, duration 13615ms)
- Log shows correct env vars: NANOCLAW_MODE=host, NANOCLAW_GROUP_DIR, NANOCLAW_IPC_DIR, CLAUDE_CONFIG_DIR
- Sentinel markers present in stdout
- User confirmation: "its responding now"

### TypeScript Compilation
```
npx tsc --noEmit
```
**Result:** Clean (no errors)

### Session Resume Retry
Agent-runner includes retry logic (lines 368-392):
- Catches session resume failures
- Retries without session to handle cross-mode incompatibility
- Handles container-mode session IDs that lack host-mode transcript files
- Prevents Claude Code SDK exit code 1 crash

---

## Summary

Phase 4 successfully delivers host-mode agent execution with all must-haves verified:

**Infrastructure:**
- ✓ build:agent script compiles agent-runner locally
- ✓ host-runner.ts implements complete subprocess spawning with allowlist env filtering
- ✓ GroupQueue accepts null containerName for host mode
- ✓ TypeScript compiles cleanly

**Routing:**
- ✓ index.ts routes to correct runner based on config.executionMode
- ✓ task-scheduler.ts routes to correct runner based on config.executionMode
- ✓ Container system startup is conditional on container mode
- ✓ Execution mode logged at startup

**Protocol:**
- ✓ Host runner uses stdin/stdout/sentinel protocol matching container-runner
- ✓ No output size limits in host mode
- ✓ Timeout handling with SIGTERM/SIGKILL
- ✓ Log files written with host- prefix

**Robustness:**
- ✓ Session resume retry handles cross-mode incompatibility
- ✓ Agent-runner works with host-mode env vars
- ✓ Error handling for missing agent-runner dist
- ✓ Allowlist-based env var security

**End-to-End:**
- ✓ User confirmed host mode responds to messages
- ✓ Host logs show successful execution (exit code 0)
- ✓ Multiple host-*.log files confirm repeated execution
- ✓ No regressions in container mode

**Phase goal achieved:** Users running in host mode get agents spawned directly on macOS as Node.js subprocesses, using the same IPC protocol and queue integration as container mode.

---

_Verified: 2026-02-08T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
