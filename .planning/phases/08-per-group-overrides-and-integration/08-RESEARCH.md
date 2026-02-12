# Phase 8: Per-Group Overrides and Integration - Research

**Researched:** 2026-02-11
**Domain:** Internal architecture -- per-group execution mode routing, startup communication, mixed-mode orchestration
**Confidence:** HIGH

## Summary

Phase 8 wires together the full system: individual groups override the global execution mode, the startup banner warns about host-mode access, and the system handles mixed modes (some groups on container, some on host) gracefully. This is primarily an internal integration phase -- no new libraries are needed, and all patterns already exist in the codebase.

The current codebase routes ALL groups through a single execution mode via `config.executionMode` (a frozen singleton from `config-loader.ts`). The routing happens in two places: `runAgent()` in `index.ts` (for messages) and `runTask()` in `task-scheduler.ts` (for scheduled tasks). Both use a simple ternary: `config.executionMode === 'host' ? runHostAgent(...) : runContainerAgent(...)`. Phase 8 replaces this global check with a per-group resolution that checks the group's `executionMode` override first, falling back to the global setting.

**Primary recommendation:** Add an `executionMode` field to `RegisteredGroup` (types, DB, and registration flow), create a `resolveExecutionMode(group)` function that checks group-level then global, and replace the two ternaries. Add a startup banner scan and a health IPC command. No new files needed -- the changes touch existing modules only.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.x (already in project) | Validate `executionMode` field on RegisteredGroup | Consistent with existing schema validation pattern |
| pino | (already in project) | Startup banner logging | Existing logger -- but note: module-level logs use `console.error`/`process.stderr.write` due to pino async timing |

### Supporting
No new libraries needed. This phase is purely internal wiring.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB column for executionMode | nanoclaw.config.jsonc per-group section | Config file would need group JIDs (ugly), and can't be set at runtime via IPC. DB is where groups already live. |
| New config-resolution module | Inline helper function | A dedicated module would be overkill for a single function. Inline in `config-loader.ts` or where used. |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Changes (no new files)

```
src/
├── types.ts             # Add executionMode? field to RegisteredGroup
├── config-loader.ts     # Add resolveExecutionMode() function; add startup banner logic
├── db.ts                # Add execution_mode column to registered_groups table
├── index.ts             # Replace global ternary with per-group resolution; add health IPC handler
├── task-scheduler.ts    # Replace global ternary with per-group resolution
├── host-runner.ts       # No changes needed (receives group, doesn't check global mode)
├── container-runner.ts  # No changes needed (receives group, doesn't check global mode)
└── container/agent-runner/src/
    └── ipc-mcp.ts       # Add health_check tool (main-only)
```

### Pattern 1: Per-Group Override Resolution
**What:** A function that resolves the effective execution mode for a group.
**When to use:** Every time a group's message or task needs to be routed to a runner.
**Confidence:** HIGH -- follows the existing ternary pattern, just adds a layer.

```typescript
// In config-loader.ts or a new section of index.ts
// Source: Codebase analysis of existing routing

import { config } from './config-loader.js';
import { RegisteredGroup } from './types.js';

type ExecutionMode = 'container' | 'host';

/**
 * Resolve execution mode for a group.
 * Per-group override takes precedence over global config.
 * Called at message-processing time (not cached at startup).
 */
export function resolveExecutionMode(group: RegisteredGroup): ExecutionMode {
  return group.executionMode ?? config.executionMode;
}
```

Key design notes:
- The function is trivially simple, but having it as a named function provides a single grep-able call site and communicates intent.
- Must NOT be cached -- the user decision says "resolved at message-processing time, not cached at startup."
- The global `config` is already frozen at startup, but `RegisteredGroup` data is loaded from SQLite and can be updated at runtime via IPC (register_group handler).

### Pattern 2: Safety-First Startup Validation
**What:** Block startup if any group specifies `executionMode: "host"` but `hostSecurity` is missing from global config.
**When to use:** At startup, after loading registered groups from DB.
**Confidence:** HIGH -- mirrors existing validation in `config-loader.ts`.

