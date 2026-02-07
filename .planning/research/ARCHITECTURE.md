# Architecture Patterns: Dual-Mode Agent Execution

**Domain:** Container-vs-host agent execution for NanoClaw
**Researched:** 2026-02-07
**Overall confidence:** HIGH (based on direct codebase analysis; all findings verified against source code)

---

## Recommended Architecture

### High-Level View

```
                         nanoclaw.config.jsonc
                               |
                         [Config Loader]
                               |
                     { mode: "container" | "host" }
                               |
                 +-------------+-------------+
                 |                           |
          [Container Runner]          [Host Runner]
          (container-runner.ts)       (host-runner.ts)  <-- NEW
                 |                           |
          spawn `container run`       spawn `node agent-runner`
          with volume mounts          with cwd + env vars
                 |                           |
          +------+------+           +--------+--------+
          |  Container  |           |    Direct        |
          |  Linux VM   |           |    macOS Process  |
          |             |           |                   |
          | agent-runner|           | agent-runner      |  <-- SAME CODE
          | (compiled)  |           | (via tsx/node)    |
          |             |           |                   |
          | IPC via     |           | IPC via           |
          | /workspace/ |           | absolute paths    |
          | ipc/        |           | to data/ipc/      |
          +-------------+           +-------------------+
                 |                           |
                 +-------------+-------------+
                               |
                    [IPC Watcher] (unchanged)
                               |
                    [Message Router] (unchanged)
```

### Design Principle: Reuse Agent-Runner, Replace Only the Spawning Layer

The agent-runner code (`container/agent-runner/src/`) handles Claude Agent SDK invocation, IPC MCP server creation, structured output parsing, session management, and conversation archival. None of this logic is container-specific. The only container-specific aspects are:

1. **Path assumptions** -- hardcoded `/workspace/ipc`, `/workspace/group`, `/workspace/global`
2. **Env sourcing** -- the entrypoint.sh sources from `/workspace/env-dir/env`
3. **settingSources** -- currently `['project']` (container has no user-level settings)

The host-runner should invoke the same agent-runner code as a Node.js subprocess, passing absolute host paths instead of container paths. This avoids code duplication and ensures both modes produce identical IPC output formats.

---

## Component Boundaries

### Components That Stay the Same (No Changes)

| Component | File(s) | Why Unchanged |
|-----------|---------|---------------|
| Message Router | `src/index.ts` (message loop, processGroupMessages) | Calls `runAgent()` which delegates to runner; router doesn't know which runner |
| IPC Watcher | `src/index.ts` (startIpcWatcher, processTaskIpc) | Reads JSON files from `data/ipc/`; format is mode-independent |
| IPC MCP Server | `container/agent-runner/src/ipc-mcp.ts` | Writes JSON files; paths are injected, not hardcoded (after refactor) |
| Group Queue | `src/group-queue.ts` | Manages concurrency; doesn't know about container vs host |
| Database Layer | `src/db.ts` | Pure state persistence; mode-agnostic |
| Mount Security | `src/mount-security.ts` | Only used by container mode; host mode skips it |
| WhatsApp/Slack I/O | `src/index.ts`, `src/slack.ts` | Upstream of runner selection |
| Types | `src/types.ts` | Extended but not changed |

### Components That Change

| Component | Current | Change Required |
|-----------|---------|-----------------|
| `src/index.ts` runAgent() | Directly calls `runContainerAgent()` | Call runner abstraction based on config |
| `src/task-scheduler.ts` | Directly calls `runContainerAgent()` | Call runner abstraction based on config |
| `src/config.ts` | Only env vars and hardcoded constants | Add JSONC config loading |
| `container/agent-runner/src/index.ts` | Hardcoded `/workspace/*` paths | Accept paths via stdin JSON or env vars |
| `container/agent-runner/src/ipc-mcp.ts` | Hardcoded `IPC_DIR = '/workspace/ipc'` | Accept IPC dir path as parameter |

### New Components

| Component | File | Purpose |
|-----------|------|---------|
| Config Loader | `src/config-loader.ts` | Parse JSONC, merge defaults, validate, export typed config |
| Runner Interface | `src/runner.ts` | Shared types + factory function; `runAgent(group, input, onProcess)` |
| Host Runner | `src/host-runner.ts` | Spawn agent-runner as Node.js subprocess on macOS |
| Config File | `nanoclaw.config.jsonc` | User-facing config: mode, MCP servers, runner options |

---

## Interface Design: Runner Abstraction

### The Contract

Both runners implement the same function signature. This is NOT a class hierarchy or abstract base class -- it's a function type and a factory.

