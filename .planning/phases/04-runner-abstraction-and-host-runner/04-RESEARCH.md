# Phase 4: Runner Abstraction and Host Runner - Research

**Researched:** 2026-02-08
**Domain:** Node.js subprocess spawning, IPC protocol reuse, process lifecycle management
**Confidence:** HIGH

## Summary

Phase 4 creates a `host-runner.ts` module that spawns the existing agent-runner as a native macOS Node.js subprocess instead of inside an Apple Container. The core challenge is modest: the agent-runner was already made path-configurable in Phase 3 (env vars with `/workspace/*` defaults), so host mode just needs to spawn `node container/agent-runner/dist/index.js` with the right environment variables and reuse the same stdin/stdout/sentinel protocol that container-runner already uses.

The codebase is well-prepared for this change. The GroupQueue shutdown logic already has a branch for non-container processes (line 269-272 of `group-queue.ts`: when `containerName` is falsy, it sends SIGTERM directly to the process instead of running `container stop`). The sentinel-based output parsing (`---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---`) works identically regardless of how the subprocess was spawned. The IPC file exchange (per-group directories under `data/ipc/{folder}/`) is host-side infrastructure that works for both modes.

The main implementation work is: (1) a new `host-runner.ts` that mirrors `container-runner.ts` but spawns `node` instead of `container`, (2) routing logic in `index.ts` to call the right runner based on `config.executionMode`, (3) ensuring the agent-runner is compiled locally (not just in Docker), and (4) wiring up task-scheduler.ts to use the same routing.

**Primary recommendation:** Create `src/host-runner.ts` as a separate module mirroring the structure of `container-runner.ts`. Use the same `ContainerInput`/`ContainerOutput` types (rename would cause churn across 5+ files). Route at the call sites in `index.ts` and `task-scheduler.ts` based on `config.executionMode`. Compile agent-runner locally as a prerequisite build step.

## Standard Stack

### Core

No new libraries needed. This phase uses only Node.js built-ins:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `child_process.spawn` | Node.js built-in (v25.5.0) | Spawn agent-runner as subprocess | Native Node.js API, already used by container-runner |
| `fs` | Node.js built-in | Directory creation, log file writing | Same patterns as container-runner |
| `path` | Node.js built-in | Absolute path resolution | Same patterns as container-runner |

### Supporting

No additional libraries. The host-runner uses the same dependencies already in the project.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `spawn()` | `fork()` | fork() is for Node.js child processes with IPC channel; unnecessary since agent-runner uses stdin/stdout protocol, not Node IPC. fork() also forces the child to be a Node.js script, which spawn() already achieves with `node` as the command. |
| `spawn()` | `execa` library | Would add a dependency for marginal benefit. container-runner already uses raw spawn() successfully. |
| Manual timeout | `spawn({ timeout })` option | The built-in timeout option (added v15.13.0) is simpler but container-runner uses manual setTimeout for the graceful stop pattern (SIGTERM then SIGKILL). Host runner should follow the same pattern for consistency. |

**Installation:**
```bash
# No new packages needed. But agent-runner must be compiled locally:
cd container/agent-runner && npm run build
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  container-runner.ts   # Existing: spawns `container run -i` (UNCHANGED)
  host-runner.ts        # NEW: spawns `node container/agent-runner/dist/index.js`
  config-loader.ts      # Existing: exports config.executionMode (UNCHANGED)
  index.ts              # MODIFIED: imports config, routes to correct runner
  task-scheduler.ts     # MODIFIED: accepts runner function, routes similarly
  group-queue.ts        # MODIFIED: containerName type becomes string | null
  types.ts              # Possibly MODIFIED: shared types if renamed

container/
  agent-runner/
    dist/               # NEW: locally compiled JS (host mode prerequisite)
    src/
      index.ts          # UNCHANGED (already path-configurable from Phase 3)
      ipc-mcp.ts        # UNCHANGED
```

### Pattern 1: Parallel Module (host-runner.ts mirrors container-runner.ts)

**What:** Create host-runner.ts with the same function signature as container-runner's `runContainerAgent()`, but spawning `node` instead of `container`.

**When to use:** When two implementations share the same interface but have different execution strategies.

**Why this over shared abstraction:** The user explicitly decided against a shared runner abstraction. Two separate modules are easier to understand, debug, and modify independently. The duplication is minimal (the core differences are in spawn args, env setup, and timeout handling -- maybe 30 lines differ).

