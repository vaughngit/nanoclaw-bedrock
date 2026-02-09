# Phase 5: Host Mode Security - Research

**Researched:** 2026-02-09
**Domain:** macOS Seatbelt sandbox, Claude Agent SDK security options, IPC authorization
**Confidence:** HIGH (verified against SDK type definitions, official docs, and existing codebase)

## Summary

This phase adds security boundaries to host-mode agents: macOS Seatbelt sandbox for filesystem/network isolation, IPC authorization for cross-group write prevention, configurable tool allow-lists, and permission mode differentiation between main and non-main groups.

The core implementation mechanism is the Claude Agent SDK's `query()` options: `sandbox` (SandboxSettings), `permissionMode`, `tools` (restricts available tools), and `disallowedTools`. The SDK delegates sandbox enforcement to the `@anthropic-ai/sandbox-runtime` npm package, which generates dynamic Seatbelt profiles on macOS. NanoClaw's agent-runner already passes these options to `query()` -- this phase conditionally varies them based on `isMain` and config.

**Primary recommendation:** Use the SDK's built-in `sandbox` option with `enabled: true` for non-main groups. Use `tools` (not `allowedTools`) to restrict available tools. Use `permissionMode: 'default'` for non-main groups. Use PreToolUse hooks to enforce IPC write isolation at the application layer. Use the IPC MCP `send_message` tool to surface permission denial explanations to group chat.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.29 (installed) | Agent execution with sandbox, permission, tool options | Already used; provides `sandbox`, `tools`, `permissionMode` options |
| `zod` (v4) | installed | Config schema validation | Already used in `config-loader.ts` with `z.strictObject` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sandbox-runtime` | 0.0.34 | Standalone sandbox tool (macOS Seatbelt/Linux bubblewrap) | NOT needed -- the Agent SDK handles sandbox internally via its `sandbox` option. Only relevant if we wanted to sandbox outside the SDK |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SDK `sandbox` option | Manual `sandbox-exec` invocation in host-runner | Much more work, duplicates SDK internals, harder to maintain. The SDK already wraps sandbox-runtime. Use SDK. |
| SDK `tools` restriction | `disallowedTools` | `disallowedTools` removes tools from model context entirely. `tools` is a positive list (allowlist). Per the decisions, user wants an allow-list, so `tools` is the right choice. |
| Zod config validation | Manual JSON validation | Zod already used, consistent with existing pattern |

**Installation:** No new packages needed. All functionality comes from existing SDK options that aren't currently utilized.

## Architecture Patterns

### Recommended Changes to Existing Structure

```
src/
├── host-runner.ts           # MODIFY: pass security config to agent-runner env
├── config-loader.ts         # MODIFY: add hostSecurity schema
├── types.ts                 # MODIFY: add security fields to RegisteredGroup
container/agent-runner/
├── src/
│   ├── index.ts             # MODIFY: conditional sandbox/permissionMode/tools
│   └── ipc-mcp.ts           # MODIFY: IPC write path validation
nanoclaw.config.jsonc         # MODIFY: uncomment & populate hostSecurity section
```

### Pattern 1: Conditional Security Options in Agent Runner

**What:** The agent-runner receives `isMain` and security config via stdin/env. It conditionally sets `sandbox`, `permissionMode`, and `tools` options on the `query()` call.

**When to use:** Every agent invocation in host mode.

**Example:**
```typescript
// In agent-runner/src/index.ts
// Source: SDK type definitions (sdk.d.ts)

const isMain = input.isMain;

