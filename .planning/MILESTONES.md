# Project Milestones: NanoClaw Host-Native Runner

## v1.0 Host-Native Runner (Shipped: 2026-02-12)

**Delivered:** Configurable execution mode switching enabling NanoClaw agents to run directly on macOS (host mode) or in containers, controlled via a JSONC config file with per-group overrides, mandatory security sandboxing, and mode-aware MCP server management.

**Phases completed:** 1-8 (14 plans total)

**Key accomplishments:**

- JSONC config system with Zod validation, env var expansion, and self-documenting template
- Host-native runner spawning agents directly on macOS as Node.js subprocesses
- macOS Seatbelt sandbox security with IPC authorization and tool restrictions
- Mode-tagged MCP servers with intelligent filtering and global inheritance from ~/.claude/settings.json
- Per-group execution mode overrides with message-time resolution and SQLite persistence
- System health IPC tool and boxed ASCII startup banner for operator visibility

**Stats:**

- 12 files created/modified (4 new: config-loader, host-runner, mcp-filter, config template)
- 4,083 lines TypeScript across milestone-touched files
- 8 phases, 14 plans, 24 requirements
- 5 days from start to ship (Feb 7-12, 2026)
- 92 minutes total execution time across all plans

**Git range:** `feat(01-01)` → `docs(08)`

**What's next:** Planning next milestone

---
