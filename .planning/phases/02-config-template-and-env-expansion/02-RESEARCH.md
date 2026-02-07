# Phase 2: Config Template and Env Expansion - Research

**Researched:** 2026-02-07
**Domain:** JSONC config template design, environment variable interpolation, Zod schema expansion for future phases
**Confidence:** HIGH

## Summary

This phase has two distinct deliverables: (1) a self-documenting `nanoclaw.config.jsonc` template with inline comments explaining every field across all future phases, and (2) an environment variable expansion system that resolves `${VAR}` and `${VAR:-default}` syntax in config values before Zod validation.

The config template must be forward-looking -- it needs to document fields from Phases 3-8 (MCP servers, security, per-group overrides) even though those Zod schema fields won't be validated until their respective phases. The template serves as the primary user-facing documentation for the entire config surface.

The env expansion is a straightforward string substitution that operates on the parsed JSON object (after `strip-json-comments` and `JSON.parse`, but before Zod validation). A simple recursive walk with a regex replacement covers all requirements without any external dependencies. The `${VAR:-default}` syntax mirrors Docker Compose and bash conventions that users already know.

**Primary recommendation:** Hand-roll the env expansion (15-20 lines of recursive string replacement) rather than adding a dependency. Ship the template with all future fields commented out, using JSONC comments to explain each section. Expand the Zod schema only for fields active in Phase 2 (just `executionMode` for now).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | 4.3.6 | Schema validation (existing) | Already a direct dependency. Schema expands as phases add fields. |
| `strip-json-comments` | 5.0.3 | JSONC parsing (existing) | Already a direct dependency from Phase 1. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs` | built-in | Read/write template file | Template ships as a file in the repo |
| `node:path` | built-in | Resolve paths | Config file location |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled env expansion | `string-env-interpolation` npm package | Tiny package (1 file, ~30 lines), but uses `${VAR:default}` syntax (colon, no dash) instead of the standard `${VAR:-default}` bash syntax. Would add a dependency for something trivially implementable. |
| Hand-rolled env expansion | `dotenv-expand` | Heavyweight (16M weekly downloads but designed for .env files, not JSON config). Doesn't support `${VAR:-default}` syntax. Wrong tool for the job. |
| Hand-rolled env expansion | Pre-parse string replacement on raw text | Would replace `${VAR}` inside JSONC comments too, causing confusing output if comments contain template examples. Must operate on parsed JSON values, not raw text. |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
nanoclaw.config.jsonc          # Template file (ships with repo, user edits)
src/
├── config-loader.ts           # MODIFIED - add expandEnvVars() step between JSON.parse and Zod
└── config.ts                  # UNCHANGED
```

### Pattern 1: Env Expansion Pipeline Position
**What:** Insert env var expansion into the existing load pipeline: read file -> strip comments -> JSON.parse -> **expand env vars** -> Zod validate -> freeze -> export
**When to use:** Always -- this is the core architectural decision
**Why this position:**
- After `strip-json-comments`: Comments are gone, so `${VAR}` references in comments won't be expanded (correct behavior -- comments are documentation, not config)
- After `JSON.parse`: We operate on structured data, not raw strings. This lets us walk only string values, skipping keys and non-string types
- Before Zod: Expanded values are what Zod validates. If `${MY_MODE}` resolves to `"host"`, Zod validates `"host"` against the enum

**Example integration point in existing code:**
```typescript
// In config-loader.ts loadAndValidateConfig(), between JSON.parse and safeParse:

// Parse JSON (existing)
let data: unknown;
try {
  data = JSON.parse(stripped);
} catch (err) { /* existing error handling */ }

// NEW: Expand env vars in all string values
data = expandEnvVars(data);

// Validate with Zod (existing)
const result = NanoClawConfigSchema.safeParse(data);
```