```typescript
// In main() in index.ts, after loadState() populates registeredGroups

function validateGroupModes(): void {
  const hostGroups: string[] = [];

  for (const [jid, group] of Object.entries(registeredGroups)) {
    const mode = resolveExecutionMode(group);
    if (mode === 'host') {
      hostGroups.push(group.name);
    }
  }

  // If any group uses host mode, hostSecurity must be configured
  if (hostGroups.length > 0 && !config.hostSecurity) {
    // Use existing printConfigError pattern for boxed ASCII banner
    printConfigError('Host mode requires security config', [
      `Groups using host mode: ${hostGroups.join(', ')}`,
      'Add "hostSecurity" to nanoclaw.config.jsonc',
      'See comments in config file for options',
    ]);
    process.exit(1);
  }
}
```

Important consideration: The user decision says "block startup with a clear error" when host mode is requested but security config is missing. However, this check needs to also run when the **global** mode is host and hostSecurity is missing -- but that is a pre-existing concern (Phase 5 did not add this validation). Phase 8 should add the check for both per-group AND global.

Current state: The global config does NOT currently validate that `hostSecurity` is present when `executionMode: "host"`. The `hostSecurity` field is optional in `NanoClawConfigSchema`. This was acceptable when only the main group existed (main is exempt from security). Phase 8 must add startup validation that catches this gap.

### Pattern 3: Startup Banner (Host Mode Warning)
**What:** A prominent banner printed at startup when ANY group will run in host mode.
**When to use:** Only when at least one group resolves to host mode. Not shown when all groups use container mode.
**Confidence:** HIGH -- the boxed ASCII pattern already exists (see `printConfigError` and `ensureContainerSystemRunning`).

```typescript
// Printed at startup after group modes are validated

function printHostModeBanner(hostGroups: string[]): void {
  const innerWidth = 64;
  const border = '═'.repeat(innerWidth);

  console.error(`\n╔${border}╗`);
  console.error(`║  ${'HOST MODE ACTIVE'}`.padEnd(innerWidth + 1) + '║');
  console.error(`║  ${'Agent has full macOS access'}`.padEnd(innerWidth + 1) + '║');
  console.error(`╠${border}╣`);
  console.error(`║${' '.repeat(innerWidth)}║`);
  for (const name of hostGroups) {
    console.error(`║  ${'• ' + name}`.padEnd(innerWidth + 1) + '║');
  }
  console.error(`║${' '.repeat(innerWidth)}║`);
  // Show security status
  if (config.hostSecurity) {
    const sandbox = config.hostSecurity.sandbox ? 'enabled' : 'DISABLED';
    const tools = config.hostSecurity.tools
      ? `${config.hostSecurity.tools.length} allowed`
      : 'all';
    console.error(`║  ${'Sandbox: ' + sandbox + ' | Tools: ' + tools}`.padEnd(innerWidth + 1) + '║');
  }
  console.error(`╚${border}╝\n`);
}
```

Recommendation for "Claude's Discretion" on banner location: **logs only** (via `console.error`). Sending a banner via WhatsApp on every startup would be noisy and potentially confusing to group participants. The log banner is visible in terminal and in `launchd` logs. No WhatsApp banner.

Recommendation for banner prominence: **Boxed ASCII** (matching existing codebase style). This is consistent with `ensureContainerSystemRunning()` and `printConfigError()`.

Recommendation for banner content: Show group names, sandbox status, and tool restriction status. This gives the operator enough information at a glance without being overwhelming.

### Pattern 4: Mixed-Mode Container Check
**What:** If some groups use container mode and the container system is down, start anyway with host-mode groups active.
**When to use:** At startup in `main()`.
**Confidence:** HIGH -- existing `ensureContainerSystemRunning()` already handles the all-or-nothing case.

```typescript
// Modified main() logic

async function main(): Promise<void> {
  initDatabase();
  loadState();

  // Determine which modes are needed
  const modes = new Set<string>();
  for (const group of Object.values(registeredGroups)) {
    modes.add(resolveExecutionMode(group));
  }
  // Also consider the global default (for future groups without overrides)
  modes.add(config.executionMode);

  const needsContainer = modes.has('container');
  const needsHost = modes.has('host');

  let containerAvailable = false;
  if (needsContainer) {
    try {
      ensureContainerSystemRunning();
      containerAvailable = true;
    } catch {
      if (!needsHost) {
        // All groups need container mode and it's not available -- fatal
        throw new Error('Container system required but unavailable');
      }
      // Some groups use host -- continue, but container groups will get errors
      logger.warn('Container system unavailable -- container-mode groups will return errors');
    }
  }

  // ... rest of startup
}
```