```typescript
// src/runner.ts

import type { ChildProcess } from 'child_process';
import type { RegisteredGroup } from './types.js';

// Already exists in container-runner.ts -- extract and share
export interface RunnerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
}

// Already exists in container-runner.ts -- extract and share
export interface RunnerOutput {
  status: 'success' | 'error';
  result: AgentResponse | null;
  newSessionId?: string;
  error?: string;
}

export interface AgentResponse {
  outputType: 'message' | 'log';
  userMessage?: string;
  internalLog?: string;
}

// The runner function type
export type RunAgentFn = (
  group: RegisteredGroup,
  input: RunnerInput,
  onProcess: (proc: ChildProcess, name: string) => void,
) => Promise<RunnerOutput>;

// Factory based on loaded config
export function createRunner(config: NanoClawConfig): RunAgentFn {
  if (config.executionMode === 'host') {
    return createHostRunner(config);
  }
  return createContainerRunner(config);
}
```

### Why a Function, Not a Class

The existing code calls `runContainerAgent(group, input, onProcess)` as a plain function. Both `src/index.ts` (line 310) and `src/task-scheduler.ts` (line 93) call it identically. Replacing it with a polymorphic function is the minimal change -- just swap the import and call the factory once at startup.

A class/interface hierarchy would require restructuring both callers and adding constructor/injection patterns. The codebase philosophy is "small enough to understand" -- a function type achieves the abstraction without adding ceremony.

---

## Data Flow Differences Between Modes

### Container Mode (Current)

```
Host Process                          Container (Linux VM)
-----------                          --------------------
1. Build volume mounts
   - groups/{folder} -> /workspace/group
   - data/ipc/{folder} -> /workspace/ipc
   - data/sessions/{folder}/.claude -> /home/node/.claude
   - data/env/env -> /workspace/env-dir/env
   - groups/global -> /workspace/global (non-main, readonly)
   - project root -> /workspace/project (main only)

2. Spawn `container run -i --rm`
   with mount args

3. Pipe RunnerInput JSON to stdin  -->  4. agent-runner reads stdin
                                        5. Sources env from /workspace/env-dir/env
                                        6. Creates IPC MCP at /workspace/ipc
                                        7. Calls query() with:
                                           - cwd: /workspace/group
                                           - settingSources: ['project']
                                           - mcpServers: { nanoclaw: ipcMcp }
                                        8. Agent runs (Bash is sandboxed!)
                                        9. Writes IPC files to /workspace/ipc/
                                       10. Outputs RunnerOutput JSON to stdout

11. Parse stdout between sentinels  <--
12. Return RunnerOutput

IPC Watcher picks up files from data/ipc/{folder}/
```

### Host Mode (New)

```
Host Process                          Host Subprocess (macOS)
-----------                          ---------------------
1. NO volume mounts needed
   Resolve absolute paths:
   - groupDir = groups/{folder}
   - ipcDir = data/ipc/{folder}
   - sessionsDir = data/sessions/{folder}/.claude
   - globalDir = groups/global

2. Spawn `node container/agent-runner/dist/index.js`
   (or `tsx container/agent-runner/src/index.ts`)
   with env vars:
   - NANOCLAW_IPC_DIR=/abs/path/to/data/ipc/{folder}
   - NANOCLAW_GROUP_DIR=/abs/path/to/groups/{folder}
   - NANOCLAW_GLOBAL_DIR=/abs/path/to/groups/global
   - CLAUDE_HOME=/abs/path/to/data/sessions/{folder}/.claude
   - All auth env vars (direct, no file indirection)

3. Pipe RunnerInput JSON to stdin  -->  4. agent-runner reads stdin
                                        5. Reads paths from env vars
                                           (no /workspace/* hardcoding)
                                        6. Creates IPC MCP at $NANOCLAW_IPC_DIR
                                        7. Calls query() with:
                                           - cwd: $NANOCLAW_GROUP_DIR
                                           - settingSources: ['project', 'user']
                                           - mcpServers: { nanoclaw: ipcMcp }
                                             + mode-filtered MCP servers from config
                                        8. Agent runs (Bash runs on HOST!)
                                        9. Writes IPC files to $NANOCLAW_IPC_DIR
                                       10. Outputs RunnerOutput JSON to stdout

11. Parse stdout between sentinels  <--
12. Return RunnerOutput

IPC Watcher picks up files from data/ipc/{folder}/ (same as container mode)
```

### Key Differences Summary

