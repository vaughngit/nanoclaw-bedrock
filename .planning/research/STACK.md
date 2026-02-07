# Technology Stack: Host-Native Execution Mode

**Project:** NanoClaw Host-Native Runner
**Researched:** 2026-02-07
**Dimension:** JSONC config parsing, child process management, Claude Agent SDK MCP integration

## Recommended Stack

### JSONC Parsing

| Technology | Version | Purpose | Confidence | Why |
|------------|---------|---------|------------|-----|
| `jsonc-parser` | ^3.3.1 | Parse `nanoclaw.config.jsonc` | HIGH | Microsoft's official JSONC parser. Powers VS Code's own config parsing. Fault-tolerant, handles trailing commas, single and multi-line comments. Zero dependencies. Used by thousands of packages. Battle-tested in production across the VS Code ecosystem. |

**API usage (verified from docs):**
```typescript
import { parse, ParseError, printParseErrorCode } from 'jsonc-parser';

const errors: ParseError[] = [];
const config = parse(fileContent, errors, {
  disallowComments: false,
  allowTrailingComma: true,
  allowEmptyContent: false,
});

if (errors.length > 0) {
  for (const err of errors) {
    logger.warn({ code: printParseErrorCode(err.error), offset: err.offset }, 'JSONC parse error');
  }
}
```

**Why not alternatives:**

| Alternative | Why Not |
|-------------|---------|
| `strip-json-comments` (v5.0.3) | Only strips comments; still need `JSON.parse()` after. No fault tolerance, no trailing comma support, no error reporting with offsets. Two-step process for no benefit. |
| `JSON5` | Heavier, supports features NanoClaw doesn't need (unquoted keys, hex, Infinity). JSONC is the right format because it matches `.mcp.json` and VS Code conventions the user already knows. |
| `comment-json` | Preserves comments on round-trip (write-back), which NanoClaw doesn't need. Larger footprint. |
| `jsonc-parse` (v2.0.0, @luxass) | Newer, lighter, ESM-native. But only 3 months old, far fewer dependents. Not worth the risk vs. Microsoft's battle-tested library. LOW confidence in long-term maintenance. |
| Hand-rolled regex strip | Fragile. Breaks on comments inside strings, edge cases with URLs containing `//`. Never do this. |

### Child Process Management

| Technology | Version | Purpose | Confidence | Why |
|------------|---------|---------|------------|-----|
| Node.js `child_process.spawn()` | Built-in (Node 20+) | Spawn `claude` CLI or agent-runner subprocess | HIGH | Already used throughout codebase (`container-runner.ts`, `host.ts`). Zero new dependencies. Team knows the API. Provides streaming stdout/stderr needed for real-time log capture. |

**Do NOT add execa or tinyexec.** Rationale below.

**Best practices for this project's spawn usage (Node 20+):**

