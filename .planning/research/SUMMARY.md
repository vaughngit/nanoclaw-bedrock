# Project Research Summary

**Project:** NanoClaw Host-Native Execution Mode
**Domain:** AI agent execution infrastructure with dual isolation modes
**Researched:** 2026-02-07
**Confidence:** HIGH

## Executive Summary

NanoClaw is adding a host-native execution mode alongside its existing container-based isolation. This enables agents to access the user's full macOS tool ecosystem (global MCP servers, filesystem, native processes) while maintaining optional sandbox boundaries. The research reveals a critical security insight: **host mode is not "container minus isolation" — it requires explicit OS-level sandboxing via macOS Seatbelt to avoid creating a remote code execution vector.** The recommended approach uses Anthropic's `sandbox-runtime` for macOS Seatbelt enforcement, reuses the existing agent-runner codebase with environment-driven path configuration, and introduces JSONC config for mode switching and MCP server management.

The implementation has high technical confidence (all technologies are proven, agent-runner requires minimal changes) but critical security dependencies (sandbox-runtime must ship in Phase 1, not as post-MVP hardening). The remote-trigger nature of NanoClaw (WhatsApp/Slack messages, scheduled tasks) elevates the risk profile compared to interactive development tools. The OpenClaw vulnerability disclosures demonstrate that this exact class of system — remote trigger + shell access + host execution — is actively exploited.

Key architectural win: the IPC protocol (filesystem JSON) works identically in both modes, so the router, queue, and message handling stay completely unchanged. The only moving parts are config loading, runner selection, and agent-runner path configuration. Total new production dependencies: 1 (`jsonc-parser`). MVP delivery timeline: 3-4 phases if security requirements are met in Phase 1.

## Key Findings

### Recommended Stack

