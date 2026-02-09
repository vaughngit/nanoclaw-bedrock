# Roadmap: NanoClaw Host-Native Runner

## Overview

This roadmap delivers configurable execution mode switching for NanoClaw via a JSONC config file, enabling agents to run directly on macOS (host mode) alongside the existing container isolation (default). The journey starts with the config foundation that everything depends on, refactors the agent-runner for path flexibility, builds the host runner with mandatory sandbox security, adds mode-aware MCP server management, and finishes with per-group overrides and integration polish. Eight phases, each delivering a verifiable capability, with security treated as a core implementation requirement rather than post-MVP hardening.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Config Loader** - Parse JSONC config, validate with Zod, merge defaults, export typed config
- [x] **Phase 2: Config Template and Env Expansion** - Ship self-documenting config file with environment variable support
- [x] **Phase 3: Agent-Runner Path Flexibility** - Make agent-runner path-configurable via env vars for dual-mode reuse
- [x] **Phase 4: Runner Abstraction and Host Runner** - Spawn agents directly on macOS as subprocesses using shared runner interface
- [ ] **Phase 5: Host Mode Security** - Enforce macOS Seatbelt sandbox, IPC authorization, and permission boundaries in host mode
- [ ] **Phase 6: MCP Server Configuration and Filtering** - Mode-tagged MCP servers with intelligent filtering at agent startup
- [ ] **Phase 7: MCP Inheritance and Health Checks** - Host mode inherits global MCP servers, startup health reporting for all servers
- [ ] **Phase 8: Per-Group Overrides and Integration** - Per-group execution mode, startup banners, end-to-end verification

## Phase Details

### Phase 1: Config Loader
**Goal**: App loads and validates a typed configuration from `nanoclaw.config.jsonc` at startup, with clear error messages on invalid config and zero behavioral change when the file is absent
**Depends on**: Nothing (first phase)
**Requirements**: CFG-01, CFG-02, CFG-03, EXEC-01
**Success Criteria** (what must be TRUE):
  1. App reads `nanoclaw.config.jsonc` from project root and parses JSON with comments correctly (inline, block, trailing commas)
  2. Invalid config produces an actionable error message naming the exact field, expected value, and what was found
  3. App starts and runs in container mode with identical behavior when config file is absent
  4. Config exposes an `executionMode` field accepting `"container"` or `"host"`, defaulting to `"container"` when unspecified
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Core config loader: strip-json-comments dep, JSONC parsing, Zod validation, boxed error banners, singleton export
- [x] 01-02-PLAN.md -- Startup integration: wire config-loader into index.ts, verify backward compatibility

### Phase 2: Config Template and Env Expansion
**Goal**: Users have a rich, self-documenting config file they can copy and customize, with environment variable interpolation for secrets and paths
**Depends on**: Phase 1
**Requirements**: CFG-04, CFG-05
**Success Criteria** (what must be TRUE):
  1. A `nanoclaw.config.jsonc` template ships with inline comments explaining every field, every mode option, and every trade-off
  2. Config values containing `${VAR}` are expanded from environment variables before validation
  3. Config values containing `${VAR:-default}` use the default when the env var is unset
  4. MCP server args and paths with env var references resolve correctly at startup
**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md -- Config template and env expansion: create nanoclaw.config.jsonc template, add ${VAR} and ${VAR:-default} expansion to config-loader pipeline

### Phase 3: Agent-Runner Path Flexibility
**Goal**: The existing agent-runner code accepts paths via environment variables, enabling the same codebase to run inside containers (with `/workspace/*` defaults) or on the host (with absolute macOS paths)
**Depends on**: Phase 1 (config tells us the mode, but this phase is a backward-compatible refactor)
**Requirements**: EXEC-04, EXEC-05
**Success Criteria** (what must be TRUE):
  1. Agent-runner reads `NANOCLAW_IPC_DIR`, `NANOCLAW_GROUP_DIR`, `NANOCLAW_GLOBAL_DIR`, and `CLAUDE_HOME` from environment, falling back to `/workspace/*` defaults
  2. Container mode continues to work identically after the refactor (existing tests pass, same container image behavior)
  3. IPC MCP tool uses the configurable IPC directory instead of hardcoded `/workspace/ipc`
  4. Container image rebuilds successfully with the refactored agent-runner
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md -- Path-configurable agent-runner: resolvePathVar() helper, env-var-backed path constants, IPC injection, mode-driven settingSources, config docs, container rebuild

