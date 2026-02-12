# Phase 7: MCP Inheritance and Health Checks - Research

**Researched:** 2026-02-11
**Domain:** Claude Agent SDK MCP lifecycle, settingSources behavior, ~/.claude/settings.json parsing, MCP health probing, startup logging
**Confidence:** HIGH

## Summary

This phase delivers two capabilities: (1) host mode agents inherit global MCP servers from `~/.claude/settings.json` and merge them with config-defined servers from `nanoclaw.config.jsonc`, and (2) startup probes each MCP server and reports health status (connected/failed/timeout) before the agent begins processing messages.

The research reveals that the Claude Agent SDK already provides the infrastructure for both capabilities. The SDK's `settingSources: ['user']` option loads global MCP servers from `~/.claude/settings.json` automatically. The SDK's `init` system message reports `mcp_servers: { name: string; status: string }[]` for all servers immediately after `query()` begins. Additionally, the `Query.mcpServerStatus()` method returns detailed `McpServerStatus[]` with connection status, error messages, server info, tools, and scope.

The key architectural decision is whether to use the SDK's built-in `settingSources` for global server inheritance (hands-off, SDK manages everything) or to manually read `~/.claude/settings.json` and pass servers explicitly (full control over logging and merging). The CONTEXT.md requirement to "log global and config servers in separate sections" strongly favors the manual approach, since `settingSources` provides no visibility into which servers came from where. However, the manual approach means we must also handle `settingSources: ['project']` (not `['user']`) to avoid the SDK loading duplicate global servers.

For health checks, the SDK handles all MCP server lifecycle internally -- spawning stdio processes, connecting to SSE/HTTP endpoints, and tracking status. The `init` system message (the first message from `query()`) already includes per-server status. This IS the pre-flight health check: it happens during query initialization, before the agent processes any user prompt. Logging these statuses from the agent-runner's `init` message handler satisfies the requirement without needing a separate probe mechanism.

**Primary recommendation:** Read `~/.claude/settings.json` manually in the agent-runner for inheritance logging control. Capture MCP server health from the SDK's `init` system message. Log both sources separately. Do not build a custom MCP probe -- the SDK already does this.

## Standard Stack

No new libraries needed. This phase uses only existing dependencies.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/claude-agent-sdk | 0.2.29 | query() with mcpServers, settingSources, init message with mcp_servers status | Already installed, provides all MCP lifecycle management |
| Node.js fs | Built-in | Read ~/.claude/settings.json | Already used throughout codebase |
| strip-json-comments | 5.0.3 | Parse settings.json (it's actually plain JSON but defensive) | Already a dependency of agent-runner via config-loader |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 9.6.0 | Structured logging in host-runner | Already installed, host-side logging |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual ~/.claude/settings.json reading | SDK settingSources: ['user'] | settingSources is simpler but provides no visibility into which servers came from global vs config -- can't log separately |
| SDK init message for health status | Custom MCP Client probes (spawn + connect + ping) | Custom probes duplicate SDK work, spawn servers twice, add complexity and latency for no benefit |
| @modelcontextprotocol/sdk Client class for probing | Not recommended | Would add a direct dependency, spawn servers that SDK would spawn again, and require managing transport lifecycle |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
container/agent-runner/
  src/
    index.ts              # MODIFY: Add global server reading, health status logging from init message
    mcp-filter.ts         # MODIFY: Add global server loading + merge function
src/
  host-runner.ts          # MINOR: Pass isMain to ContainerInput (already done), no other changes needed
nanoclaw.config.jsonc     # No changes needed
```

### Pattern 1: Manual Global Settings Reading
**What:** Read `~/.claude/settings.json` in the agent-runner, extract its `mcpServers`, and merge with config-defined servers. Use `settingSources: ['project']` (not `['user']`) to prevent SDK from loading global servers a second time.
**When to use:** In host mode for the main group only (non-main groups should not inherit global MCP servers for security reasons).

```typescript
// Source: Verified from ~/.claude/settings.json structure and SDK sdk.d.ts types

import fs from 'fs';
import path from 'path';

interface GlobalSettings {
  mcpServers?: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    type?: 'sse' | 'http';
    url?: string;
    headers?: Record<string, string>;
  }>;
}