**Example:**
```typescript
// Source: Codebase analysis of src/container-runner.ts (lines 195-467)
// host-runner.ts follows the same structure

import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';
import { logger } from './logger.js';
import { ContainerInput, ContainerOutput } from './container-runner.js';
import { RegisteredGroup } from './types.js';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Host mode timeout: same default as container, but configurable
const HOST_TIMEOUT = parseInt(process.env.HOST_TIMEOUT || '300000', 10);

export async function runHostAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string | null) => void,
): Promise<ContainerOutput> {
  // ... spawn node with env vars, same stdin/stdout/sentinel protocol
}
```

### Pattern 2: Call-Site Routing (not a factory)

**What:** Import both runners in `index.ts` and `task-scheduler.ts`, branch on `config.executionMode` at each call site.

**When to use:** When there are only 2 call sites and the routing logic is a single `if` statement.

**Why not a factory:** A factory module adds indirection for a trivial branch. The config is a frozen singleton read once. Call-site routing is explicit and easy to trace.

**Example:**
```typescript
// Source: Codebase analysis of src/index.ts (lines 310-321)
// In runAgent(), route based on config.executionMode

import { config } from './config-loader.js';
import { runContainerAgent } from './container-runner.js';
import { runHostAgent } from './host-runner.js';

// In runAgent():
const output = config.executionMode === 'host'
  ? await runHostAgent(group, inputData, (proc) => queue.registerProcess(chatJid, proc, null))
  : await runContainerAgent(group, inputData, (proc, name) => queue.registerProcess(chatJid, proc, name));
```

### Pattern 3: Environment Variable Filtering for Subprocess

**What:** Pass a curated set of environment variables to the agent-runner subprocess, not the full `process.env`.

**When to use:** When the subprocess should receive auth credentials but not other sensitive or conflicting env vars.

**Example:**
```typescript
// Source: Codebase analysis of container-runner.ts (lines 137-148) - allowedVars pattern
// Host mode: inherit filtered env vars directly (no env file indirection needed)

const allowedVars = [
  'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
  'CLAUDE_CODE_USE_BEDROCK', 'AWS_REGION', 'AWS_BEDROCK_CROSS_REGION',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'ASSISTANT_NAME',
];

const childEnv: Record<string, string> = {};
// Include PATH so `node`, `claude`, and other tools are available
childEnv.PATH = process.env.PATH || '';
childEnv.HOME = process.env.HOME || '';
// Copy allowed auth vars
for (const key of allowedVars) {
  if (process.env[key]) childEnv[key] = process.env[key];
}
// Add NanoClaw-specific path vars
childEnv.NANOCLAW_GROUP_DIR = groupDir;
childEnv.NANOCLAW_GLOBAL_DIR = globalDir;
childEnv.NANOCLAW_IPC_DIR = ipcDir;
childEnv.NANOCLAW_MODE = 'host';
// Shared ~/.claude (user decision: host mode shares real config)
// Do NOT set CLAUDE_CONFIG_DIR -- let it default to ~/.claude
```

### Anti-Patterns to Avoid

- **Shared abstract runner class/interface:** The user explicitly decided against a shared abstraction. Two separate modules with the same function signature is the right approach. Don't create `runner.ts`, `RunnerStrategy`, or any polymorphism layer.

- **Inheriting full process.env:** Container-runner already filters env vars to an allowlist. Host-runner should do the same, plus add PATH and HOME. Passing full `process.env` would leak sensitive vars like SLACK_BOT_TOKEN to the agent subprocess.

- **Setting CLAUDE_CONFIG_DIR for per-group isolation:** The user's locked decision is that host mode agents share `~/.claude`. Do NOT set `CLAUDE_CONFIG_DIR` to `data/sessions/{group}/.claude`. This is different from container mode which isolates sessions. The user wants host agents to inherit global MCP servers and settings.

- **Using `fork()` instead of `spawn()`:** fork() creates an IPC channel we don't need. The agent-runner uses stdin/stdout for communication, not Node's built-in IPC. fork() also requires the target to be a `.js` file (which it is, but spawn() is more flexible and matches the existing container-runner pattern).