// Security differentiation between main and non-main
const queryOptions = {
  cwd: GROUP_DIR,
  systemPrompt: /* ... existing ... */,

  // TOOLS: controls which tools are AVAILABLE (positive allowlist)
  // Different from allowedTools which controls auto-approval
  tools: isMain
    ? { type: 'preset' as const, preset: 'claude_code' as const }
    : (securityConfig.allowedTools || [
        'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'mcp__nanoclaw__*'
      ]),

  // PERMISSION MODE: main bypasses, non-main uses default
  permissionMode: isMain
    ? 'bypassPermissions' as const
    : 'default' as const,
  allowDangerouslySkipPermissions: isMain,

  // SANDBOX: main exempt, non-main sandboxed
  sandbox: isMain
    ? undefined  // No sandbox for main
    : {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
      },

  // ... rest of existing options ...
};
```

### Pattern 2: Two-Tier Config with Per-Group Override

**What:** Global defaults in `nanoclaw.config.jsonc`, per-group overrides in the `registered_groups` DB table.

**When to use:** When building the security config for each agent invocation.

**Example:**
```typescript
// In host-runner.ts or agent-runner
// Merge global config with per-group override
function resolveSecurityConfig(
  globalConfig: HostSecurityConfig,
  groupOverride?: GroupSecurityOverride
): ResolvedSecurityConfig {
  return {
    sandbox: groupOverride?.sandbox ?? globalConfig.sandbox ?? true,
    allowedTools: groupOverride?.allowedTools ?? globalConfig.allowedTools ?? undefined,
    permissionMode: groupOverride?.permissionMode ?? globalConfig.permissionMode ?? 'default',
  };
}
```

### Pattern 3: IPC Write Isolation via Path Validation

**What:** Validate that the IPC directory the agent writes to matches its own group folder. Defense in depth: application-level check in ipc-mcp.ts AND directory structure enforced by host-runner.

**When to use:** Every IPC write operation.

**Example:**
```typescript
// In ipc-mcp.ts - already partially done but needs hardening
function writeIpcFile(dir: string, data: object): string {
  // Defense in depth: verify the target dir is within our IPC namespace
  const normalizedDir = path.resolve(dir);
  const normalizedIpcBase = path.resolve(IPC_DIR);
  if (!normalizedDir.startsWith(normalizedIpcBase + path.sep) &&
      normalizedDir !== normalizedIpcBase) {
    throw new Error(`IPC write blocked: ${dir} is outside ${IPC_DIR}`);
  }
  // ... existing atomic write logic ...
}
```

### Pattern 4: Permission Denial Messaging via IPC

**What:** When a non-main agent's tool use is denied (by sandbox or permission mode), use a PreToolUse hook or PostToolUseFailure hook to detect the denial and send an explanatory message to the group chat via the NanoClaw IPC MCP `send_message` tool.

**When to use:** Non-main groups only.

**Example:**
```typescript
// PreToolUse hook to intercept and explain denials
// Source: SDK hooks documentation
const permissionDenialHook: HookCallback = async (input, toolUseId, { signal }) => {
  // This hook can detect when the default permission mode would deny
  // and return additional context for the model
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: 'If this action is denied due to permissions, explain to the group that you cannot complete it and suggest contacting the admin.',
    }
  };
};
```

### Pattern 5: Sandbox Violation Alert via WhatsApp

**What:** When a sandbox violation occurs, the host-runner or a PostToolUseFailure hook detects it and sends an immediate WhatsApp alert to the main group.

**When to use:** Non-main groups with sandbox enabled.

**Example:**
```typescript
// PostToolUseFailure hook to detect sandbox violations
const sandboxViolationHook: HookCallback = async (input, toolUseId, { signal }) => {
  const failureInput = input as PostToolUseFailureHookInput;
  if (failureInput.error?.includes('sandbox') ||
      failureInput.error?.includes('Seatbelt')) {
    // Write IPC alert file for main group
    const alertData = {
      type: 'message',
      chatJid: MAIN_GROUP_JID,
      text: `[SANDBOX ALERT] Group "${groupFolder}" attempted blocked action: ${failureInput.tool_name} - ${failureInput.error}`,
      groupFolder: 'main',
      timestamp: new Date().toISOString()
    };
    writeIpcFile(path.join(MAIN_IPC_DIR, 'messages'), alertData);
  }
  return {};
};
```

### Anti-Patterns to Avoid

- **Using `allowedTools` for restriction:** `allowedTools` in the SDK means "auto-approve these tools without permission prompts." It does NOT restrict which tools are available. The current codebase uses `allowedTools` -- this needs to change to `tools` for actual restriction. `allowedTools` should only be used alongside `permissionMode: 'default'` to specify which tools don't need permission prompts.
- **Passing sandbox config via env vars:** The sandbox config should flow through stdin (ContainerInput) to the agent-runner, not as separate env vars. The env vars approach is fragile and doesn't support complex nested objects.
- **Custom Seatbelt profile generation:** Don't write .sb profile files manually. The SDK's sandbox option handles Seatbelt profile generation internally via sandbox-runtime. Custom profiles would conflict with SDK internals.
- **Blocking IPC writes at filesystem level only:** Filesystem-level (Seatbelt) restrictions on IPC dirs are the OS enforcement layer, but application-level validation in `writeIpcFile()` is the primary defense. Both layers needed for defense in depth.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| macOS sandbox enforcement | Custom sandbox-exec wrapper, .sb profile files | SDK `sandbox` option (`SandboxSettings`) | SDK internally uses sandbox-runtime which generates Seatbelt profiles dynamically. Custom profiles would conflict. |
| Tool restriction for agents | Custom tool filtering, prompt injection to hide tools | SDK `tools` option (positive list) or `disallowedTools` (negative list) | SDK enforces at the tool registration level. Tools not in the list are completely removed from model context. |
| Permission mode switching | Custom canUseTool logic to mimic permission modes | SDK `permissionMode` option | SDK has built-in modes: 'default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk' |
| Sandbox violation detection | Parsing stderr for Seatbelt messages | SDK `PostToolUseFailure` hooks + error message inspection | Hook system reliably captures all tool failures including sandbox violations |
| Config validation | Manual JSON parsing + if/else validation | Zod schemas (already in use) | `z.strictObject` catches typos, provides typed output, consistent with existing pattern |

**Key insight:** The Claude Agent SDK already provides all the security primitives needed. This phase is about wiring the existing SDK options to NanoClaw's group-based configuration system, not building new security infrastructure.

## Common Pitfalls

### Pitfall 1: `allowedTools` vs `tools` Confusion

**What goes wrong:** Using `allowedTools` thinking it restricts available tools, when it actually only controls auto-approval. A non-main agent with `allowedTools: ['Read', 'Grep']` and `permissionMode: 'bypassPermissions'` still has access to ALL tools.
**Why it happens:** The naming is confusing. `allowedTools` = "these tools are allowed to run without permission prompts." `tools` = "these are the only tools available."
**How to avoid:** Always use `tools` for restriction. Only use `allowedTools` alongside non-bypass permission modes for tools that should auto-approve.
**Warning signs:** Non-main agents executing Bash commands or Write operations when they shouldn't be able to.

### Pitfall 2: Sandbox + bypassPermissions = No Protection

**What goes wrong:** Setting `sandbox.enabled: true` but also `permissionMode: 'bypassPermissions'` with `sandbox.allowUnsandboxedCommands: true`. The model can set `dangerouslyDisableSandbox: true` on any Bash command and bypass the sandbox entirely, with bypassPermissions auto-approving the unsandboxed execution.
**Why it happens:** bypassPermissions auto-approves everything including unsandboxed command requests.
**How to avoid:** For non-main groups: always use `permissionMode: 'default'` AND `sandbox.allowUnsandboxedCommands: false`. This ensures the sandbox cannot be escaped.
**Warning signs:** Non-main agents running Bash commands with `dangerouslyDisableSandbox: true`.

### Pitfall 3: Main Group IPC Directory Access

**What goes wrong:** If sandbox Seatbelt profile restricts writes to only the group's own IPC dir, the sandbox violation alert mechanism (writing to main group's IPC dir) will be blocked.
**Why it happens:** The alert hook needs to write to the MAIN group's IPC messages dir, not its own.
**How to avoid:** The sandbox violation alert should be handled by the host-runner process (which runs unsandboxed), not by the sandboxed agent-runner. The agent-runner should signal violations through its own output, and the host-runner processes them.
**Warning signs:** Sandbox violation alerts never appearing in the main group chat.

### Pitfall 4: Shared ~/.claude Config Leaking Permissions

**What goes wrong:** Host mode shares `~/.claude` via `CLAUDE_CONFIG_DIR`. If one group's session writes permission rules to `~/.claude/settings.json`, those persist and affect other groups.
**Why it happens:** Prior decision [04-01] chose shared `~/.claude` for host mode.
**How to avoid:** Use `settingSources: ['project']` for non-main groups (skip 'user' settings). Or use the SDK's programmatic options which override filesystem settings. Current code already uses `settingSources: ['project', 'user']` for host mode -- non-main should drop 'user'.
**Warning signs:** Non-main groups inheriting permission rules they shouldn't have.

### Pitfall 5: Config Template Commenting Out All Tools

**What goes wrong:** User comments out ALL tools in the config template's allow-list, leaving an empty array. An empty `tools: []` array disables ALL built-in tools, making the agent completely non-functional.
**Why it happens:** Config template uses comment-out pattern for restriction.
**How to avoid:** Validate that `tools` array is non-empty in config-loader. If empty, treat as "no restriction" (use preset). Document this behavior clearly in the config template.
**Warning signs:** Agent returning errors about having no tools available.

### Pitfall 6: Sandbox Blocking SDK-Internal Operations

**What goes wrong:** The Seatbelt sandbox may block the agent-runner's own file operations (writing IPC files, reading CLAUDE.md, writing session data to ~/.claude).
**Why it happens:** The sandbox restricts ALL filesystem access from the bash tool's subprocess, but the agent-runner itself runs outside the sandbox. The SDK sandboxes Bash commands, not the entire process.
**How to avoid:** Understand that `sandbox` in the SDK only applies to Bash tool execution. Read/Write/Edit tools are controlled by permission rules, not sandbox. The agent-runner process itself is not sandboxed.
**Warning signs:** This is actually a non-issue once you understand the architecture.

## Code Examples

### Example 1: Extended Config Schema

```typescript
// Source: existing config-loader.ts pattern, SDK type definitions

