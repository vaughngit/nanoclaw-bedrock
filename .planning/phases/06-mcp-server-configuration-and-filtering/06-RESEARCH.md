# Phase 6: MCP Server Configuration and Filtering - Research

**Researched:** 2026-02-10
**Domain:** Zod schema extension, MCP server config format, mode-based filtering, Claude Agent SDK mcpServers integration
**Confidence:** HIGH

## Summary

This phase adds MCP server configuration to `nanoclaw.config.jsonc` with per-server `modes` arrays, filters servers by the current execution mode at agent startup, and passes the filtered set to the Claude Agent SDK's `query()` function alongside the always-injected NanoClaw IPC MCP server.

The implementation is straightforward because the codebase already has all the necessary infrastructure: Zod schema validation with `z.strictObject()`, env var expansion via `expandEnvVars()`, the query options `mcpServers` property, and pino-based structured logging. The new work is: (1) extend the Zod schema with an `mcpServers` field, (2) write a filter function, (3) write a translation function from NanoClaw format to SDK format, (4) wire filtered servers into the agent-runner's `query()` call, and (5) add startup logging.

The critical design insight is that NanoClaw's config format is its own (with `modes` and potentially other metadata), NOT a direct copy of Claude's SDK types. A translation layer converts NanoClaw server configs to the SDK's `McpServerConfig` union type at runtime. This gives NanoClaw freedom to add mode tags, health check settings (Phase 7), and per-group overrides (Phase 8) without being constrained by the SDK schema.

**Primary recommendation:** Extend NanoClawConfigSchema with `mcpServers: z.record(McpServerSchema).optional().default({})`, filter in the agent-runner based on execution mode, translate to SDK format, and merge with the hardcoded `nanoclaw` IPC server.

## Standard Stack

No new libraries needed. This phase uses only existing dependencies.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 | Schema validation for mcpServers config | Already installed, used for all config validation |
| pino | 9.6.0 | Structured startup logging | Already installed, used project-wide |
| strip-json-comments | 5.0.3 | JSONC parsing (already in pipeline) | Already in config-loader.ts pipeline |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @anthropic-ai/claude-agent-sdk | 0.2.29 | Provides McpServerConfig types, query() API | Target format for translation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod 4 z.strictObject | z.object | z.strictObject catches typos in server config keys -- consistent with existing pattern |
| z.record for server map | z.array of named objects | z.record matches the named-object-map format decided in CONTEXT.md |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  config-loader.ts      # MODIFY: Add McpServerSchema + mcpServers to NanoClawConfigSchema
container/agent-runner/
  src/
    index.ts            # MODIFY: Accept MCP servers via ContainerInput, merge with IPC, pass to query()
    mcp-filter.ts       # NEW: filterMcpServersByMode() + translateToSdkFormat()
src/
  host-runner.ts        # MODIFY: Pass MCP servers in ContainerInput
  container-runner.ts   # MODIFY: Pass MCP servers in ContainerInput
nanoclaw.config.jsonc   # MODIFY: Uncomment mcpServers section with real examples
```

### Pattern 1: NanoClaw MCP Config Schema (Zod)
**What:** Define a NanoClaw-specific MCP server schema that extends beyond the SDK types with `modes` and other metadata.
**When to use:** Config loading and validation in `config-loader.ts`.

```typescript
// Source: Codebase analysis of existing Zod patterns + SDK type definitions
const McpServerSchema = z.strictObject({
  // stdio server fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),

  // network server fields (SSE/HTTP)
  type: z.enum(['stdio', 'sse', 'http']).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),

  // NanoClaw-specific fields
  modes: z.array(z.string()).default(['host', 'container']),
});
```

**Key design decisions in this schema:**
- `modes` uses `z.array(z.string())` not `z.array(z.enum(['host', 'container']))` -- CONTEXT.md says "accept any string for future-proofing"
- Default `['host', 'container']` per CONTEXT.md decision
- `z.strictObject()` catches typos like `comand` or `arg` in server configs -- consistent with project-wide pattern [01-01]
- Both stdio fields (command/args/env) and network fields (type/url/headers) in one schema -- validation of mutual exclusivity can be done via Zod `.refine()` or left to runtime (SDK will error if both are provided)

### Pattern 2: Translation to SDK Format
**What:** Convert NanoClaw server config to Claude SDK `McpServerConfig` at runtime, stripping NanoClaw-only fields.
**When to use:** In the agent-runner before passing to `query()`.

```typescript
// Source: SDK sdk.d.ts type definitions (verified from installed package)

