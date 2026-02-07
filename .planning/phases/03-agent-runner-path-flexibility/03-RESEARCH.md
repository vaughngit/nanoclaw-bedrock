# Phase 3: Agent-Runner Path Flexibility - Research

**Researched:** 2026-02-07
**Domain:** Environment-driven path configuration for dual-mode agent runner
**Confidence:** HIGH

## Summary

This phase is a backward-compatible refactor of two files (`container/agent-runner/src/index.ts` and `container/agent-runner/src/ipc-mcp.ts`) to replace hardcoded `/workspace/*` paths with environment variable lookups that fall back to the current defaults. The scope is intentionally narrow: make the agent-runner path-configurable, rebuild the container image, verify backward compatibility. No new execution modes are added (that is Phase 4).

The codebase analysis identified **5 hardcoded paths** in the agent-runner that need env var fallbacks, plus **1 tool description string** that references a container-specific path. The refactor is small (~30 lines changed) but must be done carefully to preserve container mode behavior identically.

**Primary recommendation:** Replace each hardcoded `/workspace/*` path with `process.env.NANOCLAW_<NAME> || '/workspace/<path>'` at module scope. Use `NANOCLAW_` prefix for all NanoClaw-specific env vars. Use `CLAUDE_CONFIG_DIR` (not `CLAUDE_HOME`) for session storage -- the Agent SDK already supports this variable. Add a `NANOCLAW_MODE` env var to control `settingSources`. Container mode changes zero behavior; host mode (Phase 4) sets all vars.

## Standard Stack

This phase uses no new libraries. All changes are within existing code using Node.js built-ins.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | built-in | mkdir -p for auto-created directories | Already used throughout agent-runner |
| Node.js `path` | built-in | Path joining for derived paths | Already used throughout agent-runner |
| Node.js `process.env` | built-in | Environment variable reads | Standard Node.js pattern for configuration |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `typescript` | ^5.7.3 | Agent-runner compilation | Already in agent-runner devDependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `process.env` reads | dotenv, envalid | Unnecessary -- agent-runner gets env vars from container env or host runner's spawn call. No parsing needed. |
| Module-scope constants | Runtime config object | Constants are simpler and match current pattern. No dynamic reconfiguration needed. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Current Agent-Runner File Structure
```
container/agent-runner/
├── src/
│   ├── index.ts       # Main entry: stdin parsing, query() call, stdout output
│   └── ipc-mcp.ts     # IPC MCP server: message/task file writing
├── dist/              # Compiled output (tsc)
├── package.json       # Dependencies: claude-agent-sdk, cron-parser, zod
└── tsconfig.json      # TypeScript config
```

No structural changes. Same two files, same directory layout.

### Pattern 1: Environment Variable with Fallback Default
**What:** Replace hardcoded paths with `process.env.X || '/workspace/default'` at module scope.
**When to use:** Every hardcoded `/workspace/*` path in the agent-runner.
**Example:**
```typescript
// Source: Direct codebase analysis of container/agent-runner/src/index.ts
// BEFORE (current):
const globalClaudeMdPath = '/workspace/global/CLAUDE.md';
// ...
cwd: '/workspace/group',

// AFTER (refactored):
const GROUP_DIR = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';
const GLOBAL_DIR = process.env.NANOCLAW_GLOBAL_DIR || '/workspace/global';
const globalClaudeMdPath = path.join(GLOBAL_DIR, 'CLAUDE.md');
// ...
cwd: GROUP_DIR,
```

### Pattern 2: IPC Directory Injection via Environment
**What:** Pass IPC base directory as env var; derive `messages/` and `tasks/` subdirectories from it.
**When to use:** In `ipc-mcp.ts` where `IPC_DIR` is currently hardcoded.
**Example:**
```typescript
// Source: Direct codebase analysis of container/agent-runner/src/ipc-mcp.ts
// BEFORE:
const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// AFTER:
const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');
```