When a container-mode group receives a message but the container system is down, the error response from `runContainerAgent` will naturally propagate as an error. The user decision says to give "an error response explaining the container is unavailable" -- this should be handled in `runAgent()` by catching the container error and sending a user-facing message via `sendMessage()`.

### Pattern 5: WhatsApp Mode Hint
**What:** A subtle indicator in WhatsApp responses showing the agent is running in host mode.
**When to use:** Only for host-mode groups. Container mode is the safe default and needs no hint.
**Confidence:** HIGH -- simple string prefix/suffix.

Recommendation for "Claude's Discretion" on format: A small text tag appended to the assistant name prefix, e.g. `Nano [host]: <response>`. This is:
- Visible but not intrusive
- Easy to grep in logs
- Clear about what it means
- No emoji (per project conventions -- user instructions say "avoid using emojis")

Implementation: In `processGroupMessages()` and the scheduler's message sending, when the group's resolved mode is 'host', modify the prefix. Current: `${ASSISTANT_NAME}: ${response}`. With hint: `${ASSISTANT_NAME} [host]: ${response}`.

### Pattern 6: Health Check Command
**What:** A health command that reports execution mode, MCP servers, and security config.
**When to use:** Main group only, triggered via IPC tool.
**Confidence:** HIGH -- follows existing IPC MCP tool pattern.

Recommendation for trigger mechanism: **IPC MCP tool** (`mcp__nanoclaw__system_health`). This is the most natural mechanism because:
- The agent already has MCP tools for IPC operations
- Main-group-only restriction is already proven (see `register_group`, `schedule_task` target_group)
- Natural language triggering -- the user just asks "what's the system health?" and Claude calls the tool
- No need to parse slash commands or special prefixes

```typescript
// In ipc-mcp.ts, add a new tool (main-only)

tool(
  'system_health',
  'Get system health status including execution modes, MCP servers, and security config. Main group only.',
  {},
  async () => {
    if (!isMain) {
      return {
        content: [{ type: 'text', text: 'System health is only available from the main group.' }],
        isError: true,
      };
    }

    // Read health data from a snapshot file written by the host process
    // (agent-runner can't directly access the host's state)
    const healthFile = path.join(ipcDir, 'system_health.json');
    if (!fs.existsSync(healthFile)) {
      return {
        content: [{ type: 'text', text: 'Health data not available. The host process may need to be restarted.' }],
      };
    }

    const health = JSON.parse(fs.readFileSync(healthFile, 'utf-8'));
    // Format and return
    return { content: [{ type: 'text', text: formatHealth(health) }] };
  }
)
```

The health data must be written by the host process (index.ts) because the agent-runner subprocess cannot access:
- The list of registered groups and their execution modes
- The container system status
- The global config singleton

Pattern: The host process writes `system_health.json` to the main group's IPC directory on startup and periodically (or on-demand via IPC request). The MCP tool reads it.

### Anti-Patterns to Avoid
- **Caching resolved mode at startup:** The user decision explicitly requires resolution at message-processing time. Do NOT pre-compute a `groupModes` map and freeze it.
- **Passing execution mode through the queue:** The `GroupQueue` is mode-agnostic and should stay that way. Mode resolution happens in `processGroupMessages()` and `runTask()`, not in queue logic.
- **Separate config section for per-group overrides:** The user already has group registration in SQLite. Adding a separate section in `nanoclaw.config.jsonc` would create two sources of truth for group config.
- **Modifying agent-runner to detect its own mode dynamically:** The agent-runner already receives `NANOCLAW_MODE` as an env var. The mode is determined by the host process, not by the runner itself.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ASCII box banner | Custom box-drawing function | Existing `printConfigError` pattern (64-char inner width, ═ borders) | Already used in 2 places, must stay visually consistent |
| Group mode validation | Custom validation loop | Extend `loadAndValidateConfig` pattern + post-load validation in `main()` | Config validation has an established pattern with boxed errors |
| Main-only tool restriction | Custom auth middleware | Existing `isMain` check pattern in IPC MCP tools | `register_group` tool already implements this pattern |
| IPC data exchange for health | Custom socket/HTTP server | Existing JSON file snapshot pattern (`current_tasks.json`, `available_groups.json`) | Proven, atomic-write, already polled |

