# Feature Landscape: Configurable Execution Modes

**Domain:** Config-driven execution mode toggle for a Claude agent runner (container vs host-native)
**Researched:** 2026-02-07
**Overall confidence:** HIGH (grounded in existing codebase analysis + Claude Agent SDK official docs)

---

## Table Stakes

Features users expect. Missing = the config system feels broken or incomplete.

| # | Feature | Why Expected | Complexity | Dependencies | Notes |
|---|---------|--------------|------------|--------------|-------|
| T1 | **JSONC config file with comments** | The whole point of `.jsonc` over `.json` is inline documentation. Users need to annotate MCP server entries, explain mode choices. Without comments, might as well stay with `.env`. | Low | `strip-json-comments` already in `node_modules` | Use `strip-json-comments` + `JSON.parse()`. Simpler and lighter than `jsonc-parser`. The file is small config, not a language server. |
| T2 | **`executionMode` field with `"container"` default** | Safe default is non-negotiable. Container mode is the existing, battle-tested path. If someone creates a config file but doesn't set mode, container must be what they get. | Low | None | Single string field: `"container" \| "host"`. No `"auto"` or `"hybrid"` -- keep it a clean toggle. |
| T3 | **MCP server mode tags** | Each MCP server needs a `modes` array (`["host"]`, `["container"]`, `["host", "container"]`) so the runner knows which servers to activate per mode. Without this, mode switching is meaningless. | Med | T2 | Servers without a `modes` field default to `["host", "container"]` (available in both). This is the graceful default -- existing configs keep working. |
| T4 | **Mode-aware MCP server filtering** | At agent startup, filter the `mcpServers` object to only include servers whose `modes` array includes the current `executionMode`. This is the core mechanic. | Med | T2, T3 | Filter happens in the runner before passing `mcpServers` to `query()`. Container mode continues using its existing server injection. Host mode builds the server list from config. |
| T5 | **Startup mode banner / warning** | When running in host mode, print a clear, unmistakable warning at startup: the agent has full macOS access, no filesystem isolation, Bash runs on your actual machine. | Low | T2 | Use the existing pino logger + a boxed ASCII banner (similar to the existing `ensureContainerSystemRunning` fatal error box). Not a prompt -- just a visible log line. |
| T6 | **Config file validation with clear errors** | Parse errors, unknown fields, invalid mode values, or malformed MCP server entries must produce actionable error messages pointing to the exact problem. Silent failures are unacceptable for a config file. | Med | T1 | No need for JSON Schema validation library. Hand-written validation with specific error messages is clearer for a config with < 20 fields. Validate on startup, fail fast. |
| T7 | **Host mode inherits global MCP servers from `~/.claude/settings.json`** | The whole value proposition of host mode is accessing your full macOS tool ecosystem. The user's global MCP servers (mail, apple-mcp, etc.) are configured in `~/.claude/settings.json`. Host mode should merge these in automatically. | Med | T2, T4 | Use `settingSources: ['user', 'project']` in the `query()` options when running host mode. This tells the SDK to load `~/.claude/settings.json` MCP servers natively. Container mode stays at `settingSources: ['project']` only. |
| T8 | **Config file location at project root** | `nanoclaw.config.jsonc` lives at project root alongside `package.json`, `.mcp.json`, etc. This is the standard convention for project config files (tsconfig.json, prettier.config.js, etc.). | Low | None | Single known path. No config file discovery chain. No `--config` flag. Opinionated: one file, one place. |
| T9 | **Graceful degradation when config file is absent** | If `nanoclaw.config.jsonc` doesn't exist, the app runs in container mode with current behavior. Zero behavioral change for existing users who haven't opted in. | Low | T2, T8 | This is critical for backwards compatibility. The config file is opt-in, not required. |

## Differentiators

Features that set this implementation apart. Not expected, but make the system notably better.