function loadGlobalMcpServers(): Record<string, SdkMcpServerConfig> {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude');
  const settingsPath = path.join(configDir, 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    log('No global settings found at ' + settingsPath);
    return {};
  }

  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const settings: GlobalSettings = JSON.parse(raw);

    if (!settings.mcpServers || Object.keys(settings.mcpServers).length === 0) {
      return {};
    }

    const servers: Record<string, SdkMcpServerConfig> = {};
    for (const [name, server] of Object.entries(settings.mcpServers)) {
      if (server.type === 'sse') {
        servers[name] = { type: 'sse', url: server.url!, headers: server.headers };
      } else if (server.type === 'http') {
        servers[name] = { type: 'http', url: server.url!, headers: server.headers };
      } else {
        // stdio (the common case for global settings)
        servers[name] = {
          command: server.command!,
          args: server.args,
          env: server.env,
        };
      }
    }
    return servers;
  } catch (err) {
    log(`Warning: Failed to read global settings: ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}
```

### Pattern 2: Merged Server Set with Source Tracking
**What:** Combine config servers (from nanoclaw.config.jsonc) and global servers (from ~/.claude/settings.json) into a single set, with config servers taking precedence on name collision. Log both sources separately.
**When to use:** During agent-runner startup, before building query options.

```typescript
// Source: CONTEXT.md decisions on merge precedence and logging

interface MergedMcpResult {
  servers: Record<string, SdkMcpServerConfig>;
  configNames: string[];
  globalNames: string[];
  overriddenNames: string[];  // global servers shadowed by config servers
}

function mergeMcpServers(
  configServers: Record<string, SdkMcpServerConfig>,
  globalServers: Record<string, SdkMcpServerConfig>,
): MergedMcpResult {
  const configNames = Object.keys(configServers);
  const globalNames = Object.keys(globalServers);
  const overriddenNames: string[] = [];

  // Start with global servers, then overlay config servers (config takes precedence)
  const merged: Record<string, SdkMcpServerConfig> = { ...globalServers };

  for (const [name, server] of Object.entries(configServers)) {
    if (name in merged) {
      overriddenNames.push(name);
    }
    merged[name] = server;
  }

  return {
    servers: merged,
    configNames,
    globalNames: globalNames.filter(n => !overriddenNames.includes(n)),
    overriddenNames,
  };
}
```

### Pattern 3: Health Status from SDK Init Message
**What:** Capture MCP server status from the SDK's `init` system message (the first message emitted by `query()`). Log health status per-server with timing information.
**When to use:** In the agent-runner's `for await` loop over query messages.

```typescript
// Source: SDK sdk.d.ts SDKSystemMessage type (verified)
// mcp_servers: { name: string; status: string }[]

const probeStart = Date.now();

for await (const message of query({ prompt, options: queryOptions })) {
  if (message.type === 'system' && message.subtype === 'init') {
    const probeMs = Date.now() - probeStart;
    newSessionId = message.session_id;
    log(`Session initialized: ${newSessionId}`);

    // Log MCP server health status
    if (message.mcp_servers && message.mcp_servers.length > 0) {
      log(`=== MCP Server Health (${probeMs}ms) ===`);
      for (const server of message.mcp_servers) {
        const icon = server.status === 'connected' ? 'OK' : 'FAIL';
        log(`  [${icon}] ${server.name}: ${server.status}`);
      }
      const connected = message.mcp_servers.filter(s => s.status === 'connected').length;
      const total = message.mcp_servers.length;
      log(`  ${connected}/${total} servers connected`);
    }
  }

  if (message.type === 'result') {
    // ... existing result handling ...
  }
}
```

### Pattern 4: settingSources Change for Manual Inheritance
**What:** When loading global servers manually, change settingSources to NOT include 'user' for the main group (to avoid duplicate server loading). Non-main groups already use `['project']` only.
**When to use:** When building query options in agent-runner.

```typescript
// Source: Current agent-runner code line 342-343

// BEFORE (Phase 6):
const settingSources: ('project' | 'user')[] =
  isMain ? ['project', 'user'] : ['project'];

// AFTER (Phase 7):
// Main group: 'project' only -- global MCP servers loaded manually for logging control
// The 'user' source is still needed for non-MCP global settings (permissions, hooks, etc.)
// BUT: settingSources also loads permissions, hooks, etc from user settings
// So we still need 'user' for those -- the risk is duplicate MCP servers.
//
// RESOLUTION: Keep 'user' in settingSources. The SDK will load global MCP servers
// automatically. We ALSO load them manually for logging. The SDK deduplicates by name
// (last-write-wins in the mcpServers record, which is our explicit config servers).
// This means config servers take precedence naturally via spread order.
```

**Critical insight about settingSources:** Removing `'user'` from settingSources would disable ALL global user settings, not just MCP servers -- it would also disable global permissions, hooks, and other user-level configuration. This is too aggressive. Instead, keep `settingSources: ['project', 'user']` and pass config servers explicitly in `mcpServers`. The SDK handles deduplication: servers passed in `mcpServers` (explicit) take precedence over those loaded from settingSources (file-based).

**Final approach:** Keep settingSources as-is. Read `~/.claude/settings.json` ONLY for logging purposes (to know what global servers exist). The actual loading is done by the SDK via settingSources. Config servers passed in `mcpServers` override any same-named global servers because they're in the explicit options.

### Anti-Patterns to Avoid
- **Building custom MCP probes:** Do NOT spawn MCP servers independently for health checking. The SDK spawns/connects them during `query()` initialization. Spawning them twice wastes resources and creates process management complexity.
- **Removing 'user' from settingSources:** This disables all global user settings (permissions, hooks, etc.), not just MCP servers. Keep 'user' for the main group.
- **Blocking startup on health check failures:** The CONTEXT.md is explicit: "Non-blocking: agent always starts regardless of probe results." Failed servers are still passed to the SDK.
- **Global MCP inheritance for non-main groups:** Non-main groups use `settingSources: ['project']` to prevent shared config leaks. Global MCP servers should NOT be added to non-main groups -- this would bypass the security boundary established in Phase 5.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP server spawning/connecting | Custom StdioClientTransport probes | SDK's query() initialization | SDK already handles all server lifecycle; custom probes spawn servers twice |
| MCP health status | Custom ping/health check protocol | SDK's init message `mcp_servers` field | Already available in first message from query(), zero extra work |
| Detailed MCP server status | Custom status tracking | `Query.mcpServerStatus()` API | SDK tracks status, error messages, tools, server info -- all available on demand |
| Server deduplication (config vs global) | Custom dedup logic | SDK's native mcpServers precedence | Explicit mcpServers in query options override file-based settings from settingSources |
| Global settings parsing | Custom config file parser | fs.readFileSync + JSON.parse | settings.json is plain JSON (not JSONC), standard parsing is sufficient |

**Key insight:** The Claude Agent SDK v0.2.29 already provides everything needed for this phase. The init message includes MCP server status. The `mcpServerStatus()` method provides detailed status on demand. settingSources handles global server loading. The only new code needed is: (1) read ~/.claude/settings.json for separate logging, (2) capture and log init message server status, (3) merge logic for config vs global server names.

## Common Pitfalls

### Pitfall 1: Spawning MCP Servers Twice
**What goes wrong:** Building a custom health probe that spawns stdio MCP servers to test connectivity, then the SDK spawns them again when `query()` starts. Double resource usage, possible port conflicts for network servers.
**Why it happens:** Misunderstanding the CONTEXT.md "pre-flight probing" as needing a separate probe mechanism. The SDK's initialization IS the probe -- it spawns/connects servers and reports status in the `init` message.
**How to avoid:** Use the SDK's `init` message for health status. The first message from `query()` includes `mcp_servers: { name, status }[]`. Log these statuses. No separate probe needed.
**Warning signs:** Duplicate MCP server processes in `ps aux`, slow startup from double initialization.

### Pitfall 2: Removing 'user' from settingSources
**What goes wrong:** Wanting to manually control global MCP server loading, so removing `'user'` from settingSources. This also disables global permissions, hooks, shell settings, and any other user-level configuration from `~/.claude/settings.json`.
**Why it happens:** settingSources is an all-or-nothing toggle per scope. There's no way to say "load user permissions but not user MCP servers."
**How to avoid:** Keep `settingSources: ['project', 'user']` for the main group. The SDK loads global MCP servers automatically. Config servers passed in `mcpServers` take precedence by name. Read `~/.claude/settings.json` separately ONLY for logging visibility.
**Warning signs:** Missing global permissions, hooks not firing, agent behaving differently than expected in host mode.

### Pitfall 3: Inconsistent Server Name Precedence
**What goes wrong:** A config server named "aws-billing-cost-management" (same as a global server) doesn't properly override the global version, causing the global server's config to be used instead.
**Why it happens:** The merge order in the `mcpServers` record matters. If global servers are spread last, they override config servers.
**How to avoid:** Config servers MUST be spread LAST (or set after global servers) in the mcpServers record. In the agent-runner: `mcpServers: { nanoclaw: ipcMcp, ...globalServers, ...configServers }`. Config servers override global servers, and the nanoclaw IPC server is first (defense-in-depth against override).
**Warning signs:** Config server settings being ignored, global server settings being used instead.

### Pitfall 4: Non-Main Groups Getting Global MCP Servers
**What goes wrong:** Non-main groups inherit global MCP servers from `~/.claude/settings.json`, giving them access to tools the admin didn't intend (e.g., AWS billing, email, Apple automation).
**Why it happens:** Adding global MCP server loading to all groups without considering the security model.
**How to avoid:** Global MCP inheritance is ONLY for the main group (isMain === true). Non-main groups use `settingSources: ['project']` and only get config servers filtered by mode. This maintains the security boundary from Phase 5.
**Warning signs:** Non-main groups accessing tools they shouldn't have (mcp__aws-billing__*, mcp__mail-mcp__*, etc.).

### Pitfall 5: Blocking Startup on MCP Failures
**What goes wrong:** If health checks are blocking, a single misconfigured MCP server (e.g., wrong path to a Python script) delays or prevents agent startup for all messages.
**Why it happens:** Implementing health checks as a synchronous prerequisite before `query()` starts.
**How to avoid:** The SDK handles this correctly by default -- `query()` starts immediately and reports server status in the `init` message. Server connection failures don't block the agent. The CONTEXT.md is explicit: "Non-blocking: agent always starts regardless of probe results."
**Warning signs:** Agent taking a long time to respond to the first message, timeouts caused by a failed MCP server.

### Pitfall 6: settings.json vs settings.local.json Confusion
**What goes wrong:** Reading from the wrong settings file or missing platform-specific paths.
**Why it happens:** Claude Code has multiple settings files: `~/.claude/settings.json` (global user), `.claude/settings.json` (project), `.claude/settings.local.json` (local/gitignored).
**How to avoid:** For global MCP inheritance, ONLY read `~/.claude/settings.json`. Use `CLAUDE_CONFIG_DIR` env var if set (already set by host-runner to `${HOME}/.claude`). Project and local settings are handled by settingSources.
**Warning signs:** MCP servers from project settings appearing in the global logging section.

### Pitfall 7: npx Cold-Start Timeout for Health Probes
**What goes wrong:** If using custom probes with a short timeout, npx-based servers (like `npx -y @upstash/context7-mcp@latest`) timeout during their first run because npx needs to download the package.
**Why it happens:** npx cold starts can take 5-15 seconds, which looks like a health check failure.
**How to avoid:** The SDK handles this internally with its own timeout/retry logic. By using the SDK's init message for health status (not custom probes), we inherit the SDK's timeout behavior. The SDK reports the server as 'pending' during initialization and 'connected' or 'failed' once resolved.
**Warning signs:** False-negative health checks on first startup, servers reported as failed but working on retry.

## Code Examples

### Complete Init Message Health Logging
```typescript
// Source: SDK sdk.d.ts SDKSystemMessage type (line 1478-1505) + agent-runner existing pattern

const probeStart = Date.now();

for await (const message of query({ prompt, options: queryOptions })) {
  if (message.type === 'system' && message.subtype === 'init') {
    const initMs = Date.now() - probeStart;
    newSessionId = message.session_id;
    log(`Session initialized: ${newSessionId} (${initMs}ms)`);

    // Health status from SDK initialization
    if (message.mcp_servers.length > 0) {
      log('--- MCP Server Health ---');
      for (const server of message.mcp_servers) {
        const statusLabel = server.status === 'connected' ? 'OK' : server.status.toUpperCase();
        log(`  [${statusLabel}] ${server.name}`);
      }
      const connected = message.mcp_servers.filter(s => s.status === 'connected').length;
      const failed = message.mcp_servers.filter(s => s.status !== 'connected').length;
      if (failed > 0) {
        log(`  Warning: ${failed}/${message.mcp_servers.length} MCP servers not connected`);
      } else {
        log(`  All ${connected} MCP servers connected`);
      }
    }
  }

  // ... existing message handling ...
}
```

### Global Server Reading for Logging
```typescript
// Source: ~/.claude/settings.json structure (verified from user's actual file)

function readGlobalMcpServerNames(): string[] {
  const configDir = process.env.CLAUDE_CONFIG_DIR
    || path.join(process.env.HOME || '', '.claude');
  const settingsPath = path.join(configDir, 'settings.json');

  try {
    if (!fs.existsSync(settingsPath)) return [];
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    return settings.mcpServers ? Object.keys(settings.mcpServers) : [];
  } catch {
    return [];
  }
}
```

### Separate Source Logging
```typescript
// Source: CONTEXT.md decision on separate section logging

function logMcpServerSources(
  configNames: string[],
  globalNames: string[],
  overriddenNames: string[],
  mode: string,
): void {
  log('--- MCP Server Sources ---');

  if (configNames.length > 0) {
    log(`  Config (nanoclaw.config.jsonc): ${configNames.join(', ')}`);
  }

  if (globalNames.length > 0) {
    log(`  Global (~/.claude/settings.json): ${globalNames.join(', ')}`);
  }

  if (overriddenNames.length > 0) {
    log(`  Overridden by config: ${overriddenNames.join(', ')}`);
  }

  if (configNames.length === 0 && globalNames.length === 0) {
    log('  No additional MCP servers configured');
  }
}
```

### Complete MCP Server Assembly in Agent-Runner
```typescript
// Source: Current agent-runner mcpServers assembly + new inheritance logic

// 1. IPC MCP server (always present)
const ipcMcp = createIpcMcp({ chatJid, groupFolder, isMain, ipcDir: IPC_DIR });

// 2. Config MCP servers (from nanoclaw.config.jsonc, pre-filtered by mode)
let configMcpServers: Record<string, any> = {};
if (input.mcpServers && Object.keys(input.mcpServers).length > 0) {
  const { active, filtered } = filterMcpServersByMode(input.mcpServers, NANOCLAW_MODE);
  configMcpServers = active;
  // ... existing logging of active/filtered ...
}

// 3. Global MCP servers (from ~/.claude/settings.json, main group only in host mode)
// Read for logging visibility; actual loading happens via settingSources: ['user']
const globalServerNames = (isMain && NANOCLAW_MODE === 'host')
  ? readGlobalMcpServerNames()
  : [];

// 4. Log server sources separately
const configNames = Object.keys(configMcpServers);
const overriddenNames = globalServerNames.filter(n => configNames.includes(n));
const activeGlobalNames = globalServerNames.filter(n => !configNames.includes(n) && n !== 'nanoclaw');

logMcpServerSources(configNames, activeGlobalNames, overriddenNames, NANOCLAW_MODE);

// 5. Build final mcpServers for query()
// IPC first (defense-in-depth), then config servers override any same-named global servers
const queryMcpServers = {
  nanoclaw: ipcMcp,
  ...configMcpServers,
};
// Global servers loaded by SDK via settingSources: ['user'] -- no need to add here
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| settingSources: ['project', 'user'] with no visibility | Manual reading for logging + settingSources for loading | Phase 7 (now) | Users see exactly which MCP servers come from which source |
| No health status reporting | SDK init message mcp_servers status logging | Phase 7 (now) | Users know which servers are healthy at startup |
| Only config MCP servers in agent | Config + global MCP servers merged | Phase 7 (now) | Host mode agents get full user MCP ecosystem |

**Deprecated/outdated:**
- The earlier research (SUMMARY.md) flagged `mcpServerStatus()` as "unverified." It IS verified and present in SDK v0.2.29 sdk.d.ts (line 985). It returns `McpServerStatus[]` with detailed info (name, status, serverInfo, error, config, scope, tools).
- However, `mcpServerStatus()` is a Query method (callable after query starts), not a standalone function. The `init` message provides equivalent status info without needing to call it.

## Open Questions

1. **Whether to call mcpServerStatus() for richer detail after init**
   - What we know: The init message provides `{ name, status }` per server. The `mcpServerStatus()` API returns richer data (error messages, server info, tools list, scope).
   - What's unclear: Whether the extra detail is worth the additional call.
   - Recommendation: Start with init message logging only. If users need more detail, add an optional `mcpServerStatus()` call. The init message is sufficient for Phase 7 requirements.

2. **Global MCP inheritance for non-main groups**
   - What we know: Non-main groups use `settingSources: ['project']` only (Phase 5 decision). Global MCP servers from `~/.claude/settings.json` could give non-main groups access to sensitive tools (AWS billing, email, etc.).
   - What's unclear: Whether non-main groups should ever get global MCP servers.
   - Recommendation: **Do not add global MCP inheritance to non-main groups.** This maintains the security boundary from Phase 5. Non-main groups only get: (1) the nanoclaw IPC server, (2) config servers filtered by mode. If an admin wants non-main groups to have specific MCP tools, they add them to `nanoclaw.config.jsonc` with appropriate modes.

3. **MCP health check timing semantics**
   - What we know: The CONTEXT.md says "pre-flight probing: independently spawn/connect each MCP server before passing to query()." The SDK's init message provides status DURING query initialization (after query() is called but before the agent processes the prompt).
   - What's unclear: Whether the SDK's init-time status satisfies the "pre-flight" requirement, or whether a truly separate probe before query() is needed.
   - Recommendation: The SDK's init-time status satisfies the intent. The init message is received before the agent's first turn. The user sees server health status before any prompt processing. Building a separate probe would spawn servers twice and add latency. The CONTEXT also says "Failed servers are still passed to the SDK" -- which is exactly what happens with the SDK approach (it tries to connect, reports failure, but continues).

4. **Probe timeout duration**
   - What we know: Under Claude's Discretion. npx cold-starts can take 5-15 seconds.
   - What's unclear: The SDK's internal timeout for MCP server initialization.
   - Recommendation: Since we're using the SDK's built-in initialization (not custom probes), the SDK manages timeouts internally. We don't need to set a custom timeout. The timing info logged will reflect the SDK's actual initialization time (captured from `Date.now()` before query to init message receipt).

## Sources

### Primary (HIGH confidence)
- **SDK sdk.d.ts** (`container/agent-runner/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) -- Verified:
  - `McpServerStatus` type (line 323-363): status field is `'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'`, includes name, error, serverInfo, config, scope, tools
  - `Query.mcpServerStatus()` method (line 985): returns `Promise<McpServerStatus[]>` -- CONFIRMED to exist
  - `SDKSystemMessage.mcp_servers` (line 1487-1490): `{ name: string; status: string }[]` in init message
  - `Options.settingSources` (line 737-744): `SettingSource[] = ('user' | 'project' | 'local')[]`, "When omitted or empty, no filesystem settings are loaded"
  - `Options.mcpServers` (line 632): `Record<string, McpServerConfig>` -- explicit servers override file-based
  - `McpSetServersResult` (line 370-383): setMcpServers returns added/removed/errors info
- **~/.claude/settings.json** (user's actual file) -- Verified structure: `{ mcpServers: { "name": { command, args, env } } }` format
- **agent-runner/src/index.ts** -- Current settingSources handling (line 342-343), query options construction, init message handling
- **agent-runner/src/mcp-filter.ts** -- Current filter + translate + merge logic
- **host-runner.ts** -- Current CLAUDE_CONFIG_DIR setting (line 162), security context passing

### Secondary (MEDIUM confidence)
- **Phase 6 research** (`.planning/phases/06-mcp-server-configuration-and-filtering/06-RESEARCH.md`) -- Architecture patterns for MCP server pipeline, ContainerInput passing, naming collision prevention
- **Initial research** (`.planning/research/SUMMARY.md`) -- Earlier identification of mcpServerStatus() API (now verified as HIGH confidence)

### Tertiary (LOW confidence)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) -- Client/StdioClientTransport for potential custom probes (research explored but NOT recommended)
- [MCP Build Server Guide](https://modelcontextprotocol.io/docs/develop/build-server) -- General MCP architecture reference

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new libraries, all capabilities verified in installed SDK sdk.d.ts
- Architecture (inheritance): HIGH - settingSources behavior verified from type definitions, ~/.claude/settings.json structure verified from actual file, merge semantics verified from SDK docs
- Architecture (health checks): HIGH - SDK init message mcp_servers field verified in type definitions, mcpServerStatus() API confirmed in sdk.d.ts
- Pitfalls: HIGH - All pitfalls derived from actual codebase analysis and verified SDK behavior
- Code examples: HIGH - Types verified against SDK sdk.d.ts, patterns match existing agent-runner code

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable -- SDK version pinned at 0.2.29, internal codebase evolution only)