- **Modifying container-runner.ts:** The user explicitly said container mode remains unchanged. Don't refactor container-runner to share code with host-runner.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Output parsing | Custom stdout parser | Reuse sentinel marker pattern from container-runner (lines 411-426) | The `OUTPUT_START_MARKER`/`OUTPUT_END_MARKER` pattern is proven and used by both sides. Copy the parsing logic. |
| Process shutdown coordination | Custom process tracker | GroupQueue's existing `registerProcess()` + `shutdown()` | GroupQueue already handles SIGTERM/SIGKILL escalation (lines 257-298). The `containerName: null` branch sends SIGTERM directly. |
| IPC directory creation | New directory management | Reuse the same `fs.mkdirSync(dir, { recursive: true })` pattern from container-runner (lines 121-128) | Same per-group IPC directories (`data/ipc/{folder}/messages`, `data/ipc/{folder}/tasks`). Host runner creates them the same way. |
| Auth env var filtering | Custom env filtering | Reuse the `allowedVars` array pattern from container-runner (lines 137-148) | Same auth vars, just passed directly as env instead of written to a file. |

**Key insight:** The host-runner is 80% identical to container-runner. The differences are: (a) `spawn('node', [...])` instead of `spawn('container', [...])`, (b) env vars instead of volume mounts, (c) SIGTERM instead of `container stop`, (d) no output size limits. The sentinel protocol, IPC directories, output parsing, and queue integration are all reused verbatim.

## Common Pitfalls

### Pitfall 1: Agent-Runner Not Compiled Locally
**What goes wrong:** Host mode tries to spawn `node container/agent-runner/dist/index.js` but the `dist/` directory doesn't exist. The container build compiles TypeScript inside Docker, but for host mode the compilation must happen on the host.
**Why it happens:** Currently, `./container/build.sh` runs `tsc` inside the Dockerfile. There's no local build step for the agent-runner. `container/agent-runner/dist/` does not exist in the repo right now.
**How to avoid:** Add a build step that compiles agent-runner locally. Either: (a) add a script in root `package.json` like `"build:agent": "cd container/agent-runner && npm run build"`, or (b) have the host-runner check for `dist/index.js` at startup and error with a clear message. Option (a) is better as a prerequisite in the implementation.
**Warning signs:** `ENOENT` error when spawning the subprocess. Error message: "spawn node ENOENT" or "Cannot find module container/agent-runner/dist/index.js".

### Pitfall 2: GroupQueue registerProcess Type Mismatch
**What goes wrong:** `registerProcess(groupJid, proc, containerName)` requires `containerName: string`. Host mode has no container name. Passing `null` causes a TypeScript error with strict mode.
**Why it happens:** The type was defined for container mode only. The shutdown logic already handles `null` (line 258: `if (containerName)` -- falsy check), but the TypeScript type doesn't allow it.
**How to avoid:** Change the `registerProcess` signature and `GroupState.containerName` type to `string | null`. The shutdown logic already works correctly with null values -- it falls through to the `else` branch that sends SIGTERM directly. This is a minimal, backward-compatible type change.
**Warning signs:** TypeScript compilation error on the `registerProcess` call in host-runner.

### Pitfall 3: Missing PATH in Subprocess Environment
**What goes wrong:** The agent-runner subprocess can't find `claude` (Claude Code binary) or other tools because PATH wasn't included in the filtered environment.
**Why it happens:** Container-runner doesn't pass env vars directly (it uses an env file mount). Host-runner constructs a new env object and might forget to include PATH, HOME, and other critical system vars.
**How to avoid:** Always include `PATH` and `HOME` in the child environment. The agent-runner's `query()` function calls Claude Code which needs to be in PATH (`/opt/homebrew/bin/claude` on this system). Also include `TERM` for proper terminal behavior.
**Warning signs:** Agent errors about "claude: command not found" or SDK initialization failures.

### Pitfall 4: Relative Path for Agent-Runner Script
**What goes wrong:** `spawn('node', ['container/agent-runner/dist/index.js'])` uses a relative path that breaks if the process cwd changes.
**Why it happens:** The path is relative to project root, but Node.js resolves relative paths from the current working directory of the parent process.
**How to avoid:** Use `path.resolve(process.cwd(), 'container/agent-runner/dist/index.js')` or `path.join(projectRoot, 'container/agent-runner/dist/index.js')` to construct an absolute path. The existing container-runner doesn't have this issue because `container` is a system binary found via PATH.
**Warning signs:** `MODULE_NOT_FOUND` error when spawning the subprocess.