// SDK expects one of these types:
// McpStdioServerConfig:  { type?: 'stdio', command: string, args?: string[], env?: Record<string, string> }
// McpSSEServerConfig:    { type: 'sse', url: string, headers?: Record<string, string> }
// McpHttpServerConfig:   { type: 'http', url: string, headers?: Record<string, string> }

function translateToSdkFormat(
  server: NanoClawMcpServer
): McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig {
  if (server.type === 'sse') {
    return { type: 'sse', url: server.url!, headers: server.headers };
  }
  if (server.type === 'http') {
    return { type: 'http', url: server.url!, headers: server.headers };
  }
  // Default: stdio
  return {
    command: server.command!,
    args: server.args,
    env: server.env,
  };
}
```

### Pattern 3: Mode Filtering with Startup Logging
**What:** Filter MCP servers by current execution mode and log both active and filtered servers.
**When to use:** During agent startup, before building query options.

```typescript
// Source: CONTEXT.md decisions + existing codebase logging patterns

function filterMcpServersByMode(
  servers: Record<string, NanoClawMcpServer>,
  currentMode: string,
): { active: Record<string, SdkMcpServerConfig>; filtered: string[] } {
  const active: Record<string, SdkMcpServerConfig> = {};
  const filtered: string[] = [];

  for (const [name, server] of Object.entries(servers)) {
    if (server.modes.includes(currentMode)) {
      active[name] = translateToSdkFormat(server);
    } else {
      filtered.push(name);
    }
  }

  return { active, filtered };
}
```

### Pattern 4: Passing MCP Servers via ContainerInput
**What:** Extend ContainerInput to carry MCP server configs from the host process to the agent-runner subprocess.
**When to use:** Both host-runner and container-runner pass MCP server configs to the agent-runner via stdin.

```typescript
// ContainerInput extension
interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  security?: { sandbox: boolean; tools?: string[] };
  // NEW: MCP servers from config, already filtered by mode
  mcpServers?: Record<string, McpServerConfig>;
}
```

**Why pass pre-filtered servers:** The host process (src/host-runner.ts, src/container-runner.ts) loads config and knows the current execution mode. It filters servers BEFORE passing to the agent-runner subprocess. The agent-runner receives only mode-compatible servers and does not need to know about mode filtering.

### Pattern 5: Merging with Hardcoded IPC MCP Server
**What:** The agent-runner always injects the `nanoclaw` IPC MCP server. Config servers are merged alongside it.
**When to use:** In agent-runner `query()` options construction.

```typescript
// Source: container/agent-runner/src/index.ts line 364
const queryOptions = {
  // ... existing options
  mcpServers: {
    nanoclaw: ipcMcp,                    // Always injected (SDK server, in-process)
    ...input.mcpServers,                 // Config servers (already mode-filtered)
  },
};
```

**Critical: name collision prevention.** If a user names a config server "nanoclaw", it would override the IPC MCP server. The code should either:
- Warn and skip config servers named "nanoclaw" (recommended -- explicit protection)
- Let spread operator win (last-write-wins, which would be the config server -- BAD, breaks IPC)

### Anti-Patterns to Avoid
- **Filtering in agent-runner:** Don't make the agent-runner aware of execution modes for MCP filtering. It receives pre-filtered servers. This keeps the agent-runner mode-agnostic (it already gets the mode via NANOCLAW_MODE for settingSources, but MCP filtering belongs to the spawning process).
- **Copying SDK types into config schema:** Don't make the NanoClaw config format match the SDK exactly. NanoClaw has `modes` and future fields (health checks in Phase 7). The translation layer handles the difference.
- **Putting MCP server configs in .env:** MCP configs are structural (command, args, modes), not secrets. They belong in the JSONC config. Only sensitive values (API keys) go in .env and are referenced via `${VAR}` expansion.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config validation | Custom validation logic | Zod 4 z.strictObject + z.record | Already in use, catches typos, provides type inference |
| Env var expansion in server args | New expansion function | Existing `expandEnvVars()` in config-loader.ts | Already runs on all parsed JSON string values before Zod validation |
| MCP server startup | Custom process spawning for MCP | SDK handles it via `mcpServers` in query() | SDK spawns stdio servers, connects SSE/HTTP servers internally |
| Server health/status | Custom health check pings | SDK's `mcpServerStatus()` API (Phase 7) | SDK manages server lifecycle |

**Key insight:** The Claude Agent SDK handles all MCP server lifecycle management. NanoClaw's job is ONLY: (1) define what servers exist, (2) filter by mode, (3) translate config to SDK format, (4) pass to `query()`. The SDK spawns processes, connects to URLs, handles reconnection, and surfaces status.

## Common Pitfalls

### Pitfall 1: Reserved Server Name "nanoclaw"
**What goes wrong:** User names a config server "nanoclaw", overriding the IPC MCP server. Agent loses IPC communication with the host process (can't send messages, schedule tasks, etc.).
**Why it happens:** Object spread `{ nanoclaw: ipcMcp, ...input.mcpServers }` -- if input contains "nanoclaw", it wins.
**How to avoid:** Check for reserved name "nanoclaw" during validation or at merge time. Log a warning and skip the config server.
**Warning signs:** Agent stops responding to groups, IPC messages not being sent.

### Pitfall 2: z.strictObject vs z.object for Server Schema
**What goes wrong:** Using `z.object()` silently strips unknown fields. User has a typo in an MCP server config key (e.g., `"commnad"` instead of `"command"`) -- it gets silently dropped instead of flagged.
**Why it happens:** z.object() is the default choice; z.strictObject() requires deliberate use.
**How to avoid:** Use `z.strictObject()` consistently, matching the project-wide pattern from decision [01-01].
**Warning signs:** MCP server fails to start with cryptic errors because required fields were silently stripped.

### Pitfall 3: Env Var Expansion Timing
**What goes wrong:** If mcpServers uses `${VAR}` references (e.g., `"env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }`), expansion must happen before Zod validation but after JSON parsing.
**Why it happens:** The existing `expandEnvVars()` in config-loader.ts already runs at the right time (after JSON.parse, before Zod). But if someone adds a separate expansion step for MCP servers, they could double-expand or miss the step entirely.
**How to avoid:** Do NOT add separate env var expansion for MCP servers. The existing `expandEnvVars()` call on the entire parsed config handles everything, including nested MCP server configs.
**Warning signs:** `${VAR}` literals appearing in server env vars at runtime.