### Pattern 2: Recursive JSON Value Walker
**What:** Recursively walk a parsed JSON value, replacing `${VAR}` and `${VAR:-default}` patterns in all string values
**When to use:** For the env expansion implementation
**Example:**
```typescript
// Source: Custom implementation following bash/Docker Compose conventions

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-((?:[^}\\]|\\.)*))?}/g;

function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_, name: string, fallback?: string) => {
      const envVal = process.env[name];
      if (envVal !== undefined) return envVal;
      if (fallback !== undefined) return fallback;
      return ''; // Unset var with no default -> empty string
    });
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return value; // numbers, booleans, null pass through unchanged
}
```

**Regex breakdown:**
- `\$\{` -- literal `${`
- `([A-Za-z_][A-Za-z0-9_]*)` -- capture group 1: valid env var name (letters, digits, underscores, not starting with digit)
- `(?:` -- optional non-capturing group for default value:
  - `:-` -- literal `:-` (bash convention)
  - `((?:[^}\\]|\\.)*)` -- capture group 2: default value (any char except `}`, or escaped chars)
- `)?` -- end optional group
- `}` -- literal `}`

### Pattern 3: Template with Commented-Out Future Fields
**What:** Ship a JSONC template where only currently-active fields are uncommented; future fields are fully documented in comments
**When to use:** For the config template design
**Why:** The Zod schema uses `z.strictObject()` which rejects unknown keys. If we include future fields (like `mcpServers`) in the template as actual JSON, the current schema will reject them. By commenting them out, users see what's coming but the parser ignores them until the schema grows.

**Example structure:**
```jsonc
{
  // ═══════════════════════════════════════════════════════════════════
  // NanoClaw Configuration
  // ═══════════════════════════════════════════════════════════════════
  //
  // This file controls how NanoClaw runs your Claude agents.
  // Secrets (API keys, tokens) belong in .env, not here.
  //
  // Environment variables: Use ${VAR} or ${VAR:-default} syntax
  // in any string value. Example: "${HOME}/projects"

  // ─── Execution Mode ───────────────────────────────────────────────
  // How agents run. "container" = isolated Linux VM (safe, default).
  // "host" = directly on macOS (full access to dev tools, MCP servers).
  //
  // Trade-off: Container mode is safer but can't access host tools.
  // Host mode gives full macOS access but requires trust in the agent.
  "executionMode": "container",

  // ─── MCP Servers (Phase 6+) ───────────────────────────────────────
  // Configure Model Context Protocol servers available to agents.
  // Each server has a name (key) and connection config (value).
  //
  // Server types:
  //   stdio  - Local process (command + args)
  //   http   - Remote HTTP endpoint
  //   sse    - Remote Server-Sent Events endpoint
  //
  // The "modes" field controls which execution mode can use the server:
  //   ["host"]              - Only in host mode
  //   ["container"]         - Only in container mode
  //   ["host", "container"] - Both modes (default if omitted)
  //
  // "mcpServers": {
  //   "github": {
  //     "command": "npx",
  //     "args": ["-y", "@modelcontextprotocol/server-github"],
  //     "env": {
  //       "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  //     },
  //     "modes": ["host"]
  //   },
  //   "filesystem": {
  //     "command": "npx",
  //     "args": ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}/projects"],
  //     "modes": ["host", "container"]
  //   },
  //   "remote-api": {
  //     "type": "sse",
  //     "url": "https://api.example.com/mcp/sse",
  //     "headers": {
  //       "Authorization": "Bearer ${API_TOKEN}"
  //     },
  //     "modes": ["host"]
  //   }
  // },

  // ... more sections ...
}
```

### Pattern 4: Error Reporting for Unresolved Variables
**What:** After expansion, optionally warn about unresolved env vars (expanded to empty string)
**When to use:** At startup, after expansion but before validation
**Why:** If a user writes `"${MISSING_VAR}"` and the var is not set and has no default, it silently becomes `""`. This can cause confusing Zod validation errors ("expected 'container' | 'host', got ''"). A warning helps debug.