| # | Feature | Value Proposition | Complexity | Dependencies | Notes |
|---|---------|-------------------|------------|--------------|-------|
| D1 | **Host runner with `sandbox` settings** | Instead of raw `bypassPermissions` in host mode, use the Agent SDK's `sandbox` option to get OS-level Seatbelt isolation on macOS. This gives host mode real security boundaries: filesystem write restrictions, network domain allowlists, all enforced at the OS level. Host mode becomes "macOS with guardrails" rather than "YOLO mode". | Med | T2 | The SDK supports `sandbox: { enabled: true, autoAllowBashIfSandboxed: true }` with configurable filesystem and network rules. This is a significant security upgrade over raw host execution. Expose sandbox config through `nanoclaw.config.jsonc`. |
| D2 | **Per-group mode override** | Allow individual groups to specify their execution mode, overriding the global default. Main channel might run in host mode (trusted, needs macOS access), while other groups stay in container mode (untrusted). | Med | T2, T4 | Add optional `executionMode` field to the `RegisteredGroup` type. Falls back to global config when not set. This aligns with the existing trust model: main is trusted, non-main is untrusted. |
| D3 | **Config file as self-documenting template** | Ship `nanoclaw.config.jsonc` with extensive comments explaining every field, every mode, every trade-off. The config file IS the documentation. Users read it, uncomment what they want, done. | Low | T1, T8 | This is a design choice, not a feature. But it's a differentiator because most config systems have sparse comments. NanoClaw's philosophy is "AI-native development" -- the config should be readable by Claude Code too. Include an example for each MCP server showing mode tags. |
| D4 | **Host mode tool allow-list configuration** | Let the config specify which tools the agent can use in host mode. Default to Claude Code's full tool set, but allow restricting (e.g., no Bash, or Bash only with sandbox). This gives the user fine-grained control. | Low | T2 | Maps directly to `allowedTools` in the SDK `query()` options. Already supported -- just needs to be exposed through the config file. |
| D5 | **MCP server health check on startup** | When starting in host mode, attempt to connect to each configured MCP server and report status (connected/failed/timeout). This catches misconfigured servers before the first message arrives. | Med | T4 | The SDK's `query().mcpServerStatus()` method returns server status. Run a lightweight probe on startup and log results. Don't block startup on failures -- log warnings and continue. |
| D6 | **Environment variable expansion in config** | Support `${VAR}` and `${VAR:-default}` syntax in config values, especially for MCP server args and env fields. This avoids hardcoding paths like `/Users/alvin/dev/...`. | Low | T1 | The Claude Agent SDK already supports env var expansion in `.mcp.json`. Match that behavior. Simple regex replacement at parse time. |
| D7 | **Config reload on SIGHUP** | Re-read `nanoclaw.config.jsonc` on SIGHUP signal without restarting the process. Useful for changing MCP server configs or toggling modes without downtime. | Med | T1, T6 | Reload config, re-validate, log changes. New agents pick up the new config. Existing running agents finish with old config. Does NOT hot-swap running containers/processes. |

## Anti-Features

Features to explicitly NOT build. Common mistakes in this domain.

| # | Anti-Feature | Why Avoid | What to Do Instead |
|---|--------------|-----------|-------------------|
| A1 | **Runtime mode auto-detection** | A system that "figures out" whether to use container or host based on environment (e.g., "if Docker available, use container; if not, fall back to host") creates invisible, hard-to-debug behavior. The user should always explicitly choose. | Explicit `executionMode` field. If container mode is selected but containers aren't available, fail with a clear error rather than silently falling back to host. |
| A2 | **Hybrid mode (some groups container, some host, auto-routed)** | Per-group overrides (D2) are fine because they're explicit. But an "auto" mode that routes based on trust level or message content adds complexity without proportional value. The routing logic becomes a security-critical path that's hard to reason about. | Per-group explicit overrides. The decision is made at registration time, not at message-processing time. |
| A3 | **GUI config editor / web dashboard** | NanoClaw's philosophy is "AI-native development." Claude Code IS the config editor. A web dashboard contradicts the project's core identity and adds massive maintenance burden. | The JSONC file is the interface. Claude Code edits it via the `/customize` skill. The file's comments serve as inline documentation. |
| A4 | **Config file inheritance / cascading** | Don't create a hierarchy of config files (global -> project -> local -> group). One file, one source of truth. Config inheritance creates "where is this setting coming from?" debugging nightmares. | Single `nanoclaw.config.jsonc` at project root. Per-group overrides go in the registered groups data, not in separate config files. |
| A5 | **JSON Schema `$schema` reference** | Adding a `$schema` field pointing to a hosted JSON schema for IDE validation sounds nice but requires maintaining a schema, hosting it, and keeping it in sync. Premature for a personal tool. | Rely on the self-documenting comments in the JSONC file. Claude Code provides the validation/editing experience. |
| A6 | **Plugin/extension system for modes** | Don't make execution modes pluggable or allow third-party mode definitions. Two modes (container, host) is sufficient. If someone needs something else, they modify the source. | NanoClaw's philosophy: "Customization = Code Changes." The codebase is small enough that adding a third mode is a simple code change, not a plugin. |
| A7 | **Encrypted config values** | Don't put secrets in the config file, encrypted or otherwise. Secrets belong in `.env` (already handled). Config belongs in `nanoclaw.config.jsonc`. Keep them separate. | Continue using `.env` for credentials. Config file references environment variables via `${VAR}` expansion (D6) when needed. |
| A8 | **Remote config fetching** | Don't fetch config from a URL, API, or remote store. The config file is local, versioned, and deterministic. | Local file only. If someone wants remote config, they can write a script that fetches and writes the local file. |
| A9 | **Mode-switching at runtime via chat command** | Don't allow `@Nano switch to host mode` to change the execution mode mid-session. This is a security-critical configuration that should require editing the config file and restarting (or at most SIGHUP). | Config file change + restart/SIGHUP (D7). The agent should never be able to change its own execution environment. |