const HostSecuritySchema = z.strictObject({
  sandbox: z.boolean().default(true),
  allowedTools: z.array(z.string()).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'dontAsk']).default('default'),
}).optional();

const NanoClawConfigSchema = z.strictObject({
  executionMode: z.enum(['container', 'host']).default('container'),
  hostSecurity: HostSecuritySchema,
});
```

### Example 2: Security Config Flow Through ContainerInput

```typescript
// Source: existing ContainerInput pattern in container-runner.ts

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  // NEW: security configuration for the agent-runner
  security?: {
    sandbox: boolean;
    allowedTools?: string[];
    permissionMode: 'default' | 'acceptEdits' | 'dontAsk';
  };
}
```

### Example 3: Agent Runner Security Branching

```typescript
// Source: SDK Options type (sdk.d.ts lines 447-797)

// In agent-runner/src/index.ts main()
const securityConfig = input.security;
const isMain = input.isMain;

// Build query options with security differentiation
const queryOptions: Parameters<typeof query>[0]['options'] = {
  cwd: GROUP_DIR,
  settingSources: isMain ? ['project', 'user'] : ['project'],

  // Tool availability
  tools: isMain
    ? undefined  // All tools available (SDK default)
    : (securityConfig?.allowedTools ?? [
        'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'mcp__nanoclaw__*'
      ]),

  // Permission mode
  permissionMode: isMain ? 'bypassPermissions' : (securityConfig?.permissionMode ?? 'default'),
  allowDangerouslySkipPermissions: isMain,

  // Sandbox
  sandbox: (!isMain && securityConfig?.sandbox !== false) ? {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
  } : undefined,

  // ... existing options (systemPrompt, mcpServers, hooks, outputFormat) ...
};
```

### Example 4: Host Runner Passing Security Config

```typescript
// Source: existing host-runner.ts pattern