**Example:**
```typescript
// Track unresolved variables during expansion
const unresolvedVars: string[] = [];

function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_, name: string, fallback?: string) => {
      const envVal = process.env[name];
      if (envVal !== undefined) return envVal;
      if (fallback !== undefined) return fallback;
      unresolvedVars.push(name);
      return '';
    });
  }
  // ... recursive walk ...
}

// After expansion, before validation:
if (unresolvedVars.length > 0) {
  process.stderr.write(
    `[config] Warning: unresolved env vars: ${unresolvedVars.join(', ')}\n`
  );
}
```

### Anti-Patterns to Avoid
- **Expanding env vars in the raw JSONC text (before comment stripping):** Would replace `${VAR}` in comments, corrupting documentation examples. Also breaks position tracking for JSON parse errors.
- **Adding all future fields to the Zod schema now:** The schema uses `z.strictObject()`. Adding fields that aren't implemented yet creates dead validation code. Schema should grow with each phase.
- **Using `z.preprocess()` for env expansion:** Zod 4's `z.preprocess()` runs per-field, not globally. We need a single recursive walk before ANY validation starts. A standalone function is simpler and more debuggable.
- **Treating empty string as "unset" for env vars:** In bash, `${VAR:-default}` uses the default when VAR is empty OR unset. But `${VAR-default}` only uses the default when unset. We should match bash behavior exactly for `:-` (empty OR unset triggers default). This is what users expect.
- **Supporting `$VAR` (unbrace) syntax in JSON values:** Only support `${VAR}` (braced) syntax. Unbraced `$VAR` is ambiguous in JSON strings and could match unintended patterns. Docker Compose and `.mcp.json` both use braced syntax exclusively.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONC parsing | Custom comment stripping | `strip-json-comments` (existing) | Already in place from Phase 1 |
| Schema validation | Manual field checking | Zod 4 (existing) | Already in place from Phase 1 |
| Env var name validation | Custom regex from scratch | Standard POSIX pattern: `[A-Za-z_][A-Za-z0-9_]*` | Well-established convention matching bash, Docker, POSIX |

**What TO hand-roll (and why):**

| Problem | Build Custom | Why Not a Library |
|---------|-------------|-------------------|
| `${VAR:-default}` expansion | 15-20 line recursive function | No npm package supports the exact `${VAR:-default}` bash syntax on arbitrary JSON values. `string-env-interpolation` uses `${VAR:default}` (no dash). `dotenv-expand` is for .env files. The implementation is trivial and has zero edge cases when operating on already-parsed JSON string values. |

**Key insight:** The env expansion function is genuinely simple because it operates on parsed JSON -- every value is already a known type (string, number, boolean, null, array, object). There are no escaping issues, no multiline concerns, no quote handling. The regex runs only on string values. This is one of those rare cases where hand-rolling is the right choice.

## Common Pitfalls

### Pitfall 1: Expanding Env Vars Before Comment Stripping
**What goes wrong:** The template contains documentation examples like `// Use ${HOME}/projects as the path`. If env expansion runs on the raw file, these get replaced, corrupting the comments.
**Why it happens:** Tempting to do text-level replacement for simplicity.
**How to avoid:** Expansion MUST happen after `strip-json-comments` + `JSON.parse`. The pipeline is: raw text -> strip comments -> parse JSON -> expand env vars -> validate.
**Warning signs:** Comments in the config file show resolved env values instead of template syntax.

### Pitfall 2: Empty String vs. Undefined for Unset Vars
**What goes wrong:** User writes `"executionMode": "${MY_MODE}"` but `MY_MODE` is not set. Expansion produces `""`, which Zod rejects as invalid enum value. Error message says "expected 'container' | 'host', got ''" -- confusing because the user doesn't see why it's empty.
**Why it happens:** Standard behavior is to replace unset vars with empty string.
**How to avoid:** Log a warning listing unresolved env vars before validation. The Zod error message then makes sense in context: "Warning: unresolved env vars: MY_MODE" followed by the validation error.
**Warning signs:** Zod errors about empty strings when the user expected a value.