## Feature Dependencies

```
T1 (JSONC parsing)
 |
 +-- T6 (validation)
 |    |
 |    +-- D7 (reload on SIGHUP)
 |
 +-- T8 (file location) + T9 (graceful absence)
 |
 +-- D6 (env var expansion)
 |
 +-- D3 (self-documenting template)

T2 (executionMode field)
 |
 +-- T5 (startup warning)
 |
 +-- T3 (MCP mode tags)
 |    |
 |    +-- T4 (mode-aware filtering)
 |         |
 |         +-- T7 (inherit global MCP servers)
 |         |
 |         +-- D5 (health check)
 |
 +-- D1 (sandbox settings)
 |
 +-- D2 (per-group override)
 |
 +-- D4 (tool allow-list)
```

Critical path: T1 -> T2 -> T3 -> T4 -> T7 (this is the minimum for a working mode toggle)

## MVP Recommendation

For MVP, prioritize this order:

1. **T1 + T8 + T9**: JSONC parsing with graceful absence (foundation)
2. **T2 + T5**: `executionMode` field with startup warning (the toggle)
3. **T3 + T4**: MCP mode tags and filtering (makes the toggle meaningful)
4. **T6**: Config validation (catches user errors)
5. **T7**: Host mode inherits `~/.claude/settings.json` (the killer feature of host mode)
6. **D3**: Self-documenting config template (ships with the feature)

Defer to post-MVP:
- **D1** (sandbox settings): Valuable but adds complexity. Ship host mode first, add Seatbelt guardrails second.
- **D2** (per-group override): Requires careful security review of the trust model implications.
- **D5** (health check): Nice-to-have. Users can debug MCP issues via logs.
- **D7** (config reload): Restart is fine for a personal tool. SIGHUP is a luxury.

## Key Design Decisions

### Why JSONC over YAML/TOML?

- JSONC is the native config format for the Claude/VS Code ecosystem (`.mcp.json`, `settings.json`, `tsconfig.json`)
- `strip-json-comments` is already in the dependency tree
- Users working with NanoClaw already think in JSON
- YAML indentation errors are a common source of bugs; TOML is unfamiliar to most

### Why not extend `.env` or `src/config.ts`?

- `.env` is for secrets and simple key-value pairs. Mode configuration with nested MCP server objects doesn't fit.
- `src/config.ts` is for constants that rarely change. Execution mode is a user-facing configuration that changes per deployment.
- A dedicated config file makes the configuration surface prominent and discoverable.

### Why not use the existing `.mcp.json`?

- `.mcp.json` is for Claude Code (the development tool) MCP servers. It's loaded when a developer uses Claude Code on the NanoClaw project itself.
- `nanoclaw.config.jsonc` is for the NanoClaw application's runtime behavior. Different audience, different lifecycle.
- Mixing them creates confusion about which MCP servers are for development vs. runtime.

### Host mode: `bypassPermissions` vs `sandbox`

The existing container runner uses `permissionMode: 'bypassPermissions'` because the container IS the sandbox. For host mode:

- **MVP**: Use `bypassPermissions` for the main channel (trusted). This matches the container behavior where Bash runs without prompts.
- **Post-MVP (D1)**: Add `sandbox` settings for OS-level Seatbelt isolation. This gives host mode meaningful security without container overhead.
- **Non-main groups in host mode**: Should NOT get `bypassPermissions`. Use `permissionMode: 'default'` or sandbox mode. This preserves the trust distinction.

### `settingSources` strategy per mode

| Mode | `settingSources` | Why |
|------|-----------------|-----|
| Container | `['project']` | Current behavior. Only loads project `.claude/` settings. Global MCP servers can't run inside Linux containers anyway. |
| Host | `['user', 'project']` | Loads `~/.claude/settings.json` (global MCP servers like mail, apple-mcp) AND project settings. This is the whole point of host mode. |

This is the simplest, most powerful differentiator. One option change unlocks the user's entire macOS tool ecosystem.

## Sources

- [Claude Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) - `query()` options, `settingSources`, `mcpServers`, `sandbox` configuration (HIGH confidence)
- [Claude Agent SDK Secure Deployment](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) - Container vs host isolation patterns, proxy architecture, credential management (HIGH confidence)
- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing) - macOS Seatbelt, filesystem/network isolation, sandbox settings (HIGH confidence)
- [Claude Code MCP Configuration](https://code.claude.com/docs/en/mcp) - `.mcp.json` format, environment variable expansion, transport types (HIGH confidence)
- [Feature Toggles (Martin Fowler)](https://martinfowler.com/articles/feature-toggles.html) - Runtime toggle design patterns (MEDIUM confidence)
- Existing NanoClaw codebase analysis: `src/container-runner.ts`, `src/config.ts`, `src/index.ts`, `src/types.ts`, `container/agent-runner/src/index.ts` (HIGH confidence - primary source)
