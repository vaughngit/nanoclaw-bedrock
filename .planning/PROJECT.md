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
- ✓ JSONC configuration file (`nanoclaw.config.jsonc`) as prominent config surface — v1.0
- ✓ Host-native execution mode — spawn `claude` directly on macOS — v1.0
- ✓ Execution mode toggle — switch between "container" and "host" via config — v1.0
- ✓ Mode-tagged MCP server config with `modes` array and intelligent filtering — v1.0
- ✓ Startup warnings when MCP servers filtered due to mode incompatibility — v1.0
- ✓ Host mode inherits global MCP servers from `~/.claude/settings.json` — v1.0
- ✓ Config loader — JSONC parsing, Zod validation, env var expansion — v1.0
- ✓ Self-documenting config template with inline comments — v1.0
- ✓ Container mode remains the default for safety — v1.0
- ✓ macOS Seatbelt sandbox security for host mode — v1.0
- ✓ Per-group execution mode overrides — v1.0
- ✓ MCP server health checks at startup — v1.0
- ✓ System health IPC tool for main group — v1.0

### Active

(None yet — planning next milestone)

### Out of Scope

- Docker-in-host hybrid (container with host network access) — confusing middle ground
- Remote execution (running agents on a remote server/cloud) — different problem entirely
- GUI for config editing — users edit JSONC directly, IDE support is sufficient

## Context

NanoClaw is a personal Claude assistant that connects to WhatsApp/Slack and runs agents in isolated Linux containers or directly on macOS. The fork (vaughngit/nanoclaw-bedrock) adds Amazon Bedrock authentication and Slack channel support.

**v1.0 shipped (2026-02-12):** Configurable execution mode switching via `nanoclaw.config.jsonc`. The system now supports:

- **Container mode** (default): Agents run in Apple Container/Docker Linux VMs with per-group filesystem isolation
- **Host mode**: Agents spawn directly on macOS with Seatbelt sandbox security, full MCP ecosystem access, and tool restrictions
- **Mixed mode**: Per-group execution mode overrides — some groups in containers, others on host
- **MCP management**: Mode-tagged servers with intelligent filtering, global inheritance from `~/.claude/settings.json`, startup health checks

Architecture: `config-loader.ts` (JSONC/Zod validation, env expansion) → `host-runner.ts` / `container-runner.ts` (mode routing) → `agent-runner/` (shared SDK invocation). The IPC protocol (filesystem JSON) works identically in both modes. `mcp-filter.ts` handles mode-aware server filtering.

4,083 lines TypeScript across 12 files (4 new: config-loader, host-runner, mcp-filter, config template). 8 phases, 14 plans, 24 requirements shipped in 5 days.

## Constraints

- **Backward compatible**: Existing container mode must continue to work unchanged — container is the default
- **Single config file**: All execution-related config lives in `nanoclaw.config.jsonc`, secrets stay in `.env`
- **No new heavy dependencies**: JSONC parsing should be vendored or use a tiny library, not a large framework
- **TypeScript**: All new code in TypeScript, matching existing codebase conventions (ES modules, Pino logging, no ORM)
- **Apple Container + Docker**: Container mode must still support both runtimes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| JSONC config over .env for execution config | Supports comments (self-documenting), structured data (mode tags, MCP server objects), and feels prominent as a config surface | ✓ Good — v1.0 |
| Container as default mode | Safer for new users; host-native is opt-in for those who understand the trade-off | ✓ Good — v1.0 |
| MCP servers in nanoclaw.config.jsonc with mode tags | Enables intelligent filtering on mode switch and startup warnings; .mcp.json can't express mode compatibility | ✓ Good — v1.0 |
| Host mode inherits global MCP servers | Personal assistant should have access to user's full MCP ecosystem, not just project-level ones | ✓ Good — v1.0 |
| z.strictObject() for config validation | Rejects unknown keys, catches typos immediately | ✓ Good — v1.0 |
| Seatbelt sandbox mandatory for host mode | Safety-first: block startup if hostSecurity missing when host mode needed | ✓ Good — v1.0 |
| Message-time mode resolution | resolveExecutionMode() called per-message, not cached — supports dynamic group registration | ✓ Good — v1.0 |

---
*Last updated: 2026-02-12 after v1.0 milestone completion*