| Aspect | Container Mode | Host Mode |
|--------|---------------|-----------|
| **Filesystem isolation** | Full (only mounts visible) | None (full macOS access) |
| **Path resolution** | Volume mounts translate paths | Env vars provide absolute paths |
| **Bash safety** | Sandboxed in Linux VM | Runs on host macOS -- dangerous |
| **settingSources** | `['project']` only | `['project', 'user']` -- inherits global MCP servers |
| **MCP servers** | Only project-level + nanoclaw IPC | Project + user-level + mode-filtered from config |
| **Environment** | Filtered env file mounted in | Direct env var inheritance (filtered) |
| **Process type** | `container run -i` | `node` or `tsx` subprocess |
| **Startup overhead** | VM boot (~2-5s) | Process fork (~0.1s) |
| **Cleanup** | `container stop` + `--rm` | SIGTERM + SIGKILL |
| **Claude home** | `/home/node/.claude` (mounted) | `CLAUDE_HOME` env var pointing to sessions dir |

---

## Agent-Runner Refactoring Plan

The agent-runner must work in both modes without code duplication. The refactor is small:

### Current: Hardcoded Paths

```typescript
// container/agent-runner/src/ipc-mcp.ts (current)
const IPC_DIR = '/workspace/ipc';

// container/agent-runner/src/index.ts (current)
const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
// cwd hardcoded to /workspace/group in Dockerfile WORKDIR
```

### After: Environment-Driven Paths

```typescript
// container/agent-runner/src/ipc-mcp.ts (refactored)
const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';

// container/agent-runner/src/index.ts (refactored)
const GROUP_DIR = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';
const GLOBAL_DIR = process.env.NANOCLAW_GLOBAL_DIR || '/workspace/global';
const globalClaudeMdPath = path.join(GLOBAL_DIR, 'CLAUDE.md');

// settingSources driven by mode
const isHostMode = process.env.NANOCLAW_MODE === 'host';
const settingSources = isHostMode ? ['project', 'user'] : ['project'];
```

Container mode continues to work unchanged -- env vars are not set in the container, so defaults (`/workspace/*`) apply. Host mode sets the env vars to absolute host paths.

This is the smallest possible change to make the agent-runner dual-mode.

---

## JSONC Configuration Design

### File: `nanoclaw.config.jsonc`

```jsonc
{
  // Execution mode: "container" (default, isolated) or "host" (native macOS)
  "executionMode": "container",

  // MCP servers available to agents (beyond the built-in nanoclaw IPC server)
  // Each server can specify which modes it's compatible with
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/projects"],
      "modes": ["host"]  // Only available in host mode
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-brave-search"],
      "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" },
      "modes": ["host", "container"]  // Available in both modes
    }
  },

  // Container-specific settings
  "container": {
    "image": "nanoclaw-agent:latest",
    "timeout": 300000,
    "maxConcurrent": 5,
    "maxOutputSize": 10485760
  },

  // Host-specific settings
  "host": {
    "timeout": 300000,
    "maxConcurrent": 5,
    // Whether to inherit MCP servers from ~/.claude/settings.json
    "inheritUserSettings": true
  }
}
```

### Config Loader Design

```typescript
// src/config-loader.ts

import fs from 'fs';
import path from 'path';
import stripJsonComments from 'strip-json-comments';

export interface NanoClawConfig {
  executionMode: 'container' | 'host';
  mcpServers: Record<string, McpServerConfig>;
  container: ContainerModeConfig;
  host: HostModeConfig;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  modes: Array<'host' | 'container'>;
}

interface ContainerModeConfig {
  image: string;
  timeout: number;
  maxConcurrent: number;
  maxOutputSize: number;
}

interface HostModeConfig {
  timeout: number;
  maxConcurrent: number;
  inheritUserSettings: boolean;
}

const DEFAULTS: NanoClawConfig = {
  executionMode: 'container',
  mcpServers: {},
  container: {
    image: 'nanoclaw-agent:latest',
    timeout: 300000,
    maxConcurrent: 5,
    maxOutputSize: 10485760,
  },
  host: {
    timeout: 300000,
    maxConcurrent: 5,
    inheritUserSettings: true,
  },
};

export function loadConfig(projectRoot: string): NanoClawConfig {
  const configPath = path.join(projectRoot, 'nanoclaw.config.jsonc');

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  const stripped = stripJsonComments(raw);
  const parsed = JSON.parse(stripped);

  return deepMerge(DEFAULTS, parsed);
}
```

### MCP Server Filtering at Runtime

When the runner starts, it filters MCP servers by the current mode:

```typescript
function getMcpServersForMode(
  config: NanoClawConfig,
  mode: 'container' | 'host',
): Record<string, McpServerConfig> {
  const filtered: Record<string, McpServerConfig> = {};
  const skipped: string[] = [];

  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (server.modes.includes(mode)) {
      filtered[name] = server;
    } else {
      skipped.push(name);
    }
  }

  if (skipped.length > 0) {
    logger.warn(
      { mode, skipped },
      'MCP servers unavailable in current mode',
    );
  }

  return filtered;
}
```

---

## Patterns to Follow

### Pattern 1: Stdin/Stdout IPC with Sentinel Markers

**What:** The existing pattern of piping JSON to stdin and reading JSON from stdout between `---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` markers.

**When:** Both container and host runners use this.

**Why keep it:** The sentinel markers solve a real problem -- agent-runner may emit debug/log output to stdout before or after the JSON result. Without markers, the host would have to guess which line is the result. The host-runner MUST use this same protocol.

### Pattern 2: Process Registration for Graceful Shutdown

**What:** The `onProcess` callback that registers the child process with GroupQueue for shutdown coordination.

**When:** Both runners call `onProcess(proc, name)` after spawning.

**Why:** GroupQueue's `shutdown()` method iterates registered processes and sends SIGTERM/SIGKILL. For host mode, process management is simpler (just SIGTERM the node process) but the same registration pattern should be used.

### Pattern 3: Per-Group IPC Namespace

**What:** Each group gets its own IPC directory (`data/ipc/{folder}/messages/` and `tasks/`) and authorization is derived from directory identity.

**When:** Both modes write IPC files to the same directories.

**Why keep it:** The IPC watcher in `src/index.ts` scans per-group directories and uses the directory name as the source identity for authorization checks. This works identically regardless of whether the writer was a container or a host process.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Abstracting Too Early

**What:** Creating an elaborate Runner interface/class hierarchy with shared base classes.

**Why bad:** The codebase philosophy is "small enough to understand." A function type + factory is sufficient. There are exactly two runners, and the differences are well-understood. Over-abstracting creates unnecessary indirection.

**Instead:** One type (`RunAgentFn`), one factory (`createRunner`), two implementations (files: `container-runner.ts`, `host-runner.ts`).

### Anti-Pattern 2: Separate Agent-Runner Codebases

**What:** Writing a new agent-runner for host mode that duplicates the Claude SDK invocation, IPC MCP creation, structured output parsing, and conversation archival.

**Why bad:** The agent-runner is ~350 lines with nuanced logic (structured output fallback on line 312-318, pre-compact hooks, global CLAUDE.md loading, session management). Duplicating this creates a maintenance burden and divergence risk.

**Instead:** Make the existing agent-runner path-configurable via environment variables. Both modes run the same code.

### Anti-Pattern 3: Runtime Mode Switching

**What:** Allowing the execution mode to be changed while NanoClaw is running.

**Why bad:** Container and host modes have fundamentally different security properties. Switching at runtime could leave processes in inconsistent states (e.g., container processes still running when mode switches to host).

**Instead:** Mode is read once at startup from `nanoclaw.config.jsonc`. Changing mode requires a restart.

### Anti-Pattern 4: Per-Group Mode Selection

**What:** Allowing different groups to run in different modes (some in container, some on host).

**Why bad:** Dramatically increases complexity -- the queue must track which mode each group uses, shutdown must handle mixed process types, and security properties become per-group rather than system-wide.

**Instead:** Single mode for the entire system. Users who want mixed modes can run two NanoClaw instances (not recommended, listed as out-of-scope in PROJECT.md).

---

## Suggested Build Order

Dependencies flow top-down. Each phase depends on the one above it.

### Phase 1: Config Loader (Foundation)

**Build:**
- `nanoclaw.config.jsonc` with defaults and inline comments
- `src/config-loader.ts` -- parse JSONC, merge defaults, validate, export typed config
- Update `src/config.ts` to read from config loader (backward compatible: if no config file, use current defaults)

**Why first:** Everything else depends on knowing the execution mode. The config loader is standalone with no dependencies on existing code except `config.ts`. It can be tested independently.

**Dependencies:** `strip-json-comments` (already in lockfile as transitive dep; add as direct dep)

**Verification:** Load config, verify defaults apply when file absent, verify JSONC comments stripped.

### Phase 2: Runner Abstraction + Agent-Runner Refactor