### Pitfall 5: Config Singleton Not Yet Imported in Routing Code
**What goes wrong:** `config.executionMode` is used for routing but `config` from `config-loader.ts` is not imported. Currently `index.ts` only imports `config-loader.js` for side effects (line 13).
**Why it happens:** Phases 1-3 loaded and validated the config but no code consumed `executionMode` yet. The named export `config` exists in `config-loader.ts` but is not imported in `index.ts`.
**How to avoid:** Change the import to `import { config } from './config-loader.js'` (named import instead of side-effect import). This automatically triggers the side-effect (module evaluation) AND makes the `config` object available for routing. Remove the bare `import './config-loader.js'` line.
**Warning signs:** TypeScript error "Cannot find name 'config'" or runtime behavior always defaulting to container mode.

### Pitfall 6: task-scheduler.ts Hardcodes Container Runner Import
**What goes wrong:** `task-scheduler.ts` directly imports `runContainerAgent` from `container-runner.ts` (line 13). In host mode, it would still use the container runner for scheduled tasks.
**Why it happens:** The scheduler was written before host mode existed. It has a direct dependency on container-runner.
**How to avoid:** Either: (a) pass the runner function as a dependency (the scheduler already uses dependency injection for `sendMessage`, `registeredGroups`, etc.), or (b) add routing logic inside the scheduler that reads config. Option (a) is cleaner -- add `runAgent: RunAgentFn` to `SchedulerDependencies`.
**Warning signs:** Scheduled tasks always run in container mode even when `executionMode` is `"host"`.

### Pitfall 7: ensureContainerSystemRunning() Blocks Host Mode Startup
**What goes wrong:** `main()` in `index.ts` calls `ensureContainerSystemRunning()` unconditionally (line 992). In host mode, Apple Container is not needed and may not even be installed.
**Why it happens:** The startup sequence was written for container-only mode.
**How to avoid:** Wrap the call in a conditional: `if (config.executionMode === 'container') { ensureContainerSystemRunning(); }`. In host mode, skip the container system check entirely.
**Warning signs:** App crashes on startup in host mode because Apple Container isn't installed, or the container system isn't running.

## Code Examples

### Complete Host Runner Function

```typescript
// Source: Derived from codebase analysis of container-runner.ts (lines 195-467)
// Follows identical structure with host-mode adaptations

export async function runHostAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string | null) => void,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const projectRoot = process.cwd();

  // Resolve paths (same directories container-runner creates for mounts)
  const groupDir = path.resolve(GROUPS_DIR, group.folder);
  const globalDir = path.resolve(GROUPS_DIR, 'global');
  const ipcDir = path.resolve(DATA_DIR, 'ipc', group.folder);

  // Ensure directories exist (host has no volume mount to create them)
  fs.mkdirSync(groupDir, { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(ipcDir, 'tasks'), { recursive: true });

  // Build subprocess environment
  const childEnv: Record<string, string> = {};

  // System essentials
  childEnv.PATH = process.env.PATH || '';
  childEnv.HOME = process.env.HOME || '';
  if (process.env.TERM) childEnv.TERM = process.env.TERM;

  // Auth vars (same allowlist as container-runner)
  const allowedVars = [
    'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
    'CLAUDE_CODE_USE_BEDROCK', 'AWS_REGION', 'AWS_BEDROCK_CROSS_REGION',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
    'ASSISTANT_NAME',
  ];
  for (const key of allowedVars) {
    if (process.env[key]) childEnv[key] = process.env[key]!;
  }

  // NanoClaw path vars (Phase 3 prepared agent-runner for these)
  childEnv.NANOCLAW_GROUP_DIR = groupDir;
  childEnv.NANOCLAW_GLOBAL_DIR = globalDir;
  childEnv.NANOCLAW_IPC_DIR = ipcDir;
  childEnv.NANOCLAW_MODE = 'host';
  // Note: Do NOT set CLAUDE_CONFIG_DIR -- host mode shares ~/.claude (user decision)

  // Resolve agent-runner path
  const agentRunnerPath = path.resolve(projectRoot, 'container/agent-runner/dist/index.js');

  logger.info(
    { group: group.name, isMain: input.isMain, agentRunner: agentRunnerPath },
    'Spawning host agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const proc = spawn('node', [agentRunnerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
      cwd: groupDir,
    });

    // Register with queue for shutdown coordination (null = not a container)
    onProcess(proc, null);

    let stdout = '';
    let stderr = '';

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    // No output size limit for host mode (user decision)
    proc.stdout.on('data', (data) => { stdout += data.toString(); });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ host: group.folder }, line);
      }
      stderr += chunk;
    });

    let timedOut = false;
    const timeoutMs = group.containerConfig?.timeout || HOST_TIMEOUT;

    const timeout = setTimeout(() => {
      timedOut = true;
      logger.error({ group: group.name }, 'Host agent timeout, sending SIGTERM');
      proc.kill('SIGTERM');
      // Grace period before SIGKILL
      setTimeout(() => {
        if (!proc.killed && proc.exitCode === null) {
          logger.warn({ group: group.name }, 'Host agent SIGTERM failed, sending SIGKILL');
          proc.kill('SIGKILL');
        }
      }, 10000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      // Write per-run log file (same pattern as container-runner)
      // ... [log writing code mirrors container-runner lines 330-386]

      if (timedOut) {
        resolve({
          status: 'error',
          result: null,
          error: `Host agent timed out after ${timeoutMs}ms`,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          status: 'error',
          result: null,
          error: `Host agent exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Parse output between sentinel markers (identical to container-runner)
      try {
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
        } else {
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);
        logger.info(
          { group: group.name, duration, status: output.status },
          'Host agent completed',
        );
        resolve(output);
      } catch (err) {
        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse host agent output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        status: 'error',
        result: null,
        error: `Host agent spawn error: ${err.message}`,
      });
    });
  });
}
```

### Routing at Call Site (index.ts)

```typescript
// Source: Codebase analysis of src/index.ts (lines 277-341)
// Replace direct runContainerAgent call with mode-aware routing