### Pitfall 4: Module-Level Logging in config-loader.ts
**What goes wrong:** Using pino logger in config-loader.ts for MCP server validation messages. Messages are silently dropped because pino's async worker thread isn't ready during ESM module evaluation.
**Why it happens:** config-loader.ts runs at module import time as a top-level singleton. Decision [01-02] documents this issue.
**How to avoid:** Use `process.stderr.write()` or `console.error()` for any messages from config-loader.ts, matching the existing pattern. MCP startup logging (active/filtered servers) happens later in the agent-runner where pino IS available.
**Warning signs:** Config validation messages not appearing in output.

### Pitfall 5: mcpServers Field with z.strictObject at Root Level
**What goes wrong:** Adding `mcpServers` to the NanoClawConfigSchema is required because the root schema uses `z.strictObject()` [01-01]. If the field isn't in the schema, having `mcpServers` in the config file triggers "Unknown fields: mcpServers" error.
**Why it happens:** This is the exact reason mcpServers was commented out in Phase 2 -- the schema didn't support it yet.
**How to avoid:** This is the phase that adds it. Uncomment the template examples AND add the field to the Zod schema in the same plan.
**Warning signs:** "Unknown fields: mcpServers" error on startup.

### Pitfall 6: Passing Non-Serializable SDK Objects via Stdin
**What goes wrong:** The IPC MCP server (`createSdkMcpServer()`) returns a `McpSdkServerConfigWithInstance` which contains a live `McpServer` object. This cannot be serialized to JSON. Config MCP servers from the JSONC file are plain data (command/args/url) and CAN be serialized.
**Why it happens:** Confusion between SDK server types (in-process) and config server types (spawned/connected).
**How to avoid:** Only pass serializable MCP server configs (stdio/sse/http) via ContainerInput stdin JSON. The IPC MCP server (`nanoclaw`) is always created in-process by the agent-runner, never passed via stdin.
**Warning signs:** JSON.stringify failing on ContainerInput, or `instance` property being lost.

