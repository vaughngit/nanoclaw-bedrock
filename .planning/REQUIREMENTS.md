# Requirements: NanoClaw Host-Native Runner

**Defined:** 2026-02-07
**Core Value:** Users can toggle between container isolation and host-native execution via a single config file

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Configuration System

- [x] **CFG-01**: App reads `nanoclaw.config.jsonc` from project root, parsing JSONC (JSON with Comments)
- [x] **CFG-02**: Config validation runs at startup with actionable error messages pointing to exact problems (field name, expected value, what was found)
- [x] **CFG-03**: App runs in container mode with current behavior when config file is absent (zero behavioral change for existing users)
- [x] **CFG-04**: Config file ships as a self-documenting template with extensive inline comments explaining every field, every mode, and every trade-off
- [x] **CFG-05**: Config values support `${VAR}` and `${VAR:-default}` environment variable expansion, especially for MCP server args and paths

### Execution Mode

- [x] **EXEC-01**: Config has an `executionMode` field accepting `"container"` or `"host"`, defaulting to `"container"`
- [ ] **EXEC-02**: Startup prints a clear, unmistakable banner/warning when running in host mode, stating the agent has full macOS access
- [x] **EXEC-03**: Host runner spawns `claude` (agent-runner) directly on macOS as a subprocess instead of inside a container
- [x] **EXEC-04**: Host runner reuses the existing agent-runner code with path-configurable env vars (not a separate implementation)
- [x] **EXEC-05**: Container runner continues working unchanged when `executionMode` is `"container"`
- [x] **EXEC-06**: Config exposes macOS Seatbelt sandbox settings for host mode via the Agent SDK's `sandbox` option, with clear documentation on how to enable/disable/customize
- [x] **EXEC-07**: Sandbox settings are prominently documented in the config template so users can easily unlock or tighten restrictions

### MCP Servers

- [x] **MCP-01**: MCP servers configured in `nanoclaw.config.jsonc` with a `modes` array per server (`["host"]`, `["container"]`, or `["host", "container"]`)
- [x] **MCP-02**: Servers without a `modes` field default to `["host", "container"]` (available in both modes)
- [x] **MCP-03**: Runner filters MCP servers at agent startup, only loading servers whose `modes` include the current execution mode
- [x] **MCP-04**: Host mode uses `settingSources: ['user', 'project']` to inherit global MCP servers from `~/.claude/settings.json`
- [x] **MCP-05**: Startup logs which MCP servers are active and which were filtered out due to mode incompatibility
- [x] **MCP-06**: On startup, attempt to connect to each configured MCP server and report status (connected/failed/timeout) without blocking startup

### Per-Group Overrides

- [ ] **GRP-01**: Individual groups in `registered_groups.json` can specify an `executionMode` field that overrides the global config
- [ ] **GRP-02**: Groups without an `executionMode` field inherit the global setting
- [ ] **GRP-03**: Per-group mode is resolved at message-processing time, not at startup

### Host Mode Security

- [x] **SEC-01**: Host mode tool allow-list configurable in config, controlling which tools the agent can use (defaults to full Claude Code tool set)
- [x] **SEC-02**: IPC authorization works correctly in host mode (agents can only write to their own group's IPC directory)
- [x] **SEC-03**: Non-main groups in host mode do not receive `bypassPermissions` — they use default permission mode or sandbox mode

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Operations

- **OPS-01**: Config reload on SIGHUP signal without restart
- **OPS-02**: Per-group MCP server configuration (separate from global)
- **OPS-03**: Mode-switching startup diff — show what changed since last run

## Out of Scope

| Feature | Reason |
|---------|--------|
| Runtime mode auto-detection | Invisible, hard-to-debug behavior; explicit config is non-negotiable |
| Mode switching via chat command | Security-critical config must not be agent-changeable |
| GUI config editor / web dashboard | Contradicts AI-native philosophy; Claude Code is the editor |
| Config file inheritance / cascading | One file, one source of truth; prevents "where is this setting?" debugging |
| JSON Schema `$schema` reference | Premature for a personal tool; self-documenting comments are sufficient |
| Plugin/extension system for modes | Two modes is sufficient; customization = code changes |
| Encrypted config values | Secrets stay in `.env`, config stays in JSONC; don't mix them |
| Remote config fetching | Local file, versioned, deterministic |
| Hybrid mode (auto-route by trust level) | Adds complexity; per-group explicit overrides (GRP-01) are sufficient |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 1 | Complete |
| CFG-02 | Phase 1 | Complete |
| CFG-03 | Phase 1 | Complete |
| CFG-04 | Phase 2 | Complete |
| CFG-05 | Phase 2 | Complete |
| EXEC-01 | Phase 1 | Complete |
| EXEC-02 | Phase 8 | Pending |
| EXEC-03 | Phase 4 | Complete |
| EXEC-04 | Phase 3 | Complete |
| EXEC-05 | Phase 3 | Complete |
| EXEC-06 | Phase 5 | Complete |
| EXEC-07 | Phase 5 | Complete |
| MCP-01 | Phase 6 | Complete |
| MCP-02 | Phase 6 | Complete |
| MCP-03 | Phase 6 | Complete |
| MCP-04 | Phase 7 | Complete |
| MCP-05 | Phase 6 | Complete |
| MCP-06 | Phase 7 | Complete |
| GRP-01 | Phase 8 | Pending |
| GRP-02 | Phase 8 | Pending |
| GRP-03 | Phase 8 | Pending |
| SEC-01 | Phase 5 | Complete |
| SEC-02 | Phase 5 | Complete |
| SEC-03 | Phase 5 | Complete |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-02-07*
*Last updated: 2026-02-11 after Phase 7 completion*