**Key insight:** Every pattern needed for Phase 8 already exists somewhere in the codebase. The work is purely wiring -- connecting existing patterns to new use cases.

## Common Pitfalls

### Pitfall 1: Container System Check Ordering
**What goes wrong:** Checking container system availability before knowing which groups need container mode.
**Why it happens:** The current `main()` calls `ensureContainerSystemRunning()` first, then `initDatabase()` and `loadState()`. But Phase 8 needs group data to know if container mode is needed.
**How to avoid:** Reorder startup: `initDatabase()` -> `loadState()` -> determine needed modes -> conditionally check container system.
**Warning signs:** Startup fails with "Apple Container system required" even though all groups are in host mode.

### Pitfall 2: DB Migration for executionMode Column
**What goes wrong:** Adding the `execution_mode` column to `registered_groups` without handling existing rows.
**Why it happens:** SQLite `ALTER TABLE ADD COLUMN` requires a default value for existing rows.
**How to avoid:** Use `DEFAULT NULL` -- null means "inherit global setting," which is the desired behavior for existing groups (GRP-02).
**Warning signs:** Existing groups suddenly get a hardcoded mode instead of inheriting.

### Pitfall 3: Security Context for Mixed-Mode Host Groups
**What goes wrong:** A group with `executionMode: "host"` doesn't get the security context because the host-runner security context was only built when the GLOBAL mode was host.
**Why it happens:** Currently `securityCtx` is built in `runAgent()` and `runTask()` with `config.hostSecurity`. This still works for per-group host mode because `config.hostSecurity` is global. But the container system check must NOT skip the security context build when the global mode is container.
**How to avoid:** Always build the security context if `config.hostSecurity` exists, regardless of global mode. The security context is only used when `runHostAgent()` is called.
**Warning signs:** Non-main host-mode groups run unsandboxed when global mode is "container."

### Pitfall 4: Container Unavailability Error Response
**What goes wrong:** When the container system is down, container-mode groups get a cryptic `Container exited with code 1` error instead of a helpful message.
**Why it happens:** `runContainerAgent()` spawns `container run` which fails if the system is down, but the error message doesn't explain WHY.
**How to avoid:** In `runAgent()`, check if the resolved mode is 'container' and the container system is known to be down. Return a user-facing error message BEFORE spawning.
**Warning signs:** Users in container-mode groups see technical error messages about container exits.

### Pitfall 5: register_group IPC Missing executionMode
**What goes wrong:** Groups registered via the `register_group` IPC tool don't get an `executionMode` field.
**Why it happens:** The `register_group` IPC handler and MCP tool don't include `executionMode` in their schemas.
**How to avoid:** Add optional `executionMode` field to the `register_group` IPC data and MCP tool schema. When omitted, it defaults to null (inherit global).
**Warning signs:** Groups registered at runtime always inherit global mode with no way to override.

### Pitfall 6: Task Scheduler Uses Global Mode
**What goes wrong:** Scheduled tasks for a host-mode group run in container mode because the scheduler uses `config.executionMode`.
**Why it happens:** `runTask()` in `task-scheduler.ts` has the same global ternary as `runAgent()`. Both must be updated.
**How to avoid:** Use `resolveExecutionMode(group)` in both `runAgent()` AND `runTask()`.
**Warning signs:** Scheduled tasks produce "Container exited with error" for groups that should be in host mode.

## Code Examples

Verified patterns from existing codebase:

### RegisteredGroup Type Extension
```typescript
// In src/types.ts
// Source: Existing RegisteredGroup interface + Phase 8 requirements

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean;
  channelType?: 'whatsapp' | 'slack';
  executionMode?: 'container' | 'host';  // NEW: per-group override, null = inherit global
}
```

### DB Migration Pattern
```typescript
// In src/db.ts initDatabase()
// Source: Existing migration pattern (requires_trigger, channel_type columns)

// Add execution_mode column if it doesn't exist (migration for existing DBs)
try {
  db.exec(
    `ALTER TABLE registered_groups ADD COLUMN execution_mode TEXT DEFAULT NULL`,
  );
} catch {
  /* column already exists */
}
```

