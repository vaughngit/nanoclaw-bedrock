# NanoClaw Host-Native Runner

## What This Is

A configurable execution mode for NanoClaw that lets users choose between running agents in isolated Linux containers (the current default) or directly on the host macOS system. A prominent JSONC configuration file (`nanoclaw.config.jsonc`) controls the execution mode, MCP server availability, and mode-aware behavior. This is a fork (vaughngit/nanoclaw-bedrock) that already adds Bedrock auth and Slack support.

## Core Value

Users can toggle between container isolation and host-native execution via a single config file, getting full macOS access (dev tools, MCP servers, kubectl, native apps) in host mode while preserving the safety of container mode as the default.

## Requirements

### Validated

- ✓ WhatsApp I/O via Baileys — existing
- ✓ Slack I/O via Bolt Socket Mode — existing
- ✓ Container-based agent execution via Apple Container/Docker — existing
- ✓ Per-group filesystem isolation with security-validated mounts — existing
- ✓ IPC communication (messages, images, tasks) via filesystem JSON protocol — existing
- ✓ Scheduled task execution with cron/interval/once — existing
- ✓ Per-group queue with concurrency limits and retry — existing
- ✓ Amazon Bedrock auth passthrough — existing
- ✓ Dynamic assistant name via ASSISTANT_NAME env var — existing
- ✓ Image sending via send_image MCP tool — existing

### Active

- [ ] JSONC configuration file (`nanoclaw.config.jsonc`) as prominent config surface
- [ ] Host-native execution mode — spawn `claude` directly on macOS instead of in a container
- [ ] Execution mode toggle — switch between "container" and "host" via config
- [ ] Mode-tagged MCP server config — MCP servers in JSONC config with `modes` array indicating compatibility
- [ ] MCP server filtering on mode switch — runner skips MCP servers incompatible with current mode
- [ ] Startup warnings on mode switch — warn when MCP servers become unavailable due to mode change
- [ ] Host mode inherits global MCP servers from `~/.claude/settings.json`
- [ ] Config loader — parse JSONC (strip comments), merge defaults, validate
- [ ] `.env.example` and config example ship with sensible defaults and inline documentation
- [ ] Container mode remains the default for safety

### Out of Scope

- Per-group execution mode (some groups in container, some on host) — adds significant complexity, defer to future
- Docker-in-host hybrid (container with host network access) — confusing middle ground
- Remote execution (running agents on a remote server/cloud) — different problem entirely
- GUI for config editing — users edit JSONC directly, IDE support is sufficient

## Context

NanoClaw is a personal Claude assistant that connects to WhatsApp/Slack and runs agents in isolated Linux containers. The fork (vaughngit/nanoclaw-bedrock) already adds Amazon Bedrock authentication and Slack channel support.

The current architecture has a clear boundary: `container-runner.ts` spawns agent containers. The host-native runner replaces this with direct process spawning while keeping everything else (IPC, message routing, scheduling) the same.

Key architectural insight: the agent-runner code inside `container/agent-runner/src/` handles Claude Agent SDK invocation. In host mode, this same logic runs as a direct Node.js subprocess instead of inside a container. The IPC protocol (filesystem JSON files) works identically in both modes.

The JSONC config file is central to this project — it's not just a toggle, it's the primary configuration surface that users interact with. It should be well-documented with inline comments explaining every option.

MCP servers configured in the JSONC config have mode tags (`"modes": ["host"]` or `"modes": ["host", "container"]`) so the runner can intelligently filter them when switching modes. In host mode, the agent also inherits global MCP servers from `~/.claude/settings.json` via `settingSources: ['project', 'user']`.

## Constraints

- **Backward compatible**: Existing container mode must continue to work unchanged — container is the default
- **Single config file**: All execution-related config lives in `nanoclaw.config.jsonc`, secrets stay in `.env`
- **No new heavy dependencies**: JSONC parsing should be vendored or use a tiny library, not a large framework
- **TypeScript**: All new code in TypeScript, matching existing codebase conventions (ES modules, Pino logging, no ORM)
- **Apple Container + Docker**: Container mode must still support both runtimes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| JSONC config over .env for execution config | Supports comments (self-documenting), structured data (mode tags, MCP server objects), and feels prominent as a config surface | -- Pending |
| Container as default mode | Safer for new users; host-native is opt-in for those who understand the trade-off | -- Pending |
| MCP servers in nanoclaw.config.jsonc with mode tags | Enables intelligent filtering on mode switch and startup warnings; .mcp.json can't express mode compatibility | -- Pending |
| Host mode inherits global MCP servers | Personal assistant should have access to user's full MCP ecosystem, not just project-level ones | -- Pending |

---
*Last updated: 2026-02-07 after initialization*