import { config } from './config-loader.js';  // Named import (was side-effect only)
import { runContainerAgent } from './container-runner.js';
import { runHostAgent } from './host-runner.js';

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
): Promise<AgentResponse | 'error'> {
  // ... existing setup code (writeTasksSnapshot, writeGroupsSnapshot) ...

  try {
    const output = config.executionMode === 'host'
      ? await runHostAgent(
          group,
          { prompt, sessionId, groupFolder: group.folder, chatJid, isMain },
          (proc, _name) => queue.registerProcess(chatJid, proc, null),
        )
      : await runContainerAgent(
          group,
          { prompt, sessionId, groupFolder: group.folder, chatJid, isMain },
          (proc, containerName) => queue.registerProcess(chatJid, proc, containerName),
        );

    // ... existing output handling (unchanged) ...
  }
}
```

### GroupQueue Type Fix

```typescript
// Source: Codebase analysis of src/group-queue.ts (lines 111-115, 258-272)
// Minimal type change to accommodate host mode

interface GroupState {
  // ...existing fields...
  containerName: string | null;  // Was: string | null (already nullable in state init)
}

registerProcess(groupJid: string, proc: ChildProcess, containerName: string | null): void {
  // Type change only -- implementation unchanged
  const state = this.getGroup(groupJid);
  state.process = proc;
  state.containerName = containerName;
}
```

### Task Scheduler Runner Injection

```typescript
// Source: Codebase analysis of src/task-scheduler.ts (lines 25-31, 92-103)
// Pass runner function as dependency instead of hardcoding import

export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (groupJid: string, proc: ChildProcess, containerName: string | null) => void;
  // NEW: inject the runner function so scheduler uses correct mode
  runAgent: (
    group: RegisteredGroup,
    input: ContainerInput,
    onProcess: (proc: ChildProcess, containerName: string | null) => void,
  ) => Promise<ContainerOutput>;
}
```

### Conditional Container System Check

```typescript
// Source: Codebase analysis of src/index.ts (lines 933-989, 991-992)
// Skip container system check in host mode