### Pitfall 3: Strict Object Rejection of Template Fields
**What goes wrong:** The template includes `mcpServers` as an actual JSON field (not commented out). `z.strictObject()` rejects it as an unknown key. Users can't even have the template active.
**Why it happens:** The Phase 2 schema only knows about `executionMode`. Future fields aren't in the schema yet.
**How to avoid:** All future fields in the template MUST be commented out (using JSONC `//` comments). Only fields in the current Zod schema should be uncommented. As each phase adds fields to the schema, those fields can be uncommented in the template.
**Warning signs:** "Unknown fields: mcpServers" error on startup with the template.

### Pitfall 4: Recursive Expansion (Variable Referencing Another Variable)
**What goes wrong:** User writes `${${PREFIX}_KEY}` expecting nested expansion.
**Why it happens:** Some expansion systems support recursive/nested expansion.
**How to avoid:** Don't support nested expansion. The regex matches `${LITERAL_NAME}` only. This is intentional -- nested expansion is a security concern and adds complexity for no practical benefit in a config file. Document this limitation.
**Warning signs:** Users expecting bash-style nested parameter expansion.

### Pitfall 5: Env Vars in Non-String JSON Values
**What goes wrong:** User writes `"timeout": ${TIMEOUT}` (without quotes), expecting a number.
**Why it happens:** Env var references only work in JSON string values. Without quotes, `${TIMEOUT}` is not valid JSON.
**How to avoid:** Document that env vars only work in string values. For numeric fields, the Zod schema can use `z.coerce.number()` to accept string inputs like `"300000"` from env expansion and coerce them to numbers. But this is a future consideration -- Phase 2 only has `executionMode` (an enum string).
**Warning signs:** JSON parse errors when users try to use env vars in numeric fields without quotes.

### Pitfall 6: Security -- Accidentally Exposing Secrets in Error Messages
**What goes wrong:** Env expansion resolves `${API_TOKEN}` to the actual token value, and then a Zod validation error includes that value in the error message.
**Why it happens:** Zod error messages include "got [value]" which could contain the expanded secret.
**How to avoid:** The current error formatter in `config-loader.ts` already controls what's printed. For `invalid_value` errors, it shows the valid options, not the received value. For `invalid_type`, it shows expected type only. This is already safe by design. But keep this in mind when adding new error formatters.
**Warning signs:** API keys or tokens appearing in startup error output.

## Code Examples

Verified patterns from the existing codebase and standard conventions:

### Complete Env Expansion Function
```typescript
// Source: Custom implementation following bash ${VAR:-default} convention
// and Docker Compose variable substitution syntax.
// Reference: https://docs.docker.com/compose/environment-variables/env-file/

/**
 * Regex for ${VAR} and ${VAR:-default} patterns.
 * Matches valid POSIX env var names: letters, digits, underscores, not starting with digit.
 * The `:- ` delimiter and default value are optional.
 */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?}/g;

/**
 * Recursively expand environment variable references in all string values
 * within a parsed JSON structure.
 *
 * - ${VAR} expands to the value of env var VAR, or empty string if unset
 * - ${VAR:-default} expands to VAR if set and non-empty, else "default"
 * - Non-string values (numbers, booleans, null) pass through unchanged
 * - Object keys are NOT expanded (only values)
 */
function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_match, name: string, fallback?: string) => {
      const envVal = process.env[name];
      // ${VAR:-default}: use default when var is unset OR empty (bash convention)
      if (envVal !== undefined && envVal !== '') return envVal;
      if (fallback !== undefined) return fallback;
      return '';
    });
  }
  if (Array.isArray(value)) {
    return value.map(expandEnvVars);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = expandEnvVars(v);
    }
    return result;
  }
  return value;
}
```