// In host-runner.ts runHostAgent()
const securityConfig = resolveSecurityConfig(
  config.hostSecurity,    // global from nanoclaw.config.jsonc
  group.securityOverride  // per-group from registered_groups DB
);

const agentInput: ContainerInput = {
  prompt,
  sessionId,
  groupFolder: group.folder,
  chatJid,
  isMain,
  security: isMain ? undefined : securityConfig,
};

// Send to agent-runner via stdin
proc.stdin.write(JSON.stringify(agentInput));
```

### Example 5: Sandbox Violation Alert in Host Runner

```typescript
// Source: existing host-runner.ts output handling pattern

// In host-runner.ts, after agent completes
if (output.status === 'error' && !isMain) {
  const errorMsg = output.error || '';
  // Check for sandbox-related errors
  if (errorMsg.includes('sandbox') || errorMsg.includes('Seatbelt') ||
      errorMsg.includes('Operation not permitted')) {
    // Write alert to main group's IPC messages dir
    const mainIpcDir = path.join(DATA_DIR, 'ipc', MAIN_GROUP_FOLDER, 'messages');
    fs.mkdirSync(mainIpcDir, { recursive: true });
    const alertFile = `${Date.now()}-sandbox-alert.json`;
    const alertData = {
      type: 'message',
      chatJid: mainGroupJid,
      text: `[SANDBOX ALERT] Agent in "${group.name}" hit a restriction: ${errorMsg.slice(0, 200)}`,
      groupFolder: MAIN_GROUP_FOLDER,
      timestamp: new Date().toISOString()
    };
    const tempPath = path.join(mainIpcDir, `${alertFile}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(alertData, null, 2));
    fs.renameSync(tempPath, path.join(mainIpcDir, alertFile));
  }
}
```

### Example 6: Permission Denial Hook for Non-Main Groups

```typescript
// Source: SDK hooks documentation, PreToolUse hook pattern

// Hook added to non-main agent queryOptions
const hooks = {
  PreToolUse: [{
    hooks: [async (input: HookInput, toolUseId: string | undefined, { signal }: { signal: AbortSignal }) => {
      // Add context so the model explains restrictions to users
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          additionalContext: 'If any tool use is denied due to permissions or sandbox restrictions, use the mcp__nanoclaw__send_message tool to explain to the group what you cannot do and why. Suggest they contact the admin group for assistance.',
        }
      };
    }]
  }],
  // ... existing PreCompact hooks ...
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `allowedTools` for restriction | `tools` for restriction, `allowedTools` for auto-approval | SDK 0.2.x clarified semantics | Must change agent-runner to use `tools` instead of `allowedTools` for actual tool restriction |
| `permissionMode: 'bypassPermissions'` for all | Differentiated: bypass for main, default/acceptEdits for others | SDK has always supported this | Non-main groups should NOT get bypassPermissions |
| No sandbox option | `sandbox: SandboxSettings` on query options | SDK 0.1.x+ | macOS Seatbelt sandbox available via single option |
| Manual .sb profile files | SDK handles profile generation internally | Always (via sandbox-runtime) | Don't hand-roll Seatbelt profiles |

**Deprecated/outdated:**
- Claude Code SDK renamed to Claude Agent SDK (migration guide at platform.claude.com). Package name: `@anthropic-ai/claude-agent-sdk` (already using correct name).
- The `sandbox-runtime` package exists separately but is used internally by the Agent SDK. No need to install it directly.

## Open Questions

1. **Sandbox + IPC write path**
   - What we know: The SDK sandbox restricts Bash tool filesystem access. Read/Write/Edit tools are separate from sandbox (controlled by permission rules). The IPC MCP server uses Node.js `fs.writeFileSync` in-process, not via the Bash tool.
   - What's unclear: Does the SDK sandbox affect in-process MCP tool execution (fs.writeFileSync in the IPC MCP handler)? Almost certainly NOT, since sandbox only wraps Bash subprocess execution, but should be validated.
   - Recommendation: Test that the IPC MCP `writeIpcFile` function works correctly when sandbox is enabled. If it does (expected), application-level path validation is sufficient for IPC isolation.

2. **NanoClaw MCP tools and allow-list**
   - What we know: `mcp__nanoclaw__*` pattern matches all NanoClaw MCP tools. The `tools` option can include glob patterns like `mcp__nanoclaw__*`.
   - What's unclear: Whether removing `mcp__nanoclaw__*` from the `tools` list actually prevents the agent from using NanoClaw MCP tools.
   - Recommendation: Always include `mcp__nanoclaw__*` in the tools list for all groups (Claude's discretion item). These are NanoClaw's own coordination tools and should always be available. The MCP tools already have their own authorization (e.g., only main can register_group).

3. **Main group JID for alerts**
   - What we know: The host-runner needs to know the main group's chat JID to send sandbox violation alerts. The registered_groups DB has JID-to-folder mapping.
   - What's unclear: The cleanest way to look up the main group's JID from the host-runner.
   - Recommendation: Look up main group JID from `registeredGroups` in `index.ts` and pass it through ContainerInput, or have the host-runner query the DB directly.

4. **Error message format for sandbox violations**
   - What we know: The SDK returns errors when sandbox blocks operations. PostToolUseFailure hooks capture these.
   - What's unclear: The exact error message format for Seatbelt violations on macOS (whether it says "sandbox", "Seatbelt", "Operation not permitted", etc.)
   - Recommendation: Test with sandbox enabled and a deliberately blocked operation. Match broadly on multiple keywords. Log the exact error format for future reference.

## Discretion Recommendations

Based on the phase context "Claude's Discretion" items:

1. **NanoClaw MCP tools (mcp__nanoclaw__*) follow the allow-list or always available?**
   - **Recommendation: Always available.** These are NanoClaw's coordination tools (send_message, schedule_task, etc.) and already have authorization logic (only main can register_group). Removing them from non-main groups would break basic IPC communication.

2. **IPC cross-group violations: WhatsApp alerts or just log?**
   - **Recommendation: Just log.** Cross-group IPC violations are bugs in NanoClaw's own code, not agent misbehavior. Alerting via WhatsApp would be noise. The existing `logger.warn('Unauthorized IPC message attempt blocked')` in index.ts is sufficient.

3. **Main group can access all groups' IPC directories?**
   - **Recommendation: Yes.** Main is already exempt from sandbox and has bypassPermissions. Consistent with the main-exempt philosophy. Already implemented in the current IPC authorization logic.

4. **Non-main agents can read other groups' files?**
   - **Recommendation: Own-group-only.** The sandbox restricts filesystem access to the cwd (group dir). Combined with `cwd: GROUP_DIR` set in agent-runner, non-main agents naturally can't read other groups' dirs. The sandbox enforces this at OS level.

5. **How to surface the "explain to group" message when permissions block an action?**
   - **Recommendation: PreToolUse hook with additionalContext.** Add a hook for non-main groups that injects context telling the model to use `mcp__nanoclaw__send_message` to explain restrictions to users. The model's system prompt should also mention this. See Code Example 6 above.

## Sources

### Primary (HIGH confidence)
- SDK type definitions: `/Users/alvin/dev/nanoclaw/container/agent-runner/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` -- SandboxSettings, Options, PermissionMode types verified directly
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- `tools` vs `allowedTools` vs `disallowedTools` semantics, SandboxSettings schema
- [Claude Agent SDK Permissions Docs](https://platform.claude.com/docs/en/agent-sdk/permissions) -- Permission evaluation order, mode descriptions
- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing) -- Seatbelt implementation details, sandbox modes, security limitations

### Secondary (MEDIUM confidence)
- [Anthropic Engineering: Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing) -- Architecture overview, filesystem/network isolation design
- [sandbox-runtime GitHub](https://github.com/anthropic-experimental/sandbox-runtime) -- Seatbelt profile generation approach, npm package availability (v0.0.34)

### Tertiary (LOW confidence)
- None -- all findings verified against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- verified against installed SDK type definitions, no new packages needed
- Architecture: HIGH -- patterns directly follow SDK documentation and existing codebase conventions
- Pitfalls: HIGH -- `allowedTools` vs `tools` confusion verified against SDK types; sandbox+bypassPermissions interaction documented in official docs
- Config design: MEDIUM -- Zod schema extension follows existing patterns but exact field names are implementation decisions

**Research date:** 2026-02-09
**Valid until:** 2026-03-09 (SDK stable, 30-day window)