async function main(): Promise<void> {
  // Only check container system if we're actually using containers
  if (config.executionMode === 'container') {
    ensureContainerSystemRunning();
  } else {
    // Verify agent-runner is compiled for host mode
    const agentRunnerDist = path.resolve(process.cwd(), 'container/agent-runner/dist/index.js');
    if (!fs.existsSync(agentRunnerDist)) {
      console.error('\n' + '='.repeat(64));
      console.error('  HOST MODE ERROR: Agent runner not compiled');
      console.error('  Run: cd container/agent-runner && npm run build');
      console.error('='.repeat(64) + '\n');
      process.exit(1);
    }
    logger.info('Host mode: agent runner verified at ' + agentRunnerDist);
  }

  // ... rest of main() unchanged ...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `CLAUDE_HOME` env var | `CLAUDE_CONFIG_DIR` env var | 2025-12-01 | Use `CLAUDE_CONFIG_DIR` to redirect session storage. But per user decision, host mode does NOT set this -- agents share `~/.claude`. |
| `child_process.exec()` for subprocesses | `child_process.spawn()` with streams | N/A (both always available) | spawn() is correct for long-running processes with streaming output. exec() buffers all output and has a default maxBuffer limit. |
| `spawn({ timeout })` built-in | Manual `setTimeout` + `kill()` | v15.13.0 | The built-in timeout just kills the process. Manual timeout allows graceful SIGTERM-then-SIGKILL pattern matching container-runner. |

**Deprecated/outdated:**
- `CLAUDE_HOME`: Never implemented. `CLAUDE_CONFIG_DIR` is the correct SDK variable. But irrelevant for this phase since host mode shares `~/.claude` (no redirect needed).

## Open Questions

1. **Should `writeTasksSnapshot` and `writeGroupsSnapshot` be shared between runners?**
   - What we know: Both these functions are defined in `container-runner.ts` but are really IPC infrastructure, not container-specific. Host-runner needs the same functionality.
   - What's unclear: Whether to import them from container-runner (creates a dependency from host-runner to container-runner) or extract them to a shared utilities module.
   - Recommendation: Import from container-runner. They're already exported and don't depend on container-specific behavior. Moving them would be unnecessary churn for this phase. Phase 5 or later can refactor if needed.

2. **Agent-runner local compilation: should it be a prerequisite or automatic?**
   - What we know: Currently `container/agent-runner/dist/` doesn't exist on the host. The Docker build handles compilation for container mode.
   - What's unclear: Whether to add an `npm run build:agent` script to root package.json, or detect and compile at startup, or just error if missing.
   - Recommendation: Add `"build:agent": "cd container/agent-runner && npm run build"` to root package.json, and check for `dist/index.js` existence at startup with a clear error message. Don't auto-compile (surprising behavior).

3. **Should the type rename happen (ContainerInput/Output -> RunnerInput/Output)?**
   - What we know: The types are named `ContainerInput`, `ContainerOutput`, `AgentResponse`. These names are container-specific but are used by both runners now.
   - What's unclear: Whether renaming creates more churn than it's worth. The types are used in container-runner.ts, index.ts, and task-scheduler.ts.
   - Recommendation: Keep the existing names for this phase. The CONTEXT.md says "Type naming is Claude's discretion -- pick the pragmatic option." Renaming would touch 5+ files for cosmetic benefit. A comment noting the types are shared is sufficient.

## Sources

### Primary (HIGH confidence)

- **Codebase analysis** -- All findings are based on direct reading of the source files:
  - `src/container-runner.ts` (467 lines) -- Complete reference for the spawning, IPC, and output parsing patterns
  - `src/group-queue.ts` (300 lines) -- Verified shutdown already handles null containerName at lines 258-272
  - `src/index.ts` (1025 lines) -- Verified call sites for runContainerAgent at lines 311, 320
  - `src/task-scheduler.ts` (192 lines) -- Verified hardcoded container-runner import at line 13
  - `src/config-loader.ts` (227 lines) -- Verified config singleton export pattern
  - `container/agent-runner/src/index.ts` (372 lines) -- Verified Phase 3 env var support
  - `container/agent-runner/src/ipc-mcp.ts` (347 lines) -- Verified IPC dir injection
- [Node.js child_process documentation](https://nodejs.org/api/child_process.html) -- spawn() API, env option, stdio configuration, timeout behavior, detached/unref

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` -- Host runner design patterns (lines 195-243), verified against current codebase
- `.planning/research/SUMMARY.md` -- Component list and anti-patterns (lines 71-91), verified against current codebase
- `.planning/phases/03-agent-runner-path-flexibility/03-RESEARCH.md` -- CLAUDE_CONFIG_DIR discovery (line 130-134), verified via GitHub issue #84

### Tertiary (LOW confidence)

- None -- all findings verified against codebase or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new libraries needed; all patterns verified in existing codebase
- Architecture: HIGH -- Container-runner provides a complete template; GroupQueue already supports non-container processes
- Pitfalls: HIGH -- All 7 pitfalls verified against actual code (line numbers cited)

**Research date:** 2026-02-08
**Valid until:** 2026-03-10 (stable -- no external dependencies, all codebase-derived)