### Pattern 3: Mode-Driven settingSources
**What:** Use a `NANOCLAW_MODE` env var to select `settingSources` for the Claude Agent SDK `query()` call.
**When to use:** In `index.ts` where `settingSources: ['project']` is currently hardcoded.
**Example:**
```typescript
// Source: Claude Agent SDK TypeScript Reference (platform.claude.com)
// + codebase analysis of container/agent-runner/src/index.ts line 286
const isHostMode = process.env.NANOCLAW_MODE === 'host';
const settingSources: ('project' | 'user')[] = isHostMode
  ? ['project', 'user']
  : ['project'];

// In query() options:
settingSources,
```

### Pattern 4: Auto-Create Missing Directories
**What:** `fs.mkdirSync(dir, { recursive: true })` for configured paths at startup, before any operations.
**When to use:** Once at agent-runner startup (before `query()` call) and in IPC write paths.
**Example:**
```typescript
// Ensure group dir exists (host mode: may not exist yet)
fs.mkdirSync(GROUP_DIR, { recursive: true });
// Ensure conversations subdirectory exists
const conversationsDir = path.join(GROUP_DIR, 'conversations');
fs.mkdirSync(conversationsDir, { recursive: true });
```

### Anti-Patterns to Avoid
- **Relative path acceptance:** All env var paths should be absolute. In host mode, relative paths would resolve relative to the NanoClaw project root (or wherever `node` was invoked), not the intended group directory. Do not `path.resolve()` relative paths -- reject them or warn.
- **Duplicating path constants in multiple files:** Define path constants once in `index.ts` and pass them to `createIpcMcp()` as parameters, rather than having both files independently read env vars.
- **Changing Dockerfile defaults:** Do NOT modify the Dockerfile to set `NANOCLAW_*` env vars. The container should continue using the `/workspace/*` defaults via the fallback mechanism. This keeps the container image identical to pre-refactor.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session storage isolation | Override `HOME` env var for host subprocess | `CLAUDE_CONFIG_DIR` env var | Claude Agent SDK already supports `CLAUDE_CONFIG_DIR` to redirect `~/.claude/` to a custom directory. Overriding HOME affects all tools, not just Claude. |
| Path validation | Custom path sanitizer | `path.isAbsolute()` check + log warning | Node.js built-in is sufficient. Complex validation adds no value for env vars the operator controls. |
| Directory creation | Manual existence checks + mkdir | `fs.mkdirSync(dir, { recursive: true })` | The `recursive: true` option is idempotent -- no need to check first. |