## Code Examples

### Complete Zod Schema Extension
```typescript
// Source: Existing config-loader.ts patterns + SDK sdk.d.ts types

const McpServerSchema = z.strictObject({
  // stdio server fields
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),

  // network server fields (SSE/HTTP)
  type: z.enum(['stdio', 'sse', 'http']).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),

  // NanoClaw metadata
  modes: z.array(z.string()).default(['host', 'container']),
});

export type McpServerConfig = z.output<typeof McpServerSchema>;

const NanoClawConfigSchema = z.strictObject({
  executionMode: z.enum(['container', 'host']).default('container'),
  hostSecurity: HostSecuritySchema.optional(),
  mcpServers: z.record(z.string(), McpServerSchema).optional().default({}),
});
```

### Config Template (JSONC) -- Uncommented mcpServers
```jsonc
// Source: Existing nanoclaw.config.jsonc pattern + CONTEXT.md examples

  // ─── MCP Servers ──────────────────────────────────────────────────
  //
  // ... existing documentation comments ...
  //
  // "mcpServers": {
  //
  //   // ── Context7: Library documentation ──
  //   "context7": {
  //     "command": "npx",
  //     "args": ["-y", "@upstash/context7-mcp@latest"],
  //     "modes": ["host"]
  //   },
  //
  //   // ── Filesystem: File access for agents ──
  //   "filesystem": {
  //     "command": "npx",
  //     "args": ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}/projects"],
  //     "modes": ["host", "container"]
  //   },
  //
  //   // ── HTTP/SSE remote server example ──
  //   "remote-api": {
  //     "type": "sse",
  //     "url": "https://api.example.com/mcp/sse",
  //     "headers": {
  //       "Authorization": "Bearer ${API_TOKEN}"
  //     },
  //     "modes": ["host"]
  //   }
  //
  // },
```

### Startup Logging Pattern
```typescript
// Source: Existing pino logging pattern in host-runner.ts / agent-runner index.ts

// In agent-runner (where pino IS available via console.error / log())
function logMcpServerStatus(
  configServers: Record<string, unknown>,
  currentMode: string,
  active: string[],
  filtered: string[],
): void {
  if (active.length > 0) {
    log(`MCP servers active (${currentMode} mode): ${active.join(', ')}`);
  }
  if (filtered.length > 0) {
    log(`MCP servers filtered out (not in ${currentMode} mode): ${filtered.join(', ')}`);
  }
  if (active.length === 0 && Object.keys(configServers).length > 0) {
    log(`Warning: all ${Object.keys(configServers).length} configured MCP servers filtered out for ${currentMode} mode`);
  }
}
```