1. **Use `AbortController` for timeout** (replaces manual `setTimeout` + `kill`):
```typescript
const controller = new AbortController();
const { signal } = controller;

// AbortSignal.timeout() is stable in Node 20+
const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

const proc = spawn('claude', args, {
  signal: combinedSignal,
  stdio: ['pipe', 'pipe', 'pipe'],
});
```
Note: `AbortSignal.any()` is stable in Node 20+. This is cleaner than the current `setTimeout` + `exec('container stop ...')` pattern in `container-runner.ts`. Confidence: MEDIUM -- AbortSignal with spawn has had historical edge cases (nodejs/node#37273). Test thoroughly.

2. **Handle `error` event before `close`** -- existing code already does this correctly.

3. **Use `proc.unref()` only if the parent should not wait** -- NOT applicable here since NanoClaw must wait for agent completion.

4. **Stream handling** -- existing pattern (accumulate stdout/stderr with size caps) is correct for this use case.

5. **Graceful shutdown** -- send SIGTERM first, SIGKILL after grace period. Current code does this for containers. Same pattern applies to host processes.

**Why not alternatives:**

| Alternative | Version | Why Not |
|-------------|---------|---------|
| `execa` | 9.6.0 | Adds 15+ transitive dependencies for features NanoClaw doesn't need (shell parsing, pipe chaining, verbose mode). The codebase already has a working spawn pattern. Adding execa would create inconsistency -- some files use raw spawn, others use execa. Not worth it. |
| `tinyexec` | 1.0.1 | Lighter than execa (good), but still an unnecessary dependency. NanoClaw needs: spawn a process, pipe stdin, capture stdout/stderr, handle timeout, handle exit code. Raw `spawn()` does all of this. tinyexec's value is in simpler one-liner commands, not managed long-running processes. |

### Claude Agent SDK Integration

| Technology | Version | Purpose | Confidence | Why |
|------------|---------|---------|------------|-----|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.34 | Run Claude agents programmatically | HIGH | Already used in `container/agent-runner/`. Same SDK, same `query()` API. Host runner reuses the same invocation pattern. |

**Key configuration for host mode:**

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt,
  options: {
    cwd: groupDir,
    resume: sessionId,

    // HOST MODE: Load both project AND user settings
    // 'project' loads .claude/settings.json from cwd ancestry
    // 'user' loads ~/.claude/settings.json (global MCP servers!)
    settingSources: ['project', 'user'],

    // MCP servers from nanoclaw.config.jsonc (filtered by mode)
    // MERGED with servers from settingSources
    mcpServers: filteredMcpServers,

    allowedTools: [...],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  }
})) {
  // ... handle messages
}
```

**Critical architectural detail -- `settingSources` behavior:**

| `settingSources` value | What loads | When to use |
|------------------------|-----------|-------------|
| `['project']` | `.claude/settings.json` from project tree only | Container mode (current). Isolated. No global MCP servers leak in. |
| `['project', 'user']` | Project settings + `~/.claude/settings.json` | **Host mode.** User's global MCP servers (configured in Claude Code settings) become available. This is the key differentiator of host mode. |
| `['project', 'user', 'local']` | All scopes | Not recommended. Local overrides add unpredictability. |
| omitted/undefined | Nothing from filesystem | SDK-only mode. Not useful here. |

Confidence: HIGH. Verified from official Anthropic Agent SDK docs and existing codebase usage.

**MCP server types supported in `mcpServers` option:**

| Type | Config Shape | Notes |
|------|-------------|-------|
| stdio | `{ command: string, args?: string[], env?: Record<string, string> }` | Default type. Spawns a local process. |
| SSE | `{ type: 'sse', url: string, headers?: Record<string, string> }` | Server-Sent Events transport. |
| HTTP | `{ type: 'http', url: string, headers?: Record<string, string> }` | Streamable HTTP transport. |
| SDK | `{ type: 'sdk', ... }` | In-process SDK server (like the existing `nanoclaw` IPC MCP). |

**MCP tool naming convention:** `mcp__<server-name>__<tool-name>` (e.g., `mcp__nanoclaw__schedule_task`).

**Programmatic `mcpServers` override filesystem:** If you pass `mcpServers` in `query()` options, those servers are added alongside any loaded from `settingSources`. Programmatic options always take precedence on conflict.

### Config Validation

| Technology | Version | Purpose | Confidence | Why |
|------------|---------|---------|------------|-----|
| `zod` | ^4.3.6 (already installed) | Validate parsed JSONC config against schema | HIGH | Already a dependency. Zod 4 supports ES modules. Define a `NanoClawConfig` schema, parse the JSONC output through it. Get type-safe config with clear error messages on invalid config. |

**Usage pattern:**
```typescript
import { z } from 'zod';
import { parse } from 'jsonc-parser';

const McpServerSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  type: z.enum(['stdio', 'sse', 'http']).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  env: z.record(z.string()).optional(),
  modes: z.array(z.enum(['host', 'container'])).default(['host', 'container']),
});

const ConfigSchema = z.object({
  executionMode: z.enum(['container', 'host']).default('container'),
  mcpServers: z.record(McpServerSchema).default({}),
  // ... other config fields
});

export type NanoClawConfig = z.infer<typeof ConfigSchema>;
```

### No New Dependencies Needed

| Category | Recommendation |
|----------|---------------|
| JSONC parsing | `jsonc-parser` -- NEW dependency (tiny, zero transitive deps) |
| Child process | `child_process` -- BUILT-IN, no dependency |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` -- EXISTING dependency (upgrade to ^0.2.34) |
| Config validation | `zod` -- EXISTING dependency |
| Logging | `pino` -- EXISTING dependency |
| TypeScript | `typescript` + `tsx` -- EXISTING dev dependencies |

**Total new production dependencies: 1** (`jsonc-parser`)

## Architecture Pattern: Host Runner as Agent-Runner Variant

The host-native runner should NOT be a separate codebase from the container agent-runner. Instead:

```
src/
  config-loader.ts       # NEW: Parse nanoclaw.config.jsonc, validate with Zod
  container-runner.ts    # EXISTING: Spawns Apple Container / Docker
  host-runner.ts         # NEW: Spawns agent-runner directly on macOS
  runner.ts              # NEW: Dispatcher -- reads config, delegates to container or host runner

container/agent-runner/
  src/index.ts           # EXISTING: Claude Agent SDK query() invocation
                         # Reused in host mode as a subprocess
```