**Key insight:** `CLAUDE_CONFIG_DIR` is the correct way to control where Claude stores sessions. The earlier research docs reference `CLAUDE_HOME`, but that was a GitHub issue requesting a feature that already exists as `CLAUDE_CONFIG_DIR`. This was confirmed as resolved on 2025-12-01 in [anthropics/claude-agent-sdk-typescript#84](https://github.com/anthropics/claude-agent-sdk-typescript/issues/84). The container mode already solves this via volume mount (`data/sessions/{group}/.claude → /home/node/.claude`), so this phase does NOT need to set `CLAUDE_CONFIG_DIR` -- that is Phase 4's responsibility when it spawns host-mode subprocesses.

## Common Pitfalls

### Pitfall 1: Conversations Directory Uses Hardcoded Group Path
**What goes wrong:** The `createPreCompactHook()` function in `index.ts` line 136 hardcodes `const conversationsDir = '/workspace/group/conversations'`. This path won't work in host mode if `NANOCLAW_GROUP_DIR` points elsewhere.
**Why it happens:** The conversations archive was added after the initial design and uses a direct string literal instead of deriving from a path constant.
**How to avoid:** Derive it from `GROUP_DIR`: `const conversationsDir = path.join(GROUP_DIR, 'conversations')`.
**Warning signs:** Conversation archives silently fail to write (the catch block just logs, doesn't throw).

### Pitfall 2: Tool Description String Contains Hardcoded Container Path
**What goes wrong:** In `ipc-mcp.ts` line 120, the `schedule_task` tool's `target_group_jid` parameter has a `.describe()` string containing `/workspace/project/data/registered_groups.json`. This is a human-readable description for the AI agent, not a code path -- but it becomes misleading in host mode where the file is at an absolute macOS path.
**Why it happens:** The tool description was written assuming container-only execution.
**How to avoid:** Make the description path-agnostic or reference a variable. Since this is a string constant in a Zod schema, the simplest approach is to use a general description like "look up JIDs in the registered groups data file" rather than hardcoding the path. Alternatively, construct the description dynamically using the configured path. This is a minor cosmetic issue for Phase 3 (container mode only), but should be noted for Phase 4.
**Warning signs:** The AI agent in host mode tries to read `/workspace/project/data/registered_groups.json` which doesn't exist.

### Pitfall 3: Container Rebuild Must Compile Agent-Runner TypeScript Separately
**What goes wrong:** The main app's `npm run build` (in root `package.json`) compiles `src/*.ts` to `dist/`. The agent-runner has its own `tsconfig.json` and its own `npm run build` (which runs `tsc` inside `container/agent-runner/`). If you only run the main build, the agent-runner's TypeScript is not recompiled.
**Why it happens:** Two separate TypeScript projects with separate `tsconfig.json` files. The Dockerfile handles this correctly (`RUN npm run build` inside the container build), but manual testing requires awareness.
**How to avoid:** After modifying agent-runner code, verify by either: (a) rebuilding the container image with `./container/build.sh`, which runs `npm run build` inside the Docker build; or (b) running `cd container/agent-runner && npm run build` locally to check compilation.
**Warning signs:** TypeScript errors only surface during container build, not during local development.

### Pitfall 4: IPC Per-Group Isolation Is Host-Side, Not Agent-Side
**What goes wrong:** Someone might think the agent-runner needs per-group IPC subdirectory logic. It does not -- the host process (`src/container-runner.ts` line 121) already creates per-group IPC directories (`data/ipc/{group.folder}`) and mounts each one to `/workspace/ipc` inside the container. The agent-runner always sees a flat `/workspace/ipc` with `messages/` and `tasks/` subdirectories.
**Why it happens:** The IPC isolation is implemented at the mount layer (host-side), not the application layer (agent-side). The agent-runner writes to `IPC_DIR/messages/` and `IPC_DIR/tasks/` without knowing about other groups.
**How to avoid:** Do NOT add per-group subdirectory logic inside the agent-runner. The `NANOCLAW_IPC_DIR` env var will point to the already-isolated directory for each group.
**Warning signs:** If the agent-runner starts creating its own subdirectories under `IPC_DIR`, something is wrong.

### Pitfall 5: Breaking the Entrypoint Script
**What goes wrong:** The Dockerfile's entrypoint (`/app/entrypoint.sh`) sources env vars from `/workspace/env-dir/env` and runs `node /app/dist/index.js`. The agent-runner's path refactor must not change the entrypoint script or the Dockerfile WORKDIR (`/workspace/group`).
**Why it happens:** The entrypoint is inline in the Dockerfile RUN command (line 55). It's easy to overlook.
**How to avoid:** This phase changes only `container/agent-runner/src/index.ts` and `container/agent-runner/src/ipc-mcp.ts`. The Dockerfile and entrypoint.sh are NOT modified. The WORKDIR (`/workspace/group`) continues to set the process's initial cwd, which the agent-runner uses as its default `cwd` for `query()`.
**Warning signs:** Container fails to start after rebuild.

## Code Examples

Verified patterns from codebase analysis and official documentation.

### Complete Path Resolution (index.ts)
```typescript
// Source: Codebase analysis + Claude Agent SDK docs (platform.claude.com)
// container/agent-runner/src/index.ts -- top of file, after imports

// Path configuration: env vars with container defaults
const GROUP_DIR = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';
const GLOBAL_DIR = process.env.NANOCLAW_GLOBAL_DIR || '/workspace/global';

// Mode configuration: affects settingSources for query()
const NANOCLAW_MODE = process.env.NANOCLAW_MODE || 'container';

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

// Log which paths are in use (helps debug host mode issues)
if (NANOCLAW_MODE !== 'container') {
  log(`Mode: ${NANOCLAW_MODE}`);
  log(`Group dir: ${GROUP_DIR}`);
  log(`Global dir: ${GLOBAL_DIR}`);
}
```

### Complete IPC Path Resolution (ipc-mcp.ts)
```typescript
// Source: Codebase analysis of container/agent-runner/src/ipc-mcp.ts
// Pass IPC_DIR as a parameter from index.ts instead of reading env directly

export interface IpcMcpContext {
  chatJid: string;
  groupFolder: string;
  isMain: boolean;
  ipcDir: string;  // NEW: injected path
}

export function createIpcMcp(ctx: IpcMcpContext) {
  const { chatJid, groupFolder, isMain, ipcDir } = ctx;
  const MESSAGES_DIR = path.join(ipcDir, 'messages');
  const TASKS_DIR = path.join(ipcDir, 'tasks');
  // ... rest unchanged
}
```

### settingSources Selection
```typescript
// Source: Claude Agent SDK TypeScript Reference
// https://platform.claude.com/docs/en/agent-sdk/typescript
// Options.settingSources type: ('project' | 'user' | 'local')[]
// Default: [] (no filesystem settings loaded)

const settingSources: ('project' | 'user')[] =
  NANOCLAW_MODE === 'host'
    ? ['project', 'user']  // Host: inherit ~/.claude/settings.json MCP servers
    : ['project'];          // Container: project settings only

// Used in query() options:
for await (const message of query({
  prompt,
  options: {
    cwd: GROUP_DIR,
    settingSources,
    // ... rest unchanged
  }
})) { /* ... */ }
```

### Conversations Directory Fix
```typescript
// Source: Codebase analysis, container/agent-runner/src/index.ts line 136
// BEFORE:
const conversationsDir = '/workspace/group/conversations';

// AFTER:
const conversationsDir = path.join(GROUP_DIR, 'conversations');
```

### Auto-Directory Creation at Startup
```typescript
// Source: Node.js fs.mkdirSync documentation
// Added to main() before query() call

// Ensure directories exist (idempotent, handles host mode first run)
fs.mkdirSync(GROUP_DIR, { recursive: true });
// IPC dirs are created by writeIpcFile() already (line 23 of ipc-mcp.ts)
```

## Hardcoded Path Inventory

Complete inventory of every `/workspace/*` reference in the agent-runner code that needs env var treatment.

| File | Line | Current Value | Env Var | Default |
|------|------|--------------|---------|---------|
| `index.ts` | 136 | `'/workspace/group/conversations'` | Derived: `path.join(GROUP_DIR, 'conversations')` | `/workspace/group/conversations` |
| `index.ts` | 261 | `'/workspace/global/CLAUDE.md'` | Derived: `path.join(GLOBAL_DIR, 'CLAUDE.md')` | `/workspace/global/CLAUDE.md` |
| `index.ts` | 273 | `cwd: '/workspace/group'` | `NANOCLAW_GROUP_DIR` | `/workspace/group` |
| `ipc-mcp.ts` | 12 | `const IPC_DIR = '/workspace/ipc'` | `NANOCLAW_IPC_DIR` | `/workspace/ipc` |
| `ipc-mcp.ts` | 120 | `'/workspace/project/data/registered_groups.json'` (in tool description string) | Cosmetic fix or parameterize | N/A (description text) |

### Env Var Summary

| Env Var | Purpose | Default | Set By |
|---------|---------|---------|--------|
| `NANOCLAW_GROUP_DIR` | Agent working directory (group-specific files, CLAUDE.md) | `/workspace/group` | Host runner (Phase 4) |
| `NANOCLAW_GLOBAL_DIR` | Global shared memory directory (CLAUDE.md shared across groups) | `/workspace/global` | Host runner (Phase 4) |
| `NANOCLAW_IPC_DIR` | IPC file exchange directory (messages/, tasks/) | `/workspace/ipc` | Host runner (Phase 4) |
| `NANOCLAW_MODE` | Execution mode flag affecting settingSources | `container` | Host runner (Phase 4) |
| `CLAUDE_CONFIG_DIR` | Claude session storage directory (replaces HOME-based lookup) | Not set (uses ~/.claude/) | Host runner (Phase 4) |

**Note:** `CLAUDE_CONFIG_DIR` is a Claude Agent SDK variable, not a NanoClaw-invented one. Phase 3 does NOT set it -- the container handles session isolation via volume mounts. Phase 4's host runner will set it to `data/sessions/{group}/.claude`.

## IPC Architecture Analysis

### Current IPC Structure
```
data/ipc/                    # Host-side base directory
├── {group-folder}/          # Per-group namespace (created by host)
│   ├── messages/            # Outbound messages from agent
│   │   └── {timestamp}-{random}.json
│   ├── tasks/               # Task management commands from agent
│   │   └── {timestamp}-{random}.json
│   ├── current_tasks.json   # Task snapshot (written by host, read by agent)
│   └── available_groups.json  # Groups snapshot (main only, written by host)
└── errors/                  # Failed IPC files moved here
```

### How IPC Isolation Works
1. **Host-side** (`src/container-runner.ts` line 121): Creates `data/ipc/{group.folder}/` with `messages/` and `tasks/` subdirs
2. **Host-side** (line 126): Mounts `data/ipc/{group.folder}/` → `/workspace/ipc` inside container
3. **Agent-side** (`ipc-mcp.ts` line 12): Reads/writes to `/workspace/ipc/messages/` and `/workspace/ipc/tasks/`
4. **Host-side** (`src/index.ts` line 395): IPC watcher polls `data/ipc/*/messages/` and `data/ipc/*/tasks/`

### Phase 3 Scope for IPC
- Make `IPC_DIR` configurable via `NANOCLAW_IPC_DIR` env var (defaults to `/workspace/ipc`)
- Do NOT change per-group isolation logic -- that stays in the host-side code
- File-based IPC is optimal for both modes. The IPC watcher already polls `data/ipc/` on the host. In host mode, the agent-runner writes to the same `data/ipc/{group}/` directory via an absolute path instead of a mount. The watcher picks up files identically.
- No need for alternative IPC mechanisms (Unix sockets, named pipes) -- file-based IPC is simple, debuggable, and works identically in both modes.

## Naming Convention Analysis

### Existing Env Var Patterns in Codebase

| Variable | File | Pattern |
|----------|------|---------|
| `ASSISTANT_NAME` | `src/config.ts` | No prefix, SCREAMING_SNAKE |
| `CONTAINER_IMAGE` | `src/config.ts` | No prefix, SCREAMING_SNAKE |
| `CONTAINER_TIMEOUT` | `src/config.ts` | No prefix, SCREAMING_SNAKE |
| `CONTAINER_MAX_OUTPUT_SIZE` | `src/config.ts` | No prefix, SCREAMING_SNAKE |
| `MAX_CONCURRENT_CONTAINERS` | `src/config.ts` | No prefix, SCREAMING_SNAKE |
| `LOG_LEVEL` | `src/mount-security.ts` | No prefix, SCREAMING_SNAKE |
| `SLACK_BOT_TOKEN` | `src/config.ts` | Service prefix, SCREAMING_SNAKE |
| `CLAUDE_CODE_OAUTH_TOKEN` | `src/container-runner.ts` | Product prefix, SCREAMING_SNAKE |
| `CLAUDE_CODE_USE_BEDROCK` | `src/container-runner.ts` | Product prefix, SCREAMING_SNAKE |

### Recommendation: `NANOCLAW_` Prefix

Use `NANOCLAW_` prefix for all NanoClaw-specific path env vars. Rationale:
1. Avoids collision with generic names like `GROUP_DIR` or `IPC_DIR`
2. Makes it obvious which env vars belong to NanoClaw when inspecting a process
3. Consistent with how `CLAUDE_CODE_*` prefixes Claude-specific vars
4. The existing unprefixed vars (`CONTAINER_IMAGE` etc.) are user-facing, set in `.env`. The new path vars are internal, set by the host runner -- the prefix signals "don't set these manually"

Exception: `CLAUDE_CONFIG_DIR` keeps its native name since it's a Claude Agent SDK variable, not a NanoClaw invention.

## Container Rebuild Scope

### Recommendation: Rebuild in This Phase

The container must be rebuilt in this phase because:
1. Success criteria #4 explicitly requires: "Container image rebuilds successfully with the refactored agent-runner"
2. The TypeScript compilation happens inside `docker build` (Dockerfile line 48: `RUN npm run build`)
3. Verifying backward compatibility requires running the rebuilt container

### Build Process
```bash
# Existing build command -- no changes needed
./container/build.sh
```

### What Doesn't Change in the Dockerfile
- No new ENV directives (container uses defaults via fallback)
- No changes to WORKDIR (`/workspace/group`)
- No changes to entrypoint.sh
- No changes to `mkdir -p` for workspace dirs (line 51)
- No changes to volume mount structure

### Verification After Rebuild
```bash
# Test: container should work identically with no env vars set
echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  container run -i nanoclaw-agent:latest
```

## Logging Strategy

### Recommendation: Log Notice on Non-Default Paths

When env vars override defaults, log a notice to stderr (which goes to container logs). When defaults are used, stay silent.

```typescript
// Only log when running in non-container mode (avoids noise in normal operation)
if (NANOCLAW_MODE !== 'container') {
  log(`Mode: ${NANOCLAW_MODE}`);
  log(`Group dir: ${GROUP_DIR}`);
  log(`Global dir: ${GLOBAL_DIR}`);
  log(`IPC dir: ${IPC_DIR}`);
}
```

Rationale: Container mode should produce identical output. Host mode benefits from path visibility for debugging.

## Path Validation Strategy

### Recommendation: Absolute-Only, Warn on Relative

```typescript
function resolvePathVar(envVar: string, defaultPath: string): string {
  const value = process.env[envVar];
  if (!value) return defaultPath;
  if (!path.isAbsolute(value)) {
    log(`Warning: ${envVar}="${value}" is not absolute, using default: ${defaultPath}`);
    return defaultPath;
  }
  return value;
}
```

Rationale: Relative paths would resolve relative to wherever `node` was invoked, which is unpredictable. In container mode, the WORKDIR is `/workspace/group`. In host mode, it depends on how the host runner spawns the process. Absolute-only eliminates ambiguity.

## Config Documentation

### Recommendation: Add Commented Section to nanoclaw.config.jsonc

Per the user's decision, document path env vars in the config file. Since these are env vars (not config fields), they go in a comment block.

```jsonc
  // ─── Path Environment Variables (Host Mode) ────────────────────
  //
  // When executionMode is "host", the host runner sets these env vars
  // on each agent-runner subprocess. You do NOT set these manually.
  //
  // These are documented here for reference and troubleshooting:
  //
  //   NANOCLAW_GROUP_DIR   - Agent working directory (per-group files)
  //   NANOCLAW_GLOBAL_DIR  - Shared global memory directory
  //   NANOCLAW_IPC_DIR     - IPC file exchange directory
  //   NANOCLAW_MODE        - "container" or "host" (affects settingSources)
  //   CLAUDE_CONFIG_DIR    - Claude session storage (SDK variable)
  //
  // In container mode, these are unset and defaults apply (/workspace/*).
  // In host mode, the runner resolves them to absolute macOS paths.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `CLAUDE_HOME` (requested) | `CLAUDE_CONFIG_DIR` (already works) | 2025-12-01 | Use `CLAUDE_CONFIG_DIR` to redirect session storage, not HOME override |
| Override `HOME` env var | `CLAUDE_CONFIG_DIR` env var | 2025-12-01 | No need to manipulate HOME, which would affect all tools |
| Hardcoded settingSources | Configurable via NANOCLAW_MODE | This phase | Enables host mode to inherit user MCP servers |

**Deprecated/outdated:**
- `CLAUDE_HOME`: Never implemented as a separate variable. The existing `CLAUDE_CONFIG_DIR` provides this functionality. The prior research docs (ARCHITECTURE.md, SUMMARY.md) reference `CLAUDE_HOME` -- this should be updated to `CLAUDE_CONFIG_DIR` in the roadmap/docs, but is not a code change for Phase 3.

## Testing Strategy

### Recommendation: Manual Verification

Automated tests would require a container runtime in CI, which adds complexity disproportionate to the change size. Manual verification is sufficient:

1. **Container backward compatibility:**
   - Rebuild container: `./container/build.sh`
   - Run test: `echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | container run -i nanoclaw-agent:latest`
   - Verify: Output contains `NANOCLAW_OUTPUT_START` marker, JSON result with status field

2. **TypeScript compilation check:**
   - `cd container/agent-runner && npx tsc --noEmit`
   - Verify: No compilation errors

3. **Env var fallback check:**
   - With no NANOCLAW_* env vars set, behavior is identical to pre-refactor
   - Container logs should NOT mention mode or paths (silent defaults)

4. **Integration test (after Phase 4):**
   - Full end-to-end test with actual WhatsApp message in container mode
   - This validates the refactored code in production conditions

## Open Questions

1. **Should the roadmap references to `CLAUDE_HOME` be updated to `CLAUDE_CONFIG_DIR`?**
   - What we know: `CLAUDE_CONFIG_DIR` is the correct, already-working env var for session storage redirection. `CLAUDE_HOME` was never implemented.
   - What's unclear: Whether the roadmap success criteria ("Agent-runner reads... CLAUDE_HOME from environment") should be interpreted literally or as the intent (configurable session storage).
   - Recommendation: Treat the roadmap criterion as intent. Phase 3 does not need to set `CLAUDE_CONFIG_DIR` (container mode handles sessions via mounts). Phase 4 will set it. Update the roadmap doc if the user agrees.

2. **Should the tool description string in ipc-mcp.ts be parameterized now or deferred?**
   - What we know: Line 120 has `/workspace/project/data/registered_groups.json` in a `.describe()` string. This is only visible to the AI agent as instructional text. In container mode (main group only), `/workspace/project` is mounted from the host project root, so the path is correct.
   - What's unclear: In host mode (Phase 4), this path won't exist. But Phase 3 only adds env var support -- host mode isn't active yet.
   - Recommendation: Make the description dynamic using the configured path now (minimal effort, prevents a forgotten fix in Phase 4). Pass a `projectDir` to `createIpcMcp()` context, or use a generic description.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of `container/agent-runner/src/index.ts` (10,411 bytes, 343 lines)
- Direct codebase analysis of `container/agent-runner/src/ipc-mcp.ts` (12,153 bytes, 349 lines)
- Direct codebase analysis of `src/container-runner.ts` (host-side container spawner)
- Direct codebase analysis of `container/Dockerfile`
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- `query()` Options, `settingSources`, `env`, `cwd`
- [Claude Code Settings](https://code.claude.com/docs/en/settings) -- `CLAUDE_CONFIG_DIR` documentation
- [CLAUDE_HOME GitHub Issue #84](https://github.com/anthropics/claude-agent-sdk-typescript/issues/84) -- Confirmed `CLAUDE_CONFIG_DIR` is the solution, closed 2025-12-01

### Secondary (MEDIUM confidence)
- Prior research in `.planning/research/ARCHITECTURE.md` -- validated against current code, architecture patterns confirmed
- Prior research in `.planning/research/STACK.md` -- `settingSources` behavior confirmed with official docs
- Prior research in `.planning/research/PITFALLS.md` -- session isolation pitfall confirmed; `CLAUDE_CONFIG_DIR` is the fix

### Tertiary (LOW confidence)
- None. All findings verified against primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, pure Node.js built-ins
- Architecture: HIGH -- direct codebase analysis, every line accounted for
- Pitfalls: HIGH -- derived from actual code paths, verified against container behavior
- CLAUDE_CONFIG_DIR discovery: HIGH -- confirmed via GitHub issue resolution and official docs

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (stable domain, no external dependencies changing)