### Integration Into Existing Config Loader
```typescript
// In config-loader.ts, the new step slots into the existing pipeline:

function loadAndValidateConfig(): NanoClawConfig {
  const configPath = path.join(process.cwd(), CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    process.stderr.write(`[config] No ${CONFIG_FILENAME} found, using defaults\n`);
    return Object.freeze(NanoClawConfigSchema.parse({}));
  }

  // Steps 1-3: Read, strip comments, parse JSON (existing)
  let raw: string;
  // ... existing read code ...
  let stripped = stripJsonComments(raw, { trailingCommas: true });
  let data: unknown = JSON.parse(stripped);

  // Step 4: NEW -- Expand env vars before validation
  data = expandEnvVars(data);

  // Step 5: Validate with Zod (existing)
  const result = NanoClawConfigSchema.safeParse(data);
  // ... existing validation code ...
}
```

### Config Template Structure (Complete)
```jsonc
{
  // ═══════════════════════════════════════════════════════════════════
  //  NanoClaw Configuration
  // ═══════════════════════════════════════════════════════════════════
  //
  //  This file configures how NanoClaw runs your Claude agents.
  //  It uses JSONC format: JSON with comments and trailing commas.
  //
  //  SECRETS: API keys and tokens belong in .env, NOT here.
  //  This file can be committed to git safely.
  //
  //  ENV VARS: Use ${VAR} or ${VAR:-default} in any string value.
  //  Example: "${HOME}/projects" expands to "/Users/you/projects"
  //
  //  EDITING: Uncomment sections as you enable features.
  //  Fields not in the current schema are rejected (catches typos).
  // ═══════════════════════════════════════════════════════════════════

  // ─── Execution Mode ───────────────────────────────────────────────
  //
  // How agents execute. This is the most important setting.
  //
  //   "container" (default)
  //     Agents run in isolated Linux VMs via Apple Container.
  //     + Safe: agents can only see mounted directories
  //     + Bash commands run inside the container, not on your Mac
  //     - Cannot access host dev tools, MCP servers, or native apps
  //
  //   "host"
  //     Agents run directly on macOS as subprocesses.
  //     + Full access to dev tools (git, kubectl, docker, etc.)
  //     + Can use host MCP servers and native apps
  //     + Inherits global MCP servers from ~/.claude/settings.json
  //     - Agent has real macOS access -- requires trust
  //     - Sandbox settings (below) provide safety boundaries
  //
  "executionMode": "container",

  // ─── MCP Servers ──────────────────────────────────────────────────
  //
  // Model Context Protocol servers extend agent capabilities.
  // Configured here so NanoClaw can filter by execution mode.
  //
  // Each server needs:
  //   - A unique name (the key)
  //   - Connection config (command+args for stdio, or url for http/sse)
  //   - Optional "modes" array to restrict to specific execution modes
  //
  // If "modes" is omitted, the server is available in both modes.
  //
  // Environment variables in args and env are expanded at startup:
  //   "${GITHUB_TOKEN}" -> value of GITHUB_TOKEN from .env
  //   "${HOME}/projects" -> /Users/you/projects
  //   "${API_KEY:-sk-placeholder}" -> API_KEY value or "sk-placeholder"
  //
  // UNCOMMENT when ready (requires Phase 6):
  //
  // "mcpServers": {
  //
  //   // ── stdio server (local process) ──
  //   "github": {
  //     "command": "npx",
  //     "args": ["-y", "@modelcontextprotocol/server-github"],
  //     "env": {
  //       "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  //     },
  //     "modes": ["host"]
  //   },
  //
  //   // ── stdio server with path expansion ──
  //   "filesystem": {
  //     "command": "npx",
  //     "args": ["-y", "@modelcontextprotocol/server-filesystem", "${HOME}/projects"],
  //     "modes": ["host", "container"]
  //   },
  //
  //   // ── HTTP/SSE remote server ──
  //   "remote-api": {
  //     "type": "sse",
  //     "url": "https://api.example.com/mcp/sse",
  //     "headers": {
  //       "Authorization": "Bearer ${API_TOKEN}"
  //     },
  //     "modes": ["host"]
  //   }
  //
  // },

  // ─── Host Mode Security ───────────────────────────────────────────
  //
  // When executionMode is "host", these settings control what agents
  // can do. Container mode ignores these (containers have their own
  // isolation).
  //
  // UNCOMMENT when ready (requires Phase 5):
  //
  // "hostSecurity": {
  //
  //   // ── Sandbox ──
  //   // macOS Seatbelt sandbox restricts file and network access.
  //   // The Claude Agent SDK's sandbox option controls this.
  //   //
  //   //   true (default) - Agent runs in sandbox, limited file access
  //   //   false          - No sandbox, full macOS access (dangerous!)
  //   //
  //   "sandbox": true,
  //
  //   // ── Allowed Tools ──
  //   // Which tools the agent can use in host mode.
  //   // Default: full Claude Code tool set.
  //   // Restrict to limit agent capabilities.
  //   //
  //   // "allowedTools": [
  //   //   "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  //   //   "WebSearch", "WebFetch",
  //   //   "mcp__nanoclaw__*"
  //   // ]
  //
  // },

  // ─── Per-Group Overrides ──────────────────────────────────────────
  //
  // Individual groups can override the global executionMode.
  // Configured in the database (registered_groups), not here.
  // Groups without an override inherit the global setting above.
  //
  // See Phase 8 for details. No config fields needed here --
  // per-group overrides use the existing group registration system.

}
```