### setRegisteredGroup Update
```typescript
// In src/db.ts
// Source: Existing setRegisteredGroup pattern

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups
     (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, channel_type, execution_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.channelType || 'whatsapp',
    group.executionMode || null,  // null = inherit global
  );
}
```

### Modified runAgent() Routing
```typescript
// In src/index.ts runAgent()
// Source: Existing ternary routing pattern + resolveExecutionMode

const effectiveMode = resolveExecutionMode(group);

const output = effectiveMode === 'host'
  ? await runHostAgent(
      group,
      agentInput,
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName),
      {
        hostSecurity: config.hostSecurity,
        mainGroupJid: Object.entries(registeredGroups).find(
          ([, g]) => g.folder === MAIN_GROUP_FOLDER,
        )?.[0],
        mainGroupFolder: MAIN_GROUP_FOLDER,
      },
    )
  : await runContainerAgent(
      group,
      agentInput,
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName),
    );
```

### Health Snapshot Write
```typescript
// In src/index.ts, called at startup and periodically
// Source: Existing writeTasksSnapshot / writeGroupsSnapshot patterns

function writeHealthSnapshot(): void {
  const mainIpcDir = path.join(DATA_DIR, 'ipc', MAIN_GROUP_FOLDER);
  fs.mkdirSync(mainIpcDir, { recursive: true });

  const groupModes: Record<string, { name: string; mode: string }> = {};
  for (const [jid, group] of Object.entries(registeredGroups)) {
    groupModes[jid] = {
      name: group.name,
      mode: resolveExecutionMode(group),
    };
  }

  const health = {
    globalMode: config.executionMode,
    hostSecurity: config.hostSecurity ? {
      sandbox: config.hostSecurity.sandbox,
      tools: config.hostSecurity.tools ? config.hostSecurity.tools.length : 'all',
    } : null,
    mcpServers: Object.keys(config.mcpServers).length,
    groups: groupModes,
    containerAvailable: containerSystemAvailable,
    timestamp: new Date().toISOString(),
  };

  const healthFile = path.join(mainIpcDir, 'system_health.json');
  fs.writeFileSync(healthFile, JSON.stringify(health, null, 2));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Global execution mode only | Per-group overrides | Phase 8 (this phase) | Groups can mix container and host mode |
| Container system always required | Conditional container check | Phase 8 | Host-only setups skip container system entirely |
| No startup mode banner | Boxed ASCII banner for host mode | Phase 8 | Operators see host-mode groups at a glance |

**No deprecated/outdated patterns.** All existing patterns remain valid and are extended.

## Discretion Recommendations

Summary of recommendations for areas marked "Claude's Discretion" in CONTEXT.md:

### Where per-group overrides are stored
**Recommendation:** `RegisteredGroup` in SQLite (the `registered_groups` table), NOT `nanoclaw.config.jsonc`.

Rationale:
- Groups are already registered in SQLite via IPC. Adding `executionMode` to the existing `RegisteredGroup` interface follows the established pattern.
- Config file would require group JIDs (ugly, verbose, requires manual editing).
- SQLite allows runtime changes via IPC without config file editing or process restart.
- The config file already references this: "Per-group overrides use the existing group registration system" (line 149 of nanoclaw.config.jsonc).

### Whether overrides support more than executionMode
**Recommendation:** Start with `executionMode` only. Do NOT add per-group MCP servers or per-group security overrides in Phase 8.

Rationale:
- The phase scope says "Individual WhatsApp groups can override the global execution mode" -- that is the boundary.
- Per-group MCP servers would require significant plumbing (each group's ContainerInput would need custom mcpServers, agent-runner would need to merge, etc.).
- Per-group security overrides (e.g., per-group sandbox=false) could be a Phase 8+ follow-up if needed.
- Keep the type extensible (`executionMode?: 'container' | 'host'`) so future fields can be added without schema breaks.

### Banner location, prominence, and content detail
**Recommendation:**
- **Location:** Logs only (`console.error` / `process.stderr.write`). No WhatsApp message.
- **Prominence:** Boxed ASCII (matching `ensureContainerSystemRunning` and `printConfigError` patterns).
- **Content:** Group names using host mode, sandbox status (enabled/disabled), tool restriction count.

Rationale:
- WhatsApp banners on every restart would be noisy and confusing for group participants.
- The boxed ASCII pattern is established (two existing uses) and highly visible in terminal output.
- Group names + security status gives operators essential information at a glance.

### WhatsApp mode hint format
**Recommendation:** Text tag `[host]` appended to assistant name: `Nano [host]: <response>`.

Rationale:
- No emoji (consistent with codebase conventions).
- Short and recognizable.
- Only added for host-mode groups; container-mode groups show normal `Nano: <response>`.
- Easy to grep in message history.

### Cross-mode IPC isolation policy
**Recommendation:** No cross-mode IPC restrictions. Host and container groups can IPC to each other via the existing mechanisms.

Rationale:
- IPC already has authorization checks (non-main groups can only message their own JID, main can message any JID).
- The IPC mechanism is filesystem-based and mode-agnostic (both modes write to the same `data/ipc/` directory).
- Adding mode-based IPC restrictions would break existing functionality (e.g., main group scheduling tasks for container-mode groups).
- Security is already handled at the IPC level (directory-based identity, main-only operations).

### Health command trigger mechanism
**Recommendation:** IPC MCP tool `system_health` (main-only), triggered via natural language.

Rationale:
- Follows existing MCP tool pattern (e.g., `register_group`, `list_tasks`).
- Main-only restriction proven by `isMain` check pattern.
- Natural language triggering -- user asks "system health?" and Claude calls the tool.
- No need for special command parsing or slash-command infrastructure.

## Open Questions

1. **Container system status tracking at runtime**
   - What we know: `ensureContainerSystemRunning()` checks at startup. If the container system goes down mid-session, container-mode groups will fail on the next spawn.
   - What's unclear: Should we periodically re-check container system status, or rely on per-spawn failure?
   - Recommendation: Rely on per-spawn failure. The container system rarely goes down mid-session, and adding a health-check loop adds complexity without proportional benefit. The health snapshot can note "last checked at startup."

2. **Hot-reloading executionMode via IPC register_group**
   - What we know: The `register_group` IPC handler calls `registerGroup()` which updates `registeredGroups` in memory AND SQLite. Mode resolution at message time means the next message will use the updated mode.
   - What's unclear: Should there be a dedicated IPC command for changing JUST the execution mode without re-registering?
   - Recommendation: No dedicated command. The `register_group` IPC handler should accept `executionMode` as an optional field. If only the mode needs changing, the operator re-registers with the same fields plus the new mode. This keeps the IPC surface small.

3. **Startup order change impact**
   - What we know: Moving `initDatabase()` and `loadState()` before `ensureContainerSystemRunning()` changes startup order.
   - What's unclear: Any side effects from database init before container check? (The database doesn't depend on the container system.)
   - Recommendation: Safe to reorder. Database init is purely local (SQLite file), has no dependency on container system. Verified by reading `initDatabase()` -- it only touches `store/messages.db`.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/index.ts` (lines 279-358) -- `runAgent()` routing ternary
- Codebase analysis: `src/task-scheduler.ts` (lines 94-123) -- `runTask()` routing ternary
- Codebase analysis: `src/config-loader.ts` -- NanoClawConfigSchema, printConfigError, loadAndValidateConfig
- Codebase analysis: `src/types.ts` -- RegisteredGroup interface
- Codebase analysis: `src/db.ts` (lines 109-122) -- registered_groups table schema, migration pattern
- Codebase analysis: `container/agent-runner/src/ipc-mcp.ts` -- IPC MCP tool pattern, isMain restriction
- Codebase analysis: `nanoclaw.config.jsonc` (lines 146-153) -- existing comment about per-group overrides

### Secondary (MEDIUM confidence)
- Phase decisions from CONTEXT.md -- user decisions for locked choices

### Tertiary (LOW confidence)
None -- all findings are from direct codebase analysis.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing
- Architecture: HIGH -- all patterns verified in existing codebase
- Pitfalls: HIGH -- identified from actual code flow analysis, not hypothetical
- Discretion recommendations: HIGH -- based on codebase conventions and existing patterns

**Research date:** 2026-02-11
**Valid until:** 2026-03-11 (stable -- internal codebase patterns, no external dependency changes)