### Full Filter + Translate + Merge Flow
```typescript
// Source: SDK types + codebase patterns

// In agent-runner, after receiving ContainerInput:
const configServers = input.mcpServers ?? {};
const ipcMcp = createIpcMcp({ /* ... */ });

// Config servers are already mode-filtered by the host process.
// Just merge with the always-present IPC server.
// Guard against "nanoclaw" name collision.
const mergedServers: Record<string, any> = { nanoclaw: ipcMcp };
for (const [name, server] of Object.entries(configServers)) {
  if (name === 'nanoclaw') {
    log('Warning: MCP server name "nanoclaw" is reserved for IPC -- skipping config server');
    continue;
  }
  mergedServers[name] = server;
}

const queryOptions = {
  // ... existing options ...
  mcpServers: mergedServers,
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| mcpServers commented out in config template | mcpServers as active Zod schema field | Phase 6 (now) | Users can configure MCP servers |
| Only IPC MCP server in query() | IPC + mode-filtered config servers | Phase 6 (now) | Agents gain external tool access |
| No mode filtering | Servers carry `modes` array, filtered at startup | Phase 6 (now) | Safe mode-aware server selection |

**Deprecated/outdated:**
- The commented-out mcpServers examples in nanoclaw.config.jsonc (Phase 2) should be updated to match the final schema decided here, then uncommented (as JSONC comments showing usage).

## Open Questions

1. **Zod `.refine()` for mutual exclusivity of stdio vs network fields**
   - What we know: A server should have EITHER (command + args) OR (type + url), not both. The SDK will error at runtime if confused.
   - What's unclear: Whether to enforce this at schema level via `.refine()` or let the SDK handle the error at runtime.
   - Recommendation: Add a `.refine()` check -- it gives users a clear config error instead of a cryptic SDK error at agent startup. Something like: "Server 'X' has both 'command' and 'url' -- use one or the other."

2. **Container mode MCP server availability**
   - What we know: Config servers tagged with `modes: ["container"]` will be passed to the agent-runner inside the container. But stdio servers require the command binary to exist inside the container image.
   - What's unclear: Should container-mode MCP servers be supported in Phase 6, or deferred? The container image would need the binaries installed.
   - Recommendation: Support the configuration, but document that stdio servers in container mode require the binary in the container image. SSE/HTTP servers work in container mode if the container has network access. This is a user concern, not a code concern.

3. **Whether to pass pre-filtered or all servers to agent-runner**
   - What we know: CONTEXT.md says "agent startup only loads MCP servers whose modes include the current execution mode." The agent-runner already has `NANOCLAW_MODE` env var.
   - What's unclear: Should the host/container runner pre-filter and pass only active servers, or pass all servers and let the agent-runner filter?
   - Recommendation: Pre-filter in the runner (host-runner.ts / container-runner.ts). The runner knows the mode, does the filtering, and passes only active servers via ContainerInput. The agent-runner just receives and uses them. This keeps the agent-runner simple and avoids it needing to know NanoClaw config schema details. But the logging of filtered servers should happen in the runner too (pino is available there).

## Sources

### Primary (HIGH confidence)
- **SDK sdk.d.ts** (`container/agent-runner/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) -- McpStdioServerConfig, McpSSEServerConfig, McpHttpServerConfig, McpServerConfig union type, query() mcpServers option signature. Verified from installed package v0.2.29.
- **config-loader.ts** (`src/config-loader.ts`) -- Existing NanoClawConfigSchema, expandEnvVars(), z.strictObject() pattern, config singleton pattern. Direct source code analysis.
- **agent-runner index.ts** (`container/agent-runner/src/index.ts`) -- Current query() call with mcpServers: { nanoclaw: ipcMcp }, ContainerInput interface, structured logging pattern.
- **nanoclaw.config.jsonc** -- Current template with commented-out mcpServers examples (from Phase 2).
- **host-runner.ts** (`src/host-runner.ts`) -- Current ContainerInput construction and env passing.
- **container-runner.ts** (`src/container-runner.ts`) -- Current ContainerInput construction.

### Secondary (MEDIUM confidence)
- **.planning/research/STACK.md** -- Previous research on MCP server types, settingSources behavior, mcpServers merging. Cross-verified with SDK types.

### Tertiary (LOW confidence)
- None. All findings verified against source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries, all existing dependencies verified from package.json and node_modules
- Architecture: HIGH - Pattern directly extends existing codebase patterns, SDK types verified from installed package
- Pitfalls: HIGH - All pitfalls derived from actual codebase analysis (z.strictObject, module-level logging, serialization constraints)
- Code examples: HIGH - Types verified against SDK sdk.d.ts, Zod patterns match existing config-loader.ts

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (stable -- no external dependencies changing, internal codebase evolution only)