### Phase 4: Runner Abstraction and Host Runner
**Goal**: Users running in host mode get agents spawned directly on macOS as Node.js subprocesses, using the same IPC protocol and queue integration as container mode
**Depends on**: Phase 3 (agent-runner accepts path env vars)
**Requirements**: EXEC-03
**Success Criteria** (what must be TRUE):
  1. When `executionMode` is `"host"`, the app spawns `node container/agent-runner/dist/index.js` directly instead of launching a container
  2. Host runner uses the same stdin/stdout/sentinel protocol as container-runner for output parsing
  3. Host runner registers spawned processes with GroupQueue for shutdown coordination (same `onProcess` callback pattern)
  4. A message sent to a registered group in host mode produces a response from the agent (end-to-end verification)
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md -- Host runner module: build:agent script, GroupQueue type fix, src/host-runner.ts with runHostAgent()
- [x] 04-02-PLAN.md -- Wire mode routing: index.ts and task-scheduler.ts route to correct runner, conditional container check, end-to-end verification

### Phase 5: Host Mode Security
**Goal**: Host mode agents run within macOS Seatbelt sandbox boundaries, with IPC authorization preventing cross-group access and permission controls matching the safety properties that containers provided
**Depends on**: Phase 4 (host runner exists to secure)
**Requirements**: SEC-01, SEC-02, SEC-03, EXEC-06, EXEC-07
**Success Criteria** (what must be TRUE):
  1. Host mode agents cannot read files outside their authorized directories (group folder, IPC dir, session dir) -- sandbox blocks access to `~/.ssh`, `~/.aws`, `.env`
  2. Host mode agents can only write IPC files to their own group's IPC directory, not other groups'
  3. Non-main groups in host mode do not receive `bypassPermissions` -- they use default permission mode or sandbox mode
  4. Tool allow-list is configurable in config, controlling which tools the agent can use in host mode
  5. Sandbox settings are prominently documented in the config template with clear instructions on how to enable, disable, or customize
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: MCP Server Configuration and Filtering
**Goal**: MCP servers defined in the config carry mode tags, and the runner only loads servers compatible with the current execution mode
**Depends on**: Phase 4 (runner is mode-aware)
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-05
**Success Criteria** (what must be TRUE):
  1. MCP servers in `nanoclaw.config.jsonc` accept a `modes` array per server (`["host"]`, `["container"]`, or `["host", "container"]`)
  2. Servers without a `modes` field default to being available in both modes
  3. Agent startup only loads MCP servers whose `modes` include the current execution mode
  4. Startup logs list which MCP servers are active and which were filtered out due to mode incompatibility
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

### Phase 7: MCP Inheritance and Health Checks
**Goal**: Host mode agents inherit the user's full MCP ecosystem from global settings, and startup reports the health of all configured servers
**Depends on**: Phase 6 (MCP config and filtering in place)
**Requirements**: MCP-04, MCP-06
**Success Criteria** (what must be TRUE):
  1. Host mode agents use `settingSources: ['project', 'user']` and successfully load MCP servers from `~/.claude/settings.json`
  2. Startup attempts to connect to each configured MCP server and reports status (connected, failed, timeout) in logs
  3. MCP health checks do not block startup -- the app continues even if some servers are unreachable
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Per-Group Overrides and Integration
**Goal**: Individual groups can override the global execution mode, and the full system works end-to-end with clear startup communication about the running configuration
**Depends on**: Phase 5 (security in place), Phase 7 (MCP fully configured)
**Requirements**: GRP-01, GRP-02, GRP-03, EXEC-02
**Success Criteria** (what must be TRUE):
  1. A group in `registered_groups.json` with `"executionMode": "host"` runs in host mode even when the global config is `"container"` (and vice versa)
  2. Groups without an `executionMode` field inherit the global setting
  3. Per-group mode is resolved at message-processing time, not cached at startup
  4. Startup prints a clear, unmistakable banner when any group will run in host mode, stating the agent has full macOS access
  5. A message to a container-mode group and a host-mode group in the same session both produce correct responses using their respective runners
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Config Loader | 2/2 | ✓ Complete | 2026-02-07 |
| 2. Config Template and Env Expansion | 1/1 | ✓ Complete | 2026-02-07 |
| 3. Agent-Runner Path Flexibility | 1/1 | ✓ Complete | 2026-02-07 |
| 4. Runner Abstraction and Host Runner | 2/2 | ✓ Complete | 2026-02-09 |
| 5. Host Mode Security | 0/3 | Not started | - |
| 6. MCP Server Configuration and Filtering | 0/2 | Not started | - |
| 7. MCP Inheritance and Health Checks | 0/2 | Not started | - |
| 8. Per-Group Overrides and Integration | 0/2 | Not started | - |