The stack research prioritized zero new dependencies and reuse of existing patterns. NanoClaw already uses raw `child_process.spawn()` consistently (container-runner, host setup), Zod for validation, Pino for logging, and the Claude Agent SDK for agent invocation. The only new dependency needed is `jsonc-parser` (Microsoft's official library, powers VS Code config parsing) for JSONC config file support.

**Core technologies:**
- **`jsonc-parser` (v3.3.1)**: Parse `nanoclaw.config.jsonc` with comments, trailing commas, fault-tolerant error reporting. Zero transitive dependencies. Battle-tested across the VS Code ecosystem.
- **Node.js `child_process.spawn()`**: Already used throughout codebase. Host runner spawns agent-runner as a Node.js subprocess (not a container) with absolute path environment variables. No execa/tinyexec needed — raw spawn handles all requirements.
- **`@anthropic-ai/claude-agent-sdk` (^0.2.34)**: Same SDK, same `query()` API. Critical configuration: `settingSources: ['project', 'user']` in host mode enables inheritance of `~/.claude/settings.json` MCP servers. This is the killer feature differentiator.
- **Zod (already installed)**: Config validation. Define `NanoClawConfig` schema, parse JSONC through it, get type-safe config with clear error messages.

**Key architectural insight from stack research:** Host runner should spawn the existing `container/agent-runner/src/index.ts` as a subprocess, not duplicate it. Make agent-runner path-configurable via environment variables (`NANOCLAW_IPC_DIR`, `NANOCLAW_GROUP_DIR`, `NANOCLAW_GLOBAL_DIR`, `CLAUDE_HOME`). Container mode continues to use hardcoded `/workspace/*` defaults. Host mode passes absolute host paths. Same code, both modes.

**What NOT to use:** Execa (15+ deps for features NanoClaw doesn't need), JSON5 (wrong format, adds confusion vs JSONC standard), comment-json (round-trip preservation not needed), cosmiconfig (overkill for single config file), dotenv (already using Node 20+ `--env-file` flag).

### Expected Features

The feature research identified 9 table stakes, 7 differentiators, and 9 anti-features. The critical path for MVP is T1→T2→T3→T4→T7 (JSONC parsing, execution mode toggle, MCP mode tags, filtering, global MCP inheritance).

**Must have (table stakes):**
- **JSONC config with comments** (T1): Inline documentation for MCP servers and mode choices. The file IS the documentation.
- **`executionMode` field with "container" default** (T2): Safe default is non-negotiable. Explicit mode selection, no auto-detection.
- **MCP server mode tags** (T3): Each server gets `modes: ["host", "container"]` array. Servers without tags default to both modes.
- **Mode-aware MCP filtering** (T4): Filter `mcpServers` object at agent startup to include only servers whose `modes` array includes current `executionMode`.
- **Startup mode banner/warning** (T5): Clear log when running in host mode stating agent has full macOS access, no filesystem isolation.
- **Config validation with clear errors** (T6): Parse errors, unknown fields, invalid mode values must produce actionable error messages. No JSON Schema — hand-written validation is clearer.
- **Host mode inherits global MCP servers** (T7): Use `settingSources: ['project', 'user']` to load `~/.claude/settings.json` servers. This is the whole value proposition of host mode.
- **Config file at project root** (T8): `nanoclaw.config.jsonc` alongside package.json. Single known path, no discovery chain, no `--config` flag.
- **Graceful degradation when config absent** (T9): If config file doesn't exist, run in container mode with current behavior. Zero breaking changes for existing users.

**Should have (competitive):**
- **Sandbox settings for host mode** (D1): Use Agent SDK's `sandbox` option for OS-level Seatbelt isolation on macOS. Makes host mode "macOS with guardrails" not "YOLO mode."
- **Per-group mode override** (D2): Allow individual groups to specify execution mode, overriding global default. Main runs host, others run container.
- **Self-documenting config template** (D3): Ship `nanoclaw.config.jsonc` with extensive comments explaining every field. The config is the documentation.
- **Tool allow-list configuration** (D4): Let config specify which tools the agent can use in host mode. Maps to `allowedTools` in SDK options.
- **MCP health check on startup** (D5): Attempt connection to each configured MCP server, log status. Don't block startup, just warn.
- **Environment variable expansion** (D6): Support `${VAR}` syntax in config values for MCP server args/env. Match `.mcp.json` behavior.
- **Config reload on SIGHUP** (D7): Re-read config without restart. New agents pick up new config.

**Defer (v2+):**
- Runtime mode auto-detection (creates invisible behavior)
- GUI config editor (contradicts "AI-native development" philosophy)
- Config file inheritance/cascading (creates "where is this setting" debugging nightmares)
- Plugin system for modes (two modes are sufficient)
- Encrypted config values (secrets belong in `.env`)
- Remote config fetching (local file only)
- Mode switching via chat command (security-critical, requires restart)

**Key design decision:** Why JSONC over YAML/TOML? JSONC is the native format for Claude/VS Code ecosystem (`.mcp.json`, `settings.json`, `tsconfig.json`). Users working with NanoClaw already think in JSON. `jsonc-parser` is lightweight and battle-tested.

### Architecture Approach

The architecture research analyzed the existing codebase and found that only 2 components need changes for host mode: agent-runner (make paths configurable) and runner dispatch (select container vs host). The IPC protocol, message router, queue, database, and I/O layers stay completely unchanged.

**Major components:**
1. **Config Loader** (`src/config-loader.ts`, NEW): Parse JSONC, merge defaults, validate with Zod, export typed config. Standalone, no dependencies on existing code except config.ts.
2. **Runner Abstraction** (`src/runner.ts`, NEW): Shared types (`RunAgentFn`, `RunnerInput`, `RunnerOutput`) extracted from container-runner. Factory function creates container or host runner based on config.
3. **Host Runner** (`src/host-runner.ts`, NEW): Spawn `node container/agent-runner/dist/index.js` with env vars for paths, same stdin/stdout/sentinel protocol as container-runner, same `onProcess` callback for GroupQueue, simpler timeout (SIGTERM the node process).
4. **Agent-Runner Refactor** (`container/agent-runner/src/index.ts`, MODIFIED): Accept paths via env vars (`NANOCLAW_IPC_DIR`, `NANOCLAW_GROUP_DIR`, `NANOCLAW_GLOBAL_DIR`, `CLAUDE_HOME`) with `/workspace/*` defaults for backward compatibility. Add `NANOCLAW_MODE` env var to control `settingSources`.
5. **IPC MCP Refactor** (`container/agent-runner/src/ipc-mcp.ts`, MODIFIED): Make `IPC_DIR` configurable via env var instead of hardcoded `/workspace/ipc`.

**Data flow differences:**
- **Container mode**: Volume mounts translate paths (`groups/{folder}` → `/workspace/group`). Agent sees clean `/workspace/*` hierarchy. `settingSources: ['project']` only.
- **Host mode**: Env vars provide absolute paths (`NANOCLAW_GROUP_DIR=/abs/path/to/groups/{folder}`). Agent sees real filesystem. `settingSources: ['project', 'user']` inherits global MCP servers.

**Patterns to follow:**
1. **Stdin/stdout IPC with sentinel markers**: Both runners pipe JSON to stdin, read JSON from stdout between `---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---`. This solves debug output separation.
2. **Process registration for shutdown**: Both runners call `onProcess(proc, name)` after spawning for GroupQueue shutdown coordination.
3. **Per-group IPC namespace**: Each group gets `data/ipc/{folder}/` and authorization derives from directory identity. Works identically in both modes.

**Anti-patterns to avoid:**
1. **Abstracting too early**: No elaborate interface hierarchies. One type (`RunAgentFn`), one factory, two implementations. Codebase is small enough to understand.
2. **Separate agent-runner codebases**: Don't duplicate the 350-line agent-runner logic. Make it path-configurable, run same code.
3. **Runtime mode switching**: Mode is read once at startup. Changing mode requires restart (security-critical config).
4. **Per-group mode selection**: Single mode for entire system initially (defer per-group overrides to Phase 2).

### Critical Pitfalls

The pitfalls research revealed **5 CRITICAL severity issues** that must be addressed in Phase 1 (not post-MVP hardening). All relate to security boundaries that the container provided but host mode loses without explicit replacement.

1. **Treating host mode as "container minus isolation"** (CRITICAL): Naive refactor removes container spawn but doesn't replace filesystem isolation, process isolation, or security boundaries. Agent gets access to `~/.ssh`, `~/.aws`, `.env`, WhatsApp auth state. **Prevention:** Use `@anthropic-ai/sandbox-runtime` (macOS Seatbelt) from day 1. Define Seatbelt profile mirroring container's mount restrictions. Test by attempting to read `~/.ssh/id_ed25519` — must fail.

2. **`bypassPermissions` without sandbox in host mode** (CRITICAL): Agent-runner uses `permissionMode: 'bypassPermissions'` which is safe in containers (container is the boundary) but dangerous on host. Combined with `allowedTools: ['Bash', ...]`, agent executes arbitrary shell commands with user's full privileges. There's a documented SDK bug where `allowedTools` restrictions aren't enforced with `bypassPermissions`. **Prevention:** Either (a) use sandbox-runtime and keep `bypassPermissions`, or (b) switch to permission mode requiring approval. Set `allowUnsandboxedCommands: false` explicitly. Add startup assertion: if `mode === 'host'` and `bypassPermissions`, verify sandbox is active.

3. **Remote trigger + host execution = RCE** (CRITICAL): NanoClaw agents are triggered by WhatsApp/Slack messages and scheduled tasks. In host mode without sandbox, every remote input becomes potential remote code execution. The OpenClaw CVE-2026-25253 demonstrates this exact attack. **Prevention:** Mandatory sandbox-runtime. Consider requiring confirmation for host mode from non-main groups. Add `hostModeAllowed` field to scheduled task schema (default false). Log all host-mode invocations with trigger source.

4. **IPC protocol works too well across modes** (CRITICAL): IPC authorization derives source identity from directory (filesystem-based). In container mode, each agent is confined to its own `data/ipc/{group}/` directory. In host mode without confinement, agent can write to other groups' IPC directories, spoofing authorization and gaining main-group privileges. **Prevention:** Sandbox restricts filesystem access to own IPC directory only (same as container mounts provided). Add cryptographic/process-based IPC authentication as defense-in-depth. Or switch to stdio-based IPC in host mode (agent writes to stdout, host reads from subprocess).

5. **Config file as attack surface** (CRITICAL): `nanoclaw.config.jsonc` in project root is writable by agent in host mode with Bash access. Agent can modify config to switch modes, disable sandbox, reconfigure MCP servers. **Prevention:** Place config outside project root (`~/.config/nanoclaw/config.jsonc`) like mount-allowlist, OR sandbox-protect the config file (read-only for non-main groups). Add config integrity hash verified before each invocation. No hot-reload of security-critical settings.

**Moderate pitfalls (6-10):**
- MCP server mode tags create silent feature loss when switching modes (need startup warnings)
- Host mode inherits too many global MCP servers (main-only default recommended)
- Agent working directory confusion between modes (path resolution must be tested)
- Session isolation breaks if agent uses `~/.claude/` instead of `data/sessions/{group}/.claude/` (override HOME env var)
- Credential exposure if subprocess inherits full environment (explicit env filtering required)

**Phase-specific warnings:** All 5 critical pitfalls must be addressed in Phase 1 (host runner implementation). These are not hardening steps — they are core implementation requirements. The sandbox is not optional.

## Implications for Roadmap

Based on combined research, **3-phase MVP structure** is recommended. Security requirements elevate Phase 1 complexity but are non-negotiable. The critical path is clear: config → runner → security.

### Phase 1: Config Foundation + Container Refactor

**Rationale:** Everything depends on knowing the execution mode. Config loading is standalone. Agent-runner refactor is backward-compatible (container mode continues to work unchanged) and required before host runner can reuse the code.

**Delivers:**
- `nanoclaw.config.jsonc` with defaults, inline comments, self-documenting template (T1, T8, D3)
- `src/config-loader.ts` — parse JSONC, validate with Zod, merge defaults (T6)
- Graceful degradation when config absent (T9)
- `executionMode` field with "container" default (T2)
- Agent-runner refactor: paths via env vars (`NANOCLAW_IPC_DIR`, etc.) with `/workspace/*` defaults
- Container image rebuild with refactored agent-runner
- Backward compatibility verification: container mode works identically

**Addresses features:** T1, T2, T6, T8, T9, D3

**Avoids pitfalls:** Establishes config file location (addresses Pitfall 5). Refactors agent-runner without behavioral changes (avoids Pitfall 2 — separate codebases).

**Complexity:** Medium. Config parsing is straightforward. Agent-runner refactor requires careful testing but changes are minimal (env var defaults).

**Research needs:** None (standard patterns, well-documented libraries).

### Phase 2: Host Runner + Sandbox Implementation

**Rationale:** Depends on Phase 1 (config tells us we're in host mode, agent-runner accepts path env vars). This is the critical security phase — all 5 critical pitfalls must be addressed here, not deferred.

**Delivers:**
- `src/host-runner.ts` — spawn agent-runner as Node.js subprocess with env vars
- Same stdin/stdout/sentinel protocol as container-runner
- Same `onProcess` callback for GroupQueue registration
- Explicit environment filtering matching container's `allowedVars`
- HOME override for session isolation (Pitfall 9)
- `settingSources: ['project', 'user']` for global MCP inheritance (T7)
- **macOS Seatbelt sandbox via `sandbox-runtime`** (addresses Pitfalls 1, 2, 4)
- Sandbox profile restricting filesystem to: group folder, global (read-only for non-main), IPC dir, session dir
- `allowUnsandboxedCommands: false` enforcement
- Startup assertion: host mode + `bypassPermissions` requires active sandbox
- Startup banner/warning for host mode (T5)
- IPC authentication enhancement (defense-in-depth for Pitfall 4)

**Addresses features:** T4 (MCP filtering), T5 (startup warning), T7 (global MCP inheritance), D1 (sandbox settings)

**Avoids pitfalls:** 1 (isolation replacement), 2 (`bypassPermissions` safety), 3 (RCE mitigation via sandbox), 4 (IPC spoofing), 5 (config protection), 8 (working directory), 9 (session isolation), 10 (credential exposure)

**Complexity:** High. Sandbox configuration requires deep understanding of macOS Seatbelt and `sandbox-runtime` API. IPC authentication adds protocol complexity. Security testing is critical.

**Research needs:** HIGH — `sandbox-runtime` integration patterns, Seatbelt profile syntax, testing approaches. This phase should use `/gsd:research-phase` to investigate sandbox-runtime before implementation.

### Phase 3: MCP Server Integration + Polish

**Rationale:** Depends on Phase 2 (host runner works, sandbox is active). This phase adds mode-aware MCP server management and user-facing polish.

**Delivers:**
- MCP server mode tags in config schema (T3)
- Mode-aware MCP filtering at agent startup (T4)
- Startup warnings for unavailable MCP servers (addresses Pitfall 6)
- Mode information in agent system prompt (Claude knows which tools are available)
- Per-group mode override support (D2)
- Tool allow-list configuration (D4)
- MCP health check on startup (D5)
- Environment variable expansion in config (D6)
- Mode-aware log format (`host-{timestamp}.log` vs `container-{timestamp}.log`)
- Integration testing: same prompt in both modes, compare results
- Documentation updates

**Addresses features:** T3, T4, D2, D4, D5, D6

**Avoids pitfalls:** 6 (silent feature loss), 7 (global MCP inheritance scope), 11 (JSONC edge cases), 12 (container-specific code in host mode), 13 (log format)

**Complexity:** Medium. MCP filtering logic is straightforward. Per-group overrides require security policy decisions. Health checks are nice-to-have.

**Research needs:** LOW — MCP server types and transports are documented. Health check implementation may need SDK API research.

### Phase 4 (Optional): Advanced Features

**Rationale:** Post-MVP hardening and user experience enhancements.

**Delivers:**
- Config reload on SIGHUP (D7)
- Per-group mode overrides for non-main groups (extends D2)
- Advanced sandbox profiles per group
- Rate limiting for host-mode invocations
- Forensic logging and audit trail

**Deferred:** Not essential for MVP. Can be added based on real-world usage patterns.

### Phase Ordering Rationale

- **Foundation first**: Config loading is the dependency for everything else. Agent-runner refactor must happen before host runner can reuse it. These are low-risk, standalone changes.
- **Security cannot be deferred**: Pitfalls research revealed that host mode without sandbox is fundamentally unsafe for a remote-triggered system. The OpenClaw vulnerabilities demonstrate active exploitation. Sandbox must ship in Phase 2, not as post-MVP hardening.
- **MCP integration last**: Requires working host runner. MCP filtering is pure logic (no external dependencies). Can be tested independently.
- **Tight MVP scope**: Phases 1-3 deliver the full feature (config-driven mode switching, secure host execution, MCP server management). Phase 4 is polish and can adapt to user feedback.

### Research Flags

**Needs deep research during planning:**
- **Phase 2 (Host Runner + Sandbox)**: `@anthropic-ai/sandbox-runtime` integration patterns, Seatbelt profile syntax, testing methodologies. This is a niche domain with sparse public examples. Use `/gsd:research-phase` to investigate sandbox-runtime API, profile examples, and validation approaches before implementation starts.

**Standard patterns (skip research-phase):**
- **Phase 1 (Config Foundation)**: JSONC parsing with `jsonc-parser`, Zod validation, TypeScript config patterns are well-documented. Straightforward implementation.
- **Phase 3 (MCP Integration)**: MCP server types, `settingSources`, mode filtering are covered in official Agent SDK docs. Health checks may need brief API research but not a full research phase.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified via official docs and npm registry. `jsonc-parser` v3.3.1 confirmed, Agent SDK v0.2.34 confirmed, spawn API stable in Node 20+. Only minor question: `AbortSignal.timeout()` with spawn has had edge cases historically (test on Node 25.5.0). |
| Features | HIGH | Feature landscape grounded in existing codebase analysis and official Agent SDK docs. Table stakes derived from JSONC ecosystem conventions and NanoClaw's current architecture. Differentiators align with Anthropic's recommended patterns. |
| Architecture | HIGH | All findings based on direct NanoClaw codebase analysis. No external library research needed. Runner abstraction preserves existing patterns. Agent-runner refactor is backward-compatible (container mode defaults to `/workspace/*`). IPC protocol works identically in both modes. |
| Pitfalls | HIGH | Backed by Anthropic security docs, OpenClaw CVE disclosures (CVE-2026-25253), Tenable/Snyk/CrowdStrike vulnerability analysis, and OWASP AI Agent Security guidelines. Critical pitfalls are well-documented in similar systems. |

**Overall confidence:** HIGH

### Gaps to Address

- **Sandbox-runtime integration details**: While the need for `sandbox-runtime` is clear, the specific API surface, profile syntax, and testing methodology require deeper investigation. This should be researched in Phase 2 using `/gsd:research-phase` before implementation begins. Confidence on "how to configure Seatbelt profiles" is MEDIUM — need examples from Anthropic docs or repo.

- **IPC authentication mechanism**: Multiple options (cryptographic tokens, nonces, stdio-based IPC). The optimal approach depends on performance requirements and complexity tolerance. Should be decided early in Phase 2 design. Confidence is MEDIUM — need to validate which approach the Agent SDK supports or if custom protocol is needed.

- **MCP server health check API**: Agent SDK may or may not expose `mcpServerStatus()` method as indicated in research. Need to verify exact API in Phase 3. If not available, may need to ping servers directly. Confidence is MEDIUM — assumed from general SDK patterns but not verified.

- **Per-group mode override security implications**: Allowing different groups to run in different modes (D2) requires careful security review. Who decides which groups get host mode? Can a group escalate itself? Should main-group approval be required? These policy decisions should be made early in Phase 3. Confidence on security model is MEDIUM — existing trust model (main vs non-main) is clear, but extension to per-group modes needs analysis.

## Sources

### Primary (HIGH confidence)

**Stack Research:**
- [jsonc-parser on npm](https://www.npmjs.com/package/jsonc-parser) — v3.3.1 confirmed
- [jsonc-parser on GitHub (Microsoft)](https://github.com/microsoft/node-jsonc-parser) — API reference
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — v0.2.34 confirmed
- [Claude Agent SDK MCP docs](https://platform.claude.com/docs/en/agent-sdk/mcp) — `settingSources`, `mcpServers` config
- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — `query()` options, `McpServerConfig` types
- [Node.js child_process docs (v25.6.0)](https://nodejs.org/api/child_process.html) — spawn, AbortSignal support

**Features Research:**
- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — `query()` options, `settingSources`, `mcpServers`, `sandbox` configuration
- [Claude Agent SDK Secure Deployment](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) — Container vs host isolation patterns
- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing) — macOS Seatbelt, filesystem/network isolation
- [Claude Code MCP Configuration](https://code.claude.com/docs/en/mcp) — `.mcp.json` format, environment variable expansion
- NanoClaw codebase: `src/container-runner.ts`, `src/config.ts`, `src/index.ts`, `src/types.ts`, `container/agent-runner/src/index.ts`

**Architecture Research:**
- Direct codebase analysis: `src/container-runner.ts`, `src/index.ts`, `container/agent-runner/src/index.ts`, `container/agent-runner/src/ipc-mcp.ts`, `src/types.ts`, `src/config.ts`, `src/group-queue.ts`, `src/task-scheduler.ts`, `src/mount-security.ts`
- `.planning/PROJECT.md` — project requirements and constraints
- `.planning/codebase/ARCHITECTURE.md` — existing architecture analysis
- `container/Dockerfile` — container image build

**Pitfalls Research:**
- [Anthropic: Securely Deploying AI Agents](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) — comprehensive host execution security guide
- [Anthropic: sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) — macOS Seatbelt-based sandbox
- [Anthropic: Claude Code Sandboxing Engineering Blog](https://www.anthropic.com/engineering/claude-code-sandboxing) — sandbox architecture
- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing) — sandbox configuration
- [Claude Agent SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions) — `bypassPermissions` security implications

### Secondary (MEDIUM confidence)

**Pitfalls Research:**
- [Tenable: OpenClaw/Clawdbot Vulnerabilities](https://www.tenable.com/blog/agentic-ai-security-how-to-mitigate-clawdbot-moltbot-openclaw-vulnerabilities) — CVE-2026-25253 analysis
- [Snyk: Clawdbot Shell Access Risk](https://snyk.io/articles/clawdbot-ai-assistant/) — prompt injection chains
- [CrowdStrike: OpenClaw Security Analysis](https://www.crowdstrike.com/en-us/blog/what-security-teams-need-to-know-about-openclaw-ai-super-agent/) — enterprise security perspective
- [SecurityWeek: OpenClaw Hijack Vulnerability](https://www.securityweek.com/vulnerability-allows-hackers-to-hijack-openclaw-ai-assistant/amp/)
- [Cisco: Personal AI Agents Security Nightmare](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare)
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [NVIDIA: Sandboxing Agentic Workflows](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk)
- [MCP Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices)
- [Claude Agent SDK allowedTools bypass bug](https://github.com/anthropics/claude-agent-sdk-typescript/issues/115)
- [Missing warning for dangerouslyDisableSandbox + bypassPermissions](https://github.com/anthropics/claude-code/issues/17838)

### Tertiary (LOW confidence)

**Stack Research:**
- [strip-json-comments on npm](https://www.npmjs.com/package/strip-json-comments) — evaluated and rejected for `jsonc-parser`
- [execa on npm](https://www.npmjs.com/package/execa) — evaluated and rejected
- [tinyexec on npm](https://www.npmjs.com/package/tinyexec) — evaluated and rejected
- [JSONC specification](https://jsonc.org/) — format definition

**Features Research:**
- [Feature Toggles (Martin Fowler)](https://martinfowler.com/articles/feature-toggles.html) — runtime toggle design patterns

**Pitfalls Research:**
- [Simon Willison: The Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — agent security risk framework
- [Adversa AI: OpenClaw Security 101](https://adversa.ai/blog/openclaw-security-101-vulnerabilities-hardening-2026/) — general hardening guidance
- [Kaspersky: Agentic AI Risks 2026](https://www.kaspersky.com/blog/top-agentic-ai-risks-2026/55184/) — industry risk landscape

---

*Research completed: 2026-02-07*
*Ready for roadmap: yes*
