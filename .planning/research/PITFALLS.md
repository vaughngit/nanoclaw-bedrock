# Domain Pitfalls: Host-Native Execution for NanoClaw

**Domain:** Container-to-host execution mode for remotely-triggered AI agent system
**Researched:** 2026-02-07
**Overall confidence:** HIGH (based on codebase analysis, Anthropic security docs, OpenClaw vulnerability disclosures, and MCP security research)

---

## Critical Pitfalls

Mistakes that cause security breaches, data loss, or fundamental architecture rewrites.

---

### Pitfall 1: Treating Host Mode as "Container Minus Isolation"

**What goes wrong:** Teams implement host mode by simply removing the container spawn and running the same agent logic directly, without recognizing that the entire security model has fundamentally changed. The container provided filesystem isolation, process isolation, non-root execution, and ephemeral environments. Removing it without replacing those guarantees leaves the system wide open.

**Why it happens:** The container-runner.ts currently spawns `container run` with explicit volume mounts. The naive refactor is to replace this with `spawn('node', ['agent-runner/src/index.ts'])` and skip the mount logic. This "works" but now the agent has access to everything the user can access: `~/.ssh`, `~/.aws`, `~/.config`, browser cookies, Keychain, the NanoClaw `.env` file, other groups' data, and the WhatsApp auth state in `store/auth/`.