### Test Cases for Env Expansion
```typescript
// Key test scenarios to verify:

// 1. Simple variable expansion
// Input:  { "path": "${HOME}/projects" }
// Env:    HOME=/Users/alvin
// Output: { "path": "/Users/alvin/projects" }

// 2. Default value when var is unset
// Input:  { "mode": "${MY_MODE:-container}" }
// Env:    MY_MODE is not set
// Output: { "mode": "container" }

// 3. Default value when var is empty
// Input:  { "mode": "${MY_MODE:-container}" }
// Env:    MY_MODE=""
// Output: { "mode": "container" }

// 4. Variable in nested object (MCP server env)
// Input:  { "mcpServers": { "gh": { "env": { "TOKEN": "${GITHUB_TOKEN}" } } } }
// Env:    GITHUB_TOKEN=ghp_abc123
// Output: { "mcpServers": { "gh": { "env": { "TOKEN": "ghp_abc123" } } } }

// 5. Variable in array element (MCP server args)
// Input:  { "args": ["-y", "@mcp/server", "${HOME}/data"] }
// Env:    HOME=/Users/alvin
// Output: { "args": ["-y", "@mcp/server", "/Users/alvin/data"] }

// 6. Multiple variables in one string
// Input:  { "url": "https://${HOST:-localhost}:${PORT:-3000}" }
// Env:    HOST=api.example.com, PORT is not set
// Output: { "url": "https://api.example.com:3000" }

// 7. Non-string values pass through unchanged
// Input:  { "timeout": 300000, "enabled": true, "extra": null }
// Output: { "timeout": 300000, "enabled": true, "extra": null }

// 8. No expansion in object keys
// Input:  { "${KEY}": "value" }
// Output: { "${KEY}": "value" }

// 9. Unset var with no default -> empty string
// Input:  { "token": "${MISSING}" }
// Env:    MISSING is not set
// Output: { "token": "" }

// 10. Default value containing colons (URL)
// Input:  { "url": "${API_URL:-http://localhost:8080/api}" }
// Env:    API_URL is not set
// Output: { "url": "http://localhost:8080/api" }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.env` only for all config | JSONC config + `.env` for secrets | 2024-2025 (Claude Code, VSCode, etc.) | JSONC enables structured config with comments; secrets stay in `.env` |
| `$VAR` (unbraced) in configs | `${VAR}` (braced) in configs | Standard practice | Unambiguous parsing, matches Docker Compose and `.mcp.json` conventions |
| Separate config documentation | Self-documenting config templates | Industry standard | Config file IS the documentation; reduces doc drift |