**Build:**
- `src/runner.ts` -- extract shared types (`RunnerInput`, `RunnerOutput`, `AgentResponse`, `RunAgentFn`) from `container-runner.ts`
- Refactor `container-runner.ts` to import shared types from `runner.ts` (no behavior change)
- Refactor `container/agent-runner/src/ipc-mcp.ts` -- make IPC_DIR configurable via env var
- Refactor `container/agent-runner/src/index.ts` -- make paths configurable via env vars, add `NANOCLAW_MODE` env var for settingSources selection
- Rebuild container image (to include refactored agent-runner)
- Update `src/index.ts` and `src/task-scheduler.ts` to use `RunAgentFn` type

**Why second:** This refactors existing code to be mode-ready without adding host mode yet. All existing tests continue to pass (container mode is unchanged). The agent-runner changes are backward-compatible (defaults match current hardcoded values).

**Verification:** Run NanoClaw in container mode, verify identical behavior. Container still works because env vars default to `/workspace/*` paths.

### Phase 3: Host Runner Implementation

**Build:**
- `src/host-runner.ts` -- spawn `node container/agent-runner/dist/index.js` with:
  - Env vars for paths (NANOCLAW_IPC_DIR, NANOCLAW_GROUP_DIR, etc.)
  - Auth env vars (direct passthrough, not file)
  - NANOCLAW_MODE=host
  - CLAUDE_HOME for sessions directory
- Same stdin/stdout/sentinel protocol as container-runner
- Same `onProcess` callback for GroupQueue registration
- Same timeout/kill logic (but simpler: just SIGTERM the node process)
- MCP server filtering based on config mode tags
- Startup warning log for unavailable MCP servers

**Why third:** Depends on Phase 1 (config tells us we're in host mode) and Phase 2 (agent-runner accepts path env vars, shared types exist).

**Verification:** Switch config to `"executionMode": "host"`, send a WhatsApp message, verify response arrives. Verify IPC messages work. Verify scheduled tasks work.

### Phase 4: Integration + Polish

**Build:**
- Wire `createRunner(config)` factory into `src/index.ts` main() and `src/task-scheduler.ts`
- Add startup banner showing execution mode and available MCP servers
- Create `nanoclaw.config.jsonc` example file with comprehensive comments
- Update `.env.example` if needed
- Test mode switching (stop, change config, start)
- Verify container mode still works after all changes

**Why last:** This is the integration phase that connects everything. All individual components are tested in isolation first.

**Verification:** Full end-to-end test in both modes. Switch between modes by editing config and restarting.

---

## Security Implications

### Host Mode Warning

Host mode fundamentally changes the security model:

| Property | Container Mode | Host Mode |
|----------|---------------|-----------|
| Bash commands | Sandboxed in Linux VM | Execute on macOS as current user |
| File access | Only mounted paths | Entire filesystem |
| Network | Isolated (can be restricted) | Full host network |
| Process | Contained in VM | Full host process space |
| MCP servers | Project-level only | Project + user-level |

This MUST be clearly documented in `nanoclaw.config.jsonc`:

```jsonc
{
  // WARNING: "host" mode runs agents directly on your Mac.
  // Agents can execute ANY bash command, access ANY file, and use
  // ALL your MCP servers. Only use host mode if you trust the
  // conversations and groups that trigger agent execution.
  //
  // Default: "container" (safe, isolated)
  "executionMode": "container"
}
```

### Mitigation for Host Mode

- Container mode remains the default
- Config file must be explicitly edited to enable host mode
- Startup log clearly announces the mode: `"Running in HOST mode -- agents have full macOS access"`
- The `allowedTools` list in agent-runner should remain the same (Bash, Read, Write, Edit, etc.) -- the difference is that Bash now runs on the host, which is the desired behavior for users who opt into host mode

---

## Sources

All findings are based on direct analysis of the NanoClaw codebase at `/Users/alvin/dev/nanoclaw/`:
- `src/container-runner.ts` -- current container spawning logic
- `src/index.ts` -- main router, IPC watcher, message processing
- `container/agent-runner/src/index.ts` -- Claude Agent SDK invocation
- `container/agent-runner/src/ipc-mcp.ts` -- IPC MCP server
- `src/types.ts` -- shared type definitions
- `src/config.ts` -- current configuration
- `src/group-queue.ts` -- concurrency management
- `src/task-scheduler.ts` -- scheduled task execution
- `src/mount-security.ts` -- mount validation (container-only)
- `.planning/PROJECT.md` -- project requirements and constraints
- `.planning/codebase/ARCHITECTURE.md` -- existing architecture analysis
- `container/Dockerfile` -- container image build

Confidence: HIGH -- all recommendations are grounded in the actual codebase structure. No external library research was needed; the architecture question is about restructuring existing code, not introducing new technologies.

---

*Architecture research: 2026-02-07*