**Consequences:**
- Any prompt injection via WhatsApp/Slack message gives the attacker full user-level access to the macOS system
- Agent can read/exfiltrate credentials (SSH keys, AWS tokens, NanoClaw's own API keys)
- Agent can modify its own configuration, escalating privileges
- Cross-group data leakage: all groups share the same filesystem, breaking the isolation model
- Scheduled tasks run unattended with full system access and no human oversight

**Warning signs:**
- Host runner implementation does not mention `sandbox-runtime` or `sandbox-exec`
- No filesystem restriction mechanism in the host runner code path
- Agent can successfully `cat ~/.ssh/id_ed25519` or `cat /Users/*/dev/nanoclaw/.env` in host mode
- The `buildVolumeMounts()` function is simply bypassed rather than replaced with equivalent restrictions

**Prevention:**
- Use Anthropic's `@anthropic-ai/sandbox-runtime` for host mode. It uses macOS Seatbelt (`sandbox-exec`) to restrict filesystem and network access at the OS level without containers. This is exactly the tool Anthropic built for this scenario.
- Define a Seatbelt profile that mirrors the container's mount restrictions: only the group folder, global memory (read-only for non-main), IPC directory, and session directory should be accessible.
- Test by attempting to read `~/.ssh/id_ed25519`, `~/.aws/credentials`, and NanoClaw's `.env` from within the host-mode agent. All must fail.

**Phase:** Must be addressed in Phase 1 (host runner implementation). This is not a hardening step -- it is the core implementation requirement.

---

### Pitfall 2: `bypassPermissions` Without Sandbox in Host Mode

**What goes wrong:** NanoClaw's agent-runner currently uses `permissionMode: 'bypassPermissions'` and `allowDangerouslySkipPermissions: true` (container/agent-runner/src/index.ts:285-286). In container mode, this is safe because the container itself is the security boundary. In host mode, these flags give the agent unrestricted autonomous execution of any command, any file write, any tool call -- with no human approval.

**Why it happens:** The developer copies the agent invocation config from the container runner without adjusting permission settings for the different trust boundary. The flags are deeply buried in the SDK options and their security implications are non-obvious.

**Consequences:**
- Combined with `allowedTools: ['Bash', ...]`, the agent can execute arbitrary shell commands on the host with the user's full privileges
- There is a documented bug where `allowedTools` restrictions are not enforced when `bypassPermissions` is active (see anthropics/claude-agent-sdk-typescript#115)
- If `allowUnsandboxedCommands` is also enabled, the agent can silently escape any sandbox that is configured
- This is the "lethal trifecta" described by Simon Willison: access to private data + ability to be influenced by untrusted content + ability to take real-world actions

**Warning signs:**
- `permissionMode: 'bypassPermissions'` appears in host-mode code path without an accompanying sandbox configuration
- `dangerouslyDisableSandbox` is used or can be triggered
- No `canUseTool` handler is implemented to validate tool requests in host mode

**Prevention:**
- For host mode, either: (a) use `sandbox-runtime` as the security boundary and keep `bypassPermissions` (agent is sandboxed by the OS), or (b) switch to a permission mode that requires approval for dangerous operations
- If using sandbox-runtime, explicitly set `allowUnsandboxedCommands: false` (or omit it) so the agent cannot escape the sandbox
- Implement a `canUseTool` handler that blocks or logs dangerous tool patterns even in bypass mode
- Add a startup assertion: if `mode === 'host'` and `bypassPermissions` is true, verify that sandbox-runtime is active before allowing agent execution

**Phase:** Must be addressed in Phase 1, same implementation as the host runner. These settings cannot be deferred.

---

### Pitfall 3: Remote Trigger + Host Execution = Remote Code Execution

**What goes wrong:** NanoClaw agents are triggered remotely via WhatsApp messages, Slack messages, and scheduled tasks. In container mode, a malicious message triggers code execution inside an ephemeral container. In host mode, the same malicious message triggers code execution directly on the user's Mac. This converts every WhatsApp/Slack input channel into a remote code execution vector.

**Why it happens:** The threat model changes fundamentally but the input validation doesn't. In container mode, the blast radius of prompt injection is limited to the container's mounted directories. In host mode (without proper sandboxing), the blast radius is the entire system.

**Consequences:**
- An attacker who can send a WhatsApp message to a registered group can potentially execute commands on the user's Mac
- Indirect prompt injection via content the agent reads (web pages, emails, files) can trigger host commands
- Scheduled tasks run unattended -- a compromised task prompt runs code with no human present
- The OpenClaw vulnerability disclosures (CVE-2026-25253 and Tenable's analysis) demonstrate that this exact class of attack is actively exploited in similar systems

**Warning signs:**
- Host mode works without any changes to the input handling in `processGroupMessages()` or the message formatting in `src/index.ts`
- No additional validation layer between message receipt and agent invocation in host mode
- Scheduled tasks use the same code path as interactive messages with no additional restrictions

**Prevention:**
- Mandatory sandbox-runtime for host mode (addresses the blast radius, not the trigger itself)
- Consider requiring confirmation for host-mode execution from non-main groups. Main group (self-chat) is trusted; other groups should have explicit opt-in for host mode
- For scheduled tasks in host mode, add a `hostModeAllowed: boolean` field to the task schema. Default to false. Require explicit opt-in when scheduling tasks that will run in host mode
- Log all host-mode agent invocations with the trigger source (which group, which message, or which task) for forensic analysis
- Consider rate-limiting host-mode invocations per group (e.g., max 10 per hour for non-main groups)

**Phase:** Phase 1 (sandbox implementation) and Phase 2 (input channel hardening). The sandbox addresses the blast radius immediately. Channel-specific controls come in the hardening phase.

---

### Pitfall 4: IPC Protocol Works Too Well Across Modes

**What goes wrong:** The IPC protocol (filesystem JSON in `data/ipc/{group}/`) is designed to work in both container and host modes. In container mode, each group's IPC directory is mounted at `/workspace/ipc` and the agent can only see its own namespace. In host mode, the agent has filesystem access and can potentially read/write other groups' IPC directories, spoofing authorization.

**Why it happens:** IPC authorization in `src/index.ts` (line 412, 428) derives the source group identity from the directory the JSON file was found in (`sourceGroup` from the directory scan). This works when the container confines each agent to its own IPC directory. Without that confinement, an agent running as the host user can write files into any group's IPC directory, impersonating the main group and gaining admin privileges (register groups, schedule tasks for other groups, send messages to any chat).

**Consequences:**
- Non-main group agent writes a file to `data/ipc/main/tasks/` and gains main-group privileges
- Agent registers rogue groups, schedules tasks, or sends messages to arbitrary chats
- The authorization model breaks silently -- the host process has no way to distinguish legitimate from spoofed IPC messages

**Warning signs:**
- IPC watcher code (`startIpcWatcher`) is unchanged between container and host modes
- No per-mode validation of IPC message origin
- Agent can successfully `ls data/ipc/` and see other groups' directories in host mode

**Prevention:**
- If using sandbox-runtime, restrict the agent's filesystem access so it can only write to its own IPC directory (same restriction the container mounts provided)
- Add cryptographic or process-based IPC authentication: include a per-invocation nonce in the `ContainerInput`, require IPC messages to include it, and validate in the watcher
- As defense-in-depth, add a signed token to each IPC message that the host generates and the agent must echo back. This prevents cross-group spoofing even if filesystem restrictions fail.
- Alternatively, switch from filesystem-based IPC to stdio-based IPC in host mode (agent writes to stdout, host reads from child process stdout). This eliminates the filesystem attack surface entirely.

**Phase:** Phase 1 (IPC hardening). Must be solved before host mode ships. The filesystem-based IPC is a load-bearing security assumption that breaks without container isolation.

---

### Pitfall 5: Config File as Attack Surface

**What goes wrong:** The new `nanoclaw.config.jsonc` file is the primary configuration surface that controls execution mode. If the agent (running in host mode with Bash access) can modify this file, it can switch its own execution mode, disable security settings, or reconfigure MCP servers. In container mode, the config file is outside the container. In host mode, it's potentially writable.

**Why it happens:** The config file lives in the project root alongside the code. In host mode, the agent's working directory is the group folder, but with Bash access, the agent can navigate to the project root. The mount-allowlist was deliberately placed outside the project root (`~/.config/nanoclaw/`) precisely to prevent this class of attack -- but the new JSONC config file is inside the project root.

**Consequences:**
- Agent modifies config to switch from container to host mode (or disable sandbox restrictions)
- Agent adds itself as a main-group equivalent
- Agent reconfigures MCP server mode tags to gain access to servers it shouldn't have
- A prompt injection attack that modifies the config persists across agent invocations

**Warning signs:**
- `nanoclaw.config.jsonc` is in the project root and is readable/writable by the agent in host mode
- No integrity check on config file between invocations
- Config changes take effect immediately (hot-reload) without admin approval

**Prevention:**
- Place `nanoclaw.config.jsonc` outside the project root (same pattern as mount-allowlist: `~/.config/nanoclaw/config.jsonc`) OR ensure the sandbox profile blocks writes to the config file
- If the config must be in the project root (for discoverability), make it read-only for non-main groups via sandbox restrictions
- Add a config integrity hash: compute a hash on startup, verify before each agent invocation, and alert if it changes
- Config changes should require a process restart to take effect (no hot-reload of security-critical settings like execution mode)

**Phase:** Phase 1 (config design). The config file location and protection must be decided before implementation begins. Changing it later requires migration.

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or degraded functionality.

---

### Pitfall 6: MCP Server Mode Tags Create Silent Feature Loss

**What goes wrong:** MCP servers in the JSONC config have `"modes": ["host"]` or `"modes": ["host", "container"]` tags. When switching from host to container mode, MCP servers tagged as host-only become unavailable. The agent doesn't know why tools disappeared, and users don't get clear feedback about what they lost.

**Why it happens:** The filtering logic silently drops MCP servers. The agent's `allowedTools` list includes `mcp__servername__*` but the server isn't started, so tools simply don't exist. Claude may try to use a tool that worked yesterday (in host mode) and get an error today (in container mode).

**Prevention:**
- Emit a startup warning listing which MCP servers are unavailable in the current mode and why
- Include mode information in the agent's system prompt so Claude knows which tools are available and which are mode-restricted
- Design the MCP server config schema to require an explicit `modes` field (no default) so every server declaration forces the user to think about mode compatibility
- Log mode-filtered servers at INFO level on every agent invocation, not just startup

**Phase:** Phase 2 (MCP server integration). This is a UX issue, not a security issue. Can follow the core implementation.

---

### Pitfall 7: Host Mode Inherits Too Many Global MCP Servers

**What goes wrong:** The PROJECT.md specifies that host mode should inherit global MCP servers from `~/.claude/settings.json` via `settingSources: ['project', 'user']`. This means every MCP server the user has configured globally becomes available to every NanoClaw group -- including non-main groups triggered by untrusted WhatsApp messages.

**Why it happens:** The intent is reasonable: personal assistant should have access to the user's full tool ecosystem. But the user's global MCP config may include servers with broad capabilities (database access, email, file management, code execution) that the user configured for their own interactive Claude Code sessions, not for remotely-triggered agents.

**Prevention:**
- Only main group agents should inherit global MCP servers. Non-main groups should only get MCP servers explicitly listed in `nanoclaw.config.jsonc`
- Add a `globalMcpInheritance` config option: `"main-only"` (default) or `"all-groups"`
- Document this clearly: "MCP servers from ~/.claude/settings.json are only available to the main group by default. Add servers to nanoclaw.config.jsonc to make them available to other groups."
- Consider a `dangerousMcpServers` concept: MCP servers that have write access to sensitive systems should be explicitly marked and require confirmation for non-main groups

**Phase:** Phase 2 (MCP server integration). Requires clear policy decisions in the config schema design.

---

### Pitfall 8: Agent Working Directory Confusion Between Modes

**What goes wrong:** In container mode, the agent's working directory is `/workspace/group` (a clean, isolated path). In host mode, it's the actual group folder on disk (e.g., `/Users/alvin/dev/nanoclaw/groups/main/`). The agent-runner code, CLAUDE.md references, and any relative paths in agent instructions may break when paths change between modes.

**Why it happens:** The container creates a clean filesystem abstraction. Host mode exposes the real filesystem hierarchy. Paths like `../CLAUDE.md` (used for global memory in container mode) resolve differently in host mode. The `settingSources: ['project']` flag may load different CLAUDE.md files depending on what Claude considers the "project root."

**Prevention:**
- Ensure the host runner sets `cwd` to the group folder (same semantic as container mode)
- Verify that `settingSources: ['project']` correctly loads both the group CLAUDE.md and the global CLAUDE.md when running from the group folder in host mode
- Test that relative paths used by the agent (e.g., `./conversations/`, `../CLAUDE.md`) resolve correctly in both modes
- Add integration tests that run the same prompt in both container and host mode and compare the resulting filesystem operations

**Phase:** Phase 1 (host runner implementation). Path resolution must be correct from the start.

---

### Pitfall 9: Session Isolation Breaks in Host Mode

**What goes wrong:** In container mode, each group's Claude sessions are isolated in `data/sessions/{group}/.claude/` and mounted to `/home/node/.claude/` inside the container. In host mode, the session directory must be set correctly or the agent will use the user's personal Claude session at `~/.claude/`, mixing NanoClaw agent sessions with the user's own Claude Code sessions.

**Why it happens:** Claude Code stores sessions in `$HOME/.claude/` by default. In container mode, the container's HOME is `/home/node/` and the `.claude` directory is a mount from the host. In host mode, the agent process inherits the user's HOME, so sessions go to the wrong location unless explicitly overridden.

**Prevention:**
- Set `HOME` environment variable for the host-mode subprocess to a temporary or per-group directory that contains the correct `.claude/` symlink or copy
- Alternatively, use Claude Agent SDK options to explicitly specify the session storage path if the SDK supports it
- Test: run an agent in host mode, then check where the session file was written. It must be in `data/sessions/{group}/.claude/`, not `~/.claude/`
- Add a startup check in the host runner that verifies `$HOME/.claude` does not point to the user's real Claude config

**Phase:** Phase 1. Session isolation is a correctness requirement, not a hardening step.

---

### Pitfall 10: Credential Exposure Asymmetry Between Modes

**What goes wrong:** In container mode, only specific env vars are exposed (the `allowedVars` filter in container-runner.ts:137-142). In host mode, the subprocess inherits the full process environment unless explicitly filtered. This means `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, database connection strings, and any other env vars in the NanoClaw process are visible to the agent.

**Why it happens:** Node's `child_process.spawn()` inherits the parent's environment by default. The container mode has explicit filtering because Apple Container's `-e` flag handling required it. The host mode doesn't have this forcing function, so developers forget to filter.

**Prevention:**
- Explicitly construct the environment object for the host-mode subprocess, matching the container's `allowedVars` filter
- Use `spawn('node', args, { env: filteredEnv })` instead of inheriting the parent environment
- Add `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` to the blocked list -- the agent should never need these
- Test: run an agent in host mode and have it execute `env | grep SLACK` or `env | grep TOKEN`. Only Claude auth variables should be visible.

**Phase:** Phase 1. Environment filtering is part of the host runner implementation.

---

## Minor Pitfalls

Mistakes that cause annoyance, confusion, or minor issues but are fixable.

---

### Pitfall 11: JSONC Comment-Stripping Edge Cases

**What goes wrong:** JSONC parsing requires stripping comments before JSON.parse(). Naive regex-based comment stripping breaks on edge cases: URLs containing `//` in string values, escaped quotes, multi-line strings. The config file will contain URLs (MCP server endpoints) that look like comments.

**Prevention:**
- Use a proper JSONC parser (e.g., `strip-json-comments` from Sindre Sorhus, already vendored in node_modules for tsconfig.json handling, or `jsonc-parser` from Microsoft)
- Do not write a custom regex-based comment stripper
- Add test cases with URLs in string values, nested comments, and trailing commas

**Phase:** Phase 1 (config loader implementation).

---

### Pitfall 12: Container-Specific Code Paths Left Active in Host Mode

**What goes wrong:** Functions like `ensureContainerSystemRunning()`, `container stop`, and `container ls` in index.ts and group-queue.ts will error or hang when running in host mode if the container runtime isn't installed. The startup sequence currently requires Apple Container to be running.

**Prevention:**
- Gate all container-specific code behind a mode check early in the startup sequence
- In host mode, skip `ensureContainerSystemRunning()` entirely
- The `GroupQueue.shutdown()` method calls `container stop` -- in host mode, it should send SIGTERM to the Node subprocess instead
- Search the codebase for all occurrences of `container ` (the CLI command) and ensure each one is gated on mode

**Phase:** Phase 1. The startup sequence must work in host mode.

---

### Pitfall 13: Log File Paths Assume Container Output Structure

**What goes wrong:** Container logs go to `groups/{folder}/logs/container-{timestamp}.log` and include container-specific information (mount list, container args, container name). In host mode, the same log format doesn't apply -- there's no container name, no mount list, no container args.

**Prevention:**
- Create a mode-aware log format: `container-{timestamp}.log` for container mode, `host-{timestamp}.log` for host mode
- Include the relevant metadata for each mode (subprocess PID, sandbox profile, env vars for host mode; container name, mounts for container mode)
- Keep the log directory the same (`groups/{folder}/logs/`) for consistency

**Phase:** Phase 2 (polish). Not blocking, but helps debugging.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Config file design | Config writable by agent in host mode (Pitfall 5) | CRITICAL | Place outside project root or sandbox-protect |
| Host runner implementation | Missing sandbox = full system access (Pitfall 1) | CRITICAL | Use sandbox-runtime from day 1 |
| Host runner implementation | bypassPermissions without sandbox (Pitfall 2) | CRITICAL | Enforce sandbox-active assertion |
| Host runner implementation | IPC spoofing across groups (Pitfall 4) | CRITICAL | Sandbox filesystem or add IPC auth |
| Host runner implementation | Session directory wrong (Pitfall 9) | HIGH | Override HOME for subprocess |
| Host runner implementation | Environment leaks (Pitfall 10) | HIGH | Explicit env construction |
| MCP server integration | Silent tool loss on mode switch (Pitfall 6) | MEDIUM | Startup warnings and prompt context |
| MCP server integration | Global MCP inheritance too broad (Pitfall 7) | MEDIUM | Main-only default |
| Input channel hardening | Remote trigger = RCE (Pitfall 3) | CRITICAL | Sandbox + per-group opt-in |
| Testing / validation | Path differences between modes (Pitfall 8) | MEDIUM | Integration tests in both modes |

## Domain-Specific Context

### Why NanoClaw's Threat Model Is Unusual

Most host-native execution discussions assume the user is the one triggering the agent (e.g., developer using Claude Code interactively). NanoClaw is different: agents are triggered remotely by anyone who can send a message to a registered WhatsApp group or Slack channel. This means:

1. **The user is NOT always at the keyboard.** Scheduled tasks and incoming messages trigger agents when the user may be asleep, away, or unaware.
2. **The trigger source is untrusted.** WhatsApp group members may include people the user doesn't fully trust. Slack channels may have broad membership.
3. **The attack surface includes message content.** Every WhatsApp/Slack message is potential prompt injection material that becomes an instruction to an agent with Bash access.

This combination -- remote trigger + unattended execution + shell access + host-native mode -- is precisely the "lethal trifecta" that security researchers warn about. The OpenClaw vulnerability disclosures (CVE-2026-25253, Tenable, Snyk, CrowdStrike reports) demonstrate that attackers actively target this exact class of system.

### The Mount-Allowlist Pattern Already Shows the Way

NanoClaw already has excellent security intuition. The mount-allowlist is stored at `~/.config/nanoclaw/mount-allowlist.json` -- outside the project root, outside any container mount, tamper-proof from agents. This exact pattern should be applied to all security-critical configuration in host mode:
- Execution mode config: outside project root
- Sandbox profiles: outside project root
- IPC authentication tokens: generated per-invocation, not stored on disk

## Sources

**HIGH confidence (official documentation):**
- [Anthropic: Securely Deploying AI Agents](https://platform.claude.com/docs/en/agent-sdk/secure-deployment) -- comprehensive host execution security guide
- [Anthropic: sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) -- macOS Seatbelt-based sandbox for host-mode agents
- [Anthropic: Claude Code Sandboxing Engineering Blog](https://www.anthropic.com/engineering/claude-code-sandboxing) -- sandbox architecture details
- [Claude Code Sandboxing Docs](https://code.claude.com/docs/en/sandboxing) -- sandbox configuration
- [Claude Agent SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions) -- bypassPermissions security implications

**HIGH confidence (vulnerability disclosures for directly related system):**
- [Tenable: OpenClaw/Clawdbot Vulnerabilities](https://www.tenable.com/blog/agentic-ai-security-how-to-mitigate-clawdbot-moltbot-openclaw-vulnerabilities) -- vulnerabilities in NanoClaw's predecessor
- [Snyk: Clawdbot Shell Access Risk](https://snyk.io/articles/clawdbot-ai-assistant/) -- prompt injection to shell access chain
- [CrowdStrike: OpenClaw Security Analysis](https://www.crowdstrike.com/en-us/blog/what-security-teams-need-to-know-about-openclaw-ai-super-agent/) -- enterprise security perspective
- [SecurityWeek: OpenClaw Hijack Vulnerability](https://www.securityweek.com/vulnerability-allows-hackers-to-hijack-openclaw-ai-assistant/amp/)
- [Cisco: Personal AI Agents Security Nightmare](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare)

**MEDIUM confidence (security research and best practices):**
- [OWASP AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [NVIDIA: Sandboxing Agentic Workflows](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk) -- hooks/MCP initialization escape risk
- [MCP Security Best Practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices) -- official MCP security spec
- [Simon Willison: The Lethal Trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) -- framework for understanding agent security risks
- [Claude Agent SDK allowedTools bypass bug](https://github.com/anthropics/claude-agent-sdk-typescript/issues/115) -- known issue with tool restrictions in bypassPermissions mode
- [Missing warning for dangerouslyDisableSandbox + bypassPermissions](https://github.com/anthropics/claude-code/issues/17838) -- documented dangerous interaction

**LOW confidence (general ecosystem):**
- [Adversa AI: OpenClaw Security 101](https://adversa.ai/blog/openclaw-security-101-vulnerabilities-hardening-2026/) -- general hardening guidance
- [Kaspersky: Agentic AI Risks 2026](https://www.kaspersky.com/blog/top-agentic-ai-risks-2026/55184/) -- industry risk landscape

---

*Pitfalls research: 2026-02-07*