**Key convention alignment:**
- `${VAR}` and `${VAR:-default}` syntax matches bash, Docker Compose, and GitHub Actions
- The Claude Agent SDK's own `.mcp.json` uses `${VAR}` for env var expansion in server configs
- This ensures NanoClaw's config syntax feels familiar to users

## Open Questions

1. **Should `${VAR:-default}` treat empty string as unset?**
   - Bash: `${VAR:-default}` uses default when empty OR unset. `${VAR-default}` uses default only when unset.
   - Recommendation: Match bash behavior for `:-` (empty OR unset triggers default). Do NOT support `${VAR-default}` (dash without colon) -- it adds complexity for minimal benefit and users rarely need the distinction in config files.
   - Confidence: HIGH -- bash convention is well-established.

2. **Should the template live at project root or in a `templates/` directory?**
   - The Phase 2 success criteria says "A `nanoclaw.config.jsonc` template ships". This is the actual config file at project root, not a separate template file.
   - Recommendation: The file at project root IS the template. It ships with defaults and comments. Users edit it in place. No separate template directory needed.
   - Confidence: HIGH -- this matches how `.env.example` works and how the existing codebase operates.

3. **How to handle the schema growing across phases?**
   - The Zod schema currently only has `executionMode`. Phase 6 adds `mcpServers`. Phase 5 adds `hostSecurity`.
   - Recommendation: Each phase extends the schema as needed. The template comments out future fields. When a phase adds a field to the schema, the corresponding comment block in the template can be uncommented. The `z.strictObject()` approach ensures users can't use fields before they're implemented.
   - Confidence: HIGH -- this was the design from Phase 1 research.

## Sources

### Primary (HIGH confidence)
- `/Users/alvin/dev/nanoclaw/src/config-loader.ts` - Existing config loader (170 lines), pipeline position for env expansion
- `/Users/alvin/dev/nanoclaw/src/config.ts` - Existing env var constants pattern
- `/Users/alvin/dev/nanoclaw/container/agent-runner/src/index.ts` lines 287-289 - MCP server shape in Claude Agent SDK usage
- [Claude Agent SDK MCP docs](https://platform.claude.com/docs/en/agent-sdk/mcp) - MCP server configuration types (stdio: command/args/env, http: type/url/headers, sse: type/url/headers), `${VAR}` expansion in `.mcp.json`
- `/Users/alvin/dev/nanoclaw/.planning/REQUIREMENTS.md` - CFG-04 and CFG-05 requirements
- `/Users/alvin/dev/nanoclaw/.planning/ROADMAP.md` - Full phase structure showing all future config fields
- `/Users/alvin/dev/nanoclaw/node_modules/strip-json-comments/index.d.ts` - API verification
- `/Users/alvin/dev/nanoclaw/node_modules/zod/package.json` - Zod 4.3.6 confirmed

### Secondary (MEDIUM confidence)
- [Docker Compose variable substitution](https://docs.docker.com/compose/environment-variables/env-file/) - `${VAR:-default}` syntax reference
- [dotenvx interpolation docs](https://dotenvx.com/docs/env-file#interpolation) - Confirms `${VAR:-default}` and `${VAR-default}` distinction
- [string-env-interpolation source](https://github.com/kamilkisiela/string-env-interpolation/blob/master/src/index.ts) - Reference implementation for regex-based env expansion (uses `${VAR:default}` syntax without dash)

### Tertiary (LOW confidence)
- None. All findings verified against primary or secondary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies needed. Existing `strip-json-comments` + Zod 4 pipeline extended with a pure function.
- Architecture: HIGH - Pipeline position (after parse, before validate) is the only correct choice, verified against existing `config-loader.ts`. Recursive walk pattern is trivially verifiable.
- Template design: HIGH - MCP server shape verified against official Claude Agent SDK docs. Future field organization follows roadmap phases.
- Pitfalls: HIGH - All pitfalls derived from direct analysis of existing code (`z.strictObject()` rejection behavior) and standard env var expansion semantics.

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (stable -- no external dependencies to go stale)