**Key insight from PROJECT.md:** "In host mode, this same logic runs as a direct Node.js subprocess instead of inside a container. The IPC protocol (filesystem JSON files) works identically in both modes."

The host-runner spawns the agent-runner as:
```typescript
spawn('node', ['--import', 'tsx/esm', 'container/agent-runner/src/index.ts'], {
  cwd: process.cwd(),
  env: { ...filteredEnv },
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

Or, if compiled:
```typescript
spawn('node', ['container/agent-runner/dist/index.js'], { ... });
```

The only change needed in `agent-runner/src/index.ts` for host mode: accept `settingSources` as part of `ContainerInput` so the host-runner can pass `['project', 'user']` while container mode continues to pass `['project']`.

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| `execa` | Unnecessary dependency. Codebase already uses raw `spawn()` consistently. Adding execa creates two patterns for the same thing. |
| `tinyexec` | Same reasoning. Lighter than execa but still not needed. |
| `JSON5` | Wrong format. JSONC (JSON with Comments) is the standard used by VS Code, TypeScript, and Claude's own `.mcp.json`. JSON5 adds features that create confusion. |
| `comment-json` | Round-trip comment preservation is not needed. NanoClaw reads config, never writes it back. |
| `cosmiconfig` | Config discovery library. Overkill -- NanoClaw has one config file at a known path. |
| `dotenv` | Already using Node 20+ `--env-file=.env` flag. No library needed. |
| `convict` | Config validation library. Zod already handles this better with TypeScript integration. |
| `node-config` | Hierarchical config with environment overrides. Wrong paradigm. NanoClaw has one file, not layered environments. |

## Installation

```bash
# New production dependency (JSONC parsing)
npm install jsonc-parser

# Upgrade Agent SDK to latest (if not already)
npm install @anthropic-ai/claude-agent-sdk@latest
# Note: Agent SDK is in container/agent-runner/package.json, not root
```

No new dev dependencies needed.

## Confidence Assessment

| Decision | Confidence | Basis |
|----------|------------|-------|
| `jsonc-parser` for JSONC | HIGH | Official Microsoft library, 3.3.1 stable, used by VS Code. Verified via npm registry and GitHub. |
| Raw `child_process.spawn()` | HIGH | Already in codebase, zero new deps, team expertise. Node.js official docs confirm all needed features. |
| `settingSources: ['project', 'user']` for host mode | HIGH | Verified from official Anthropic Agent SDK docs. Matches PROJECT.md requirement. |
| `mcpServers` merging with settingSources | MEDIUM | Docs state programmatic options override filesystem settings. "Merge" behavior for mcpServers specifically needs validation during implementation -- confirm servers are additive, not replacement. |
| `AbortSignal.timeout()` for process timeout | MEDIUM | Stable in Node 20+, but AbortSignal+spawn has had edge cases historically. Test on target Node version (25.5.0). |
| Zod for config validation | HIGH | Already a project dependency, proven pattern, excellent TypeScript integration. |
| Agent SDK ^0.2.34 | HIGH | Latest version as of 2026-02-07. Verified via npm. Backward compatible with existing 0.2.29 usage. |

## Sources

- [jsonc-parser on npm](https://www.npmjs.com/package/jsonc-parser) -- version 3.3.1 confirmed
- [jsonc-parser on GitHub (Microsoft)](https://github.com/microsoft/node-jsonc-parser) -- API reference
- [Claude Agent SDK MCP docs](https://platform.claude.com/docs/en/agent-sdk/mcp) -- settingSources, mcpServers config
- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- query() options, McpServerConfig types
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- version 0.2.34 confirmed
- [Node.js child_process docs (v25.6.0)](https://nodejs.org/api/child_process.html) -- spawn, AbortSignal support
- [strip-json-comments on npm](https://www.npmjs.com/package/strip-json-comments) -- v5.0.3, evaluated and rejected
- [execa on npm](https://www.npmjs.com/package/execa) -- v9.6.0, evaluated and rejected
- [tinyexec on npm](https://www.npmjs.com/package/tinyexec) -- v1.0.1, evaluated and rejected
- [tinyexec on GitHub](https://github.com/tinylibs/tinyexec) -- API surface review
- [Claude Agent SDK GitHub](https://github.com/anthropics/claude-agent-sdk-typescript) -- changelog, McpServerConfig types
- [JSONC specification](https://jsonc.org/) -- format definition
