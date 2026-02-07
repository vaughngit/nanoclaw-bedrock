# Phase 1: Config Loader - Research

**Researched:** 2026-02-07
**Domain:** JSONC parsing, Zod 4 schema validation, TypeScript config singleton
**Confidence:** HIGH

## Summary

This phase creates a config loader that reads `nanoclaw.config.jsonc` from the project root, strips comments/trailing commas, validates with Zod 4, merges defaults, and exports a typed singleton. The codebase already has Zod 4.3.6 installed and `strip-json-comments` 5.0.3 available as a transitive dependency (via pino-pretty). No new dependencies are needed.

The existing `src/config.ts` exports individual constants from env vars. The new config loader will be a separate file (`src/config-loader.ts`) that loads the JSONC file and exports a validated, typed config object. It should not replace `src/config.ts` -- the two coexist until later phases wire config values into the existing constants.

**Primary recommendation:** Use `strip-json-comments` (already in node_modules, ESM, handles both comments and trailing commas) + Zod 4 `z.strictObject()` for validation. Collect all errors (Zod's default behavior) and format them with custom boxed ASCII banners. Export a frozen singleton.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | 4.3.6 | Schema validation + type inference | Already a direct dependency. Zod 4 is the current stable. Provides runtime validation with inferred TypeScript types. |
| `strip-json-comments` | 5.0.3 | JSONC parsing (strip comments + trailing commas) | Already in node_modules (transitive via pino-pretty). ESM-only. Handles `//`, `/* */`, and trailing commas with `{trailingCommas: true}`. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs` | built-in | Read config file from disk | Always -- reading `nanoclaw.config.jsonc` |
| `node:path` | built-in | Resolve project root path | Always -- `path.join(process.cwd(), 'nanoclaw.config.jsonc')` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `strip-json-comments` | `jsonc-parser` (Microsoft) | More robust AST-based parser, handles malformed JSONC better, provides line/column error positions. But NOT in node_modules -- would add a new dep. `strip-json-comments` is sufficient for well-formed JSONC. |
| Custom error formatting | `z.prettifyError()` directly | Built-in `prettifyError` outputs a plain text format. We need a boxed ASCII banner instead, so we must iterate `error.issues` ourselves. |

**Installation:**
```bash
# No installation needed -- both libraries already available
# strip-json-comments: transitive dep via pino-pretty (v5.0.3)
# zod: direct dep (v4.3.6)
```

**IMPORTANT:** `strip-json-comments` is a transitive dependency (not declared in `package.json`). It should be added as a direct dependency to prevent it from disappearing if pino-pretty changes its deps:
```bash
npm install strip-json-comments
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── config.ts           # EXISTING - env var constants (unchanged)
├── config-loader.ts    # NEW - JSONC loader, Zod schema, singleton export
└── index.ts            # MODIFIED - import config-loader first, before anything
```

### Pattern 1: JSONC Parse Pipeline
**What:** Read file -> strip comments -> JSON.parse -> Zod validate -> freeze -> export
**When to use:** Always -- this is the core flow
**Example:**
```typescript
// Source: Verified against strip-json-comments 5.0.3 index.d.ts and Zod 4.3.6 schemas.d.ts
import fs from 'node:fs';
import path from 'node:path';
import stripJsonComments from 'strip-json-comments';
import { z } from 'zod';

const CONFIG_FILENAME = 'nanoclaw.config.jsonc';

function loadRawConfig(): unknown | null {
  const configPath = path.join(process.cwd(), CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return null; // File absent -- use defaults
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  const stripped = stripJsonComments(raw, { trailingCommas: true });
  return JSON.parse(stripped);
}
```

### Pattern 2: Strict Object Schema with Defaults
**What:** Use `z.strictObject()` so unknown keys cause validation errors, with `.default()` on each field
**When to use:** For the top-level config schema
**Example:**
```typescript
// Source: Verified against Zod 4.3.6 v4/classic/schemas.d.ts
const NanoClawConfigSchema = z.strictObject({
  executionMode: z.enum(['container', 'host']).default('container'),
  // Future fields go here
});

type NanoClawConfig = z.output<typeof NanoClawConfigSchema>;
```

**Key Zod 4 behavior verified in source:**
- `z.strictObject(shape)` = creates object with `$strict` config, rejects unknown keys with `unrecognized_keys` issue code
- `z.object(shape)` = creates object with `$strip` config, silently drops unknown keys (NOT what we want)
- `.default()` in Zod 4 short-circuits: if input is `undefined`, returns default without further parsing
- For an absent config file, we pass `{}` to the schema -- each field's `.default()` fills in

### Pattern 3: Singleton Export (Matching Existing Convention)
**What:** Export a const that's computed at module load time
**When to use:** Matches existing `src/config.ts` pattern where values are exported as top-level constants
**Example:**
```typescript
// Computed once at import time, frozen for safety
export const config: NanoClawConfig = loadAndValidateConfig();
```

**Existing convention from `src/config.ts`:**
```typescript
// Current pattern: export individual named constants
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
```

The new config-loader should export a single `config` object (not individual constants) to keep it distinct from the existing `config.ts`.

### Pattern 4: Error Collection + Boxed Banner
**What:** Use `safeParse` to collect all errors, then format as ASCII boxed banner
**When to use:** On validation failure
**Example:**
```typescript
// Source: Verified against Zod 4.3.6 v4/core/errors.d.ts
const result = NanoClawConfigSchema.safeParse(data);
if (!result.success) {
  // result.error.issues is $ZodIssue[] with fields:
  //   .code: 'invalid_type' | 'unrecognized_keys' | 'invalid_value' | ...
  //   .path: PropertyKey[]  (e.g., ['executionMode'])
  //   .message: string
  //   .expected?: string    (for invalid_type)
  //   .keys?: string[]      (for unrecognized_keys)
  printConfigErrors(result.error.issues);
  process.exit(1);
}
```

### Pattern 5: Boxed ASCII Error Banner
**What:** Match the existing `ensureContainerSystemRunning` pattern in `index.ts` lines 943-965
**When to use:** Config validation failure
**Example matching existing style:**
```typescript
// Existing pattern from index.ts:
console.error('\n╔════════════════════════════════════════════════════════════════╗');
console.error('║  FATAL: Apple Container system failed to start                 ║');
console.error('╚════════════════════════════════════════════════════════════════╝\n');

// New config error banner should follow same style:
console.error('\n╔════════════════════════════════════════════════════════════════╗');
console.error('║  CONFIG ERROR: nanoclaw.config.jsonc has problems              ║');
console.error('╠════════════════════════════════════════════════════════════════╣');
console.error('║                                                                ║');
console.error('║  executionMode: expected "container" | "host", got "docker"    ║');
console.error('║    Hint: Did you mean "container"?                             ║');
console.error('║                                                                ║');
console.error('╚════════════════════════════════════════════════════════════════╝\n');
```

### Anti-Patterns to Avoid
- **Lazy loading config:** Config must load synchronously at startup, before any async operations. The existing `main()` flow is sync until `connectWhatsApp()`.
- **Replacing `src/config.ts`:** Phase 1 adds a new file alongside the existing one. Later phases wire values through. Touching `config.ts` now risks breaking everything.
- **Using `z.object()` instead of `z.strictObject()`:** The decision is to reject unknown keys. `z.object()` silently strips them, which would hide typos.
- **Throwing from config loader:** Use `process.exit(1)` after printing the boxed error. Throwing would produce an ugly stack trace instead of the clean banner.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSONC parsing | Custom regex to strip `//` and `/* */` | `strip-json-comments` with `{trailingCommas: true}` | Edge cases: comments inside strings, escaped quotes, nested block comments, trailing commas before `}` and `]` |
| Schema validation | Manual if/else field checking | Zod 4 `z.strictObject()` + `.safeParse()` | Type inference, error collection, structured error objects with codes and paths |
| Type inference from schema | Separate TypeScript interface | `z.output<typeof Schema>` | Single source of truth -- schema IS the type |
| "Did you mean?" suggestions | Custom Levenshtein implementation | Simple string matching against known enum values | For `executionMode` with only 2 values, exact prefix matching is sufficient. No need for fuzzy matching libraries. |

**Key insight:** The validation problem is deceptively simple with only one field (`executionMode`). But the infrastructure must support future phases adding many more fields (MCP servers array, per-group overrides, etc.). Building on Zod now pays off when the schema grows.

## Common Pitfalls

### Pitfall 1: strip-json-comments is ESM-only
**What goes wrong:** Importing `strip-json-comments` with `require()` fails.
**Why it happens:** v5.x is ESM-only (no CJS build).
**How to avoid:** The project already uses `"type": "module"` in package.json and ESM imports everywhere. This is a non-issue, but worth noting.
**Warning signs:** `ERR_REQUIRE_ESM` at startup.

### Pitfall 2: Zod 4 `.default()` short-circuits
**What goes wrong:** If you chain `.default('container').refine(...)`, the refine never runs when the default is applied (because default short-circuits on `undefined`).
**Why it happens:** Zod 4 changed default behavior -- defaults bypass the rest of the parse pipeline.
**How to avoid:** Put refinements/checks on the inner schema, not after `.default()`. Or use `.prefault()` if you need pre-parse defaults that still validate.
**Warning signs:** Custom validations that never trigger on default values.

### Pitfall 3: JSON.parse error positions are wrong after stripping
**What goes wrong:** `JSON.parse` throws with line/column numbers that don't match the original JSONC file (because comments were replaced).
**Why it happens:** `strip-json-comments` replaces comments with whitespace (default `whitespace: true`) to preserve positions. But trailing comma removal can shift positions slightly.
**How to avoid:** Keep `whitespace: true` (default). For JSON parse errors, catch the `SyntaxError` and report it with a hint about checking for JSON syntax issues. The position will be close but not exact when trailing commas were stripped.
**Warning signs:** "Unexpected token at position X" where X doesn't match the source file.

### Pitfall 4: Transitive dependency disappearing
**What goes wrong:** `strip-json-comments` is only in node_modules because `pino-pretty` depends on it. If pino-pretty changes deps, it vanishes.
**Why it happens:** Not declared as a direct dependency in package.json.
**How to avoid:** Add `strip-json-comments` as a direct dependency: `npm install strip-json-comments`.
**Warning signs:** Works in dev, fails after `npm ci` on a different machine.

### Pitfall 5: Frozen config object mutation attempts
**What goes wrong:** Later code tries to modify the config object and gets silent failures (or TypeErrors in strict mode).
**Why it happens:** Config singleton should be immutable after loading.
**How to avoid:** Use `Object.freeze()` on the config. TypeScript `Readonly<>` type ensures compile-time safety, but `Object.freeze` catches runtime mutations too.
**Warning signs:** Config values unexpectedly changing during runtime.

### Pitfall 6: Process.cwd() differs in dev vs production
**What goes wrong:** Config file not found because `process.cwd()` points to a different directory.
**Why it happens:** `npm run dev` runs from project root, but `launchd` might set a different working directory.
**How to avoid:** The existing `src/config.ts` already uses `process.cwd()` for `PROJECT_ROOT`, so this is consistent. The `launchd` plist should set `WorkingDirectory` to the project root (verify in `launchd/` directory).
**Warning signs:** "No nanoclaw.config.jsonc found" in production when the file exists.

## Code Examples

Verified patterns from actual installed packages:

### Complete Config Loader Structure
```typescript
// Source: Verified API from Zod 4.3.6 (node_modules/zod) and
// strip-json-comments 5.0.3 (node_modules/strip-json-comments)
import fs from 'node:fs';
import path from 'node:path';
import stripJsonComments from 'strip-json-comments';
import { z } from 'zod';
import { logger } from './logger.js';

const CONFIG_FILENAME = 'nanoclaw.config.jsonc';

// Schema: z.strictObject rejects unknown keys (verified in schemas.d.ts line 470)
const NanoClawConfigSchema = z.strictObject({
  executionMode: z.enum(['container', 'host']).default('container'),
});

export type NanoClawConfig = z.output<typeof NanoClawConfigSchema>;

function loadAndValidateConfig(): NanoClawConfig {
  const configPath = path.join(process.cwd(), CONFIG_FILENAME);

  // Case 1: No config file -- use all defaults
  if (!fs.existsSync(configPath)) {
    logger.info(`No ${CONFIG_FILENAME} found, using defaults`);
    return Object.freeze(NanoClawConfigSchema.parse({}));
  }

  // Case 2: Config file exists -- parse and validate
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    printFatalError(`Cannot read ${CONFIG_FILENAME}`, [
      `File exists but is not readable: ${(err as Error).message}`,
    ]);
    process.exit(1);
  }

  // Strip comments and trailing commas
  let stripped: string;
  try {
    stripped = stripJsonComments(raw, { trailingCommas: true });
  } catch (err) {
    printFatalError(`Cannot parse comments in ${CONFIG_FILENAME}`, [
      (err as Error).message,
    ]);
    process.exit(1);
  }

  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(stripped);
  } catch (err) {
    const syntaxErr = err as SyntaxError;
    printFatalError(`Invalid JSON in ${CONFIG_FILENAME}`, [
      syntaxErr.message,
      'Hint: Check for missing commas, unclosed braces, or invalid syntax',
    ]);
    process.exit(1);
  }

  // Validate with Zod (collects ALL errors by default)
  const result = NanoClawConfigSchema.safeParse(data);
  if (!result.success) {
    const errorLines = formatZodIssues(result.error.issues);
    printFatalError(`Invalid config in ${CONFIG_FILENAME}`, errorLines);
    process.exit(1);
  }

  const config = Object.freeze(result.data);
  logger.info(
    `Config loaded: executionMode=${config.executionMode}`,
  );
  return config;
}

export const config: NanoClawConfig = loadAndValidateConfig();
```

### Zod Issue Formatting
```typescript
// Source: Verified issue types from Zod 4.3.6 v4/core/errors.d.ts

function formatZodIssues(issues: z.ZodIssue[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const fieldPath = issue.path.length > 0
      ? issue.path.join('.')
      : '(root)';

    switch (issue.code) {
      case 'invalid_type':
        lines.push(`${fieldPath}: expected ${issue.expected}, got invalid type`);
        break;
      case 'invalid_value':
        // For enum validation failures
        lines.push(`${fieldPath}: ${issue.message}`);
        if ('values' in issue && Array.isArray(issue.values)) {
          lines.push(`  Valid values: ${issue.values.map(v => `"${v}"`).join(', ')}`);
        }
        break;
      case 'unrecognized_keys':
        lines.push(`Unknown fields: ${issue.keys.join(', ')}`);
        lines.push(`  Hint: Check for typos in field names`);
        break;
      default:
        lines.push(`${fieldPath}: ${issue.message}`);
    }
  }
  return lines;
}
```

### Boxed ASCII Banner Function
```typescript
// Source: Matches existing pattern in index.ts lines 943-965

function printFatalError(title: string, details: string[]): void {
  const width = 66;
  const border = '═'.repeat(width);
  console.error(`\n╔${border}╗`);
  console.error(`║  ${title.padEnd(width - 2)}║`);
  console.error(`╠${border}╣`);
  for (const line of details) {
    // Word-wrap long lines
    const wrapped = wrapLine(line, width - 4);
    for (const w of wrapped) {
      console.error(`║  ${w.padEnd(width - 2)}║`);
    }
  }
  console.error(`╚${border}╝\n`);
}
```

### Integration Point in index.ts
```typescript
// In src/index.ts main() function, config loads FIRST:
import { config } from './config-loader.js';
// ... (config is already validated by the time this module loads)

async function main(): Promise<void> {
  // Config already loaded via module-level singleton.
  // If config was invalid, process.exit(1) already fired.
  ensureContainerSystemRunning();
  initDatabase();
  // ...
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod 3 `.strict()` method | Zod 4 `z.strictObject()` top-level function | Zod 4.0 (2025) | `.strict()` still works but `z.strictObject()` is preferred |
| Zod 3 `.format()` / `.flatten()` | Zod 4 `z.treeifyError()` / `z.flattenError()` | Zod 4.0 (2025) | Old methods deprecated, new ones are standalone functions |
| Zod 3 `message` / `invalid_type_error` params | Zod 4 unified `error` param | Zod 4.0 (2025) | Single error customization API |
| Zod 3 `.default()` doesn't short-circuit | Zod 4 `.default()` short-circuits on undefined | Zod 4.0 (2025) | Refinements after `.default()` never run on default value |

**Deprecated/outdated:**
- `z.object().strict()`: Still works but documented as "Consider `z.strictObject(A.shape)` instead"
- `z.object().passthrough()`: Deprecated in favor of `z.looseObject()`
- `ZodError.format()`: Deprecated, use `z.treeifyError()`
- `ZodError.flatten()`: Deprecated, use `z.flattenError()`

## Discretion Recommendations

### Error Collection: Collect-All (Zod's default)
**Recommendation:** Collect all errors, do NOT fail-fast.
**Rationale:** Zod 4's default behavior is to collect all issues. This is ideal for config validation -- the user sees ALL problems in one shot rather than fixing one, restarting, finding the next. There is no global `abortEarly` option in Zod 4; the `abort` flag only applies to individual `.refine()` calls. Collecting all errors is both the path of least resistance and the better UX.

### Phase 1 Scope: Load + Validate Only (no runner wiring)
**Recommendation:** Phase 1 should ONLY load, validate, and export the config. Do NOT wire `executionMode` to the container runner.
**Rationale:** The runner wiring is a Phase 3-4 concern. Adding a "not yet implemented" guard for host mode in Phase 1 creates dead code that must be maintained. The config is available via `import { config } from './config-loader.js'` and later phases can use it when they need it. Keep Phase 1 clean and testable.

### Zod Schema Design: Flat with Comments
**Recommendation:** Keep the schema flat for Phase 1 (just `executionMode`). Add JSDoc comments on each field. Later phases will add nested groups (e.g., `mcpServers: z.array(...)`) but Phase 1 doesn't need to pre-build that structure.
**Rationale:** YAGNI. The schema should grow organically as phases add fields. Designing the full schema now creates maintenance burden and speculation about future shapes.

### JSONC Parser: strip-json-comments (add as direct dep)
**Recommendation:** Use `strip-json-comments` but add it as a direct dependency.
**Rationale:** It is already in node_modules (v5.0.3 via pino-pretty), is ESM-native, handles both comments and trailing commas, and has a tiny API surface. Adding it as a direct dep (`npm install strip-json-comments`) prevents breakage if pino-pretty changes its deps. `jsonc-parser` would be overkill -- it provides AST manipulation and error recovery that we don't need.

## Open Questions

1. **`strip-json-comments` version pinning**
   - What we know: v5.0.3 is in node_modules via pino-pretty. Adding as direct dep will install latest v5.x.
   - What's unclear: Whether `npm install strip-json-comments` will install the same version or a newer one.
   - Recommendation: Install it, check version, move on. The API has been stable for years.

2. **Config file permissions on macOS**
   - What we know: `fs.readFileSync` can fail if the file is not readable.
   - What's unclear: Whether macOS file permissions or extended attributes could cause issues with a `.jsonc` file in a git repo.
   - Recommendation: Handle the error gracefully (already covered in code example). This is unlikely to be a real issue.

## Sources

### Primary (HIGH confidence)
- `node_modules/zod/v4/core/errors.d.ts` - ZodIssue types, error formatting functions (treeifyError, prettifyError, flattenError)
- `node_modules/zod/v4/core/schemas.d.ts` - $ZodObjectDef, $strict/$strip/$loose types, strictObject function signature
- `node_modules/zod/v4/classic/schemas.d.ts` lines 469-471 - `object()`, `strictObject()`, `looseObject()` function signatures
- `node_modules/strip-json-comments/index.d.ts` - API: `stripJsonComments(str, {trailingCommas?, whitespace?})`
- `node_modules/strip-json-comments/index.js` - Implementation verified: handles `//`, `/* */`, trailing commas, whitespace preservation
- `src/config.ts` - Existing config pattern (individual constant exports from env vars)
- `src/index.ts` lines 932-968 - Existing boxed ASCII error banner pattern (`ensureContainerSystemRunning`)
- `src/index.ts` lines 990-1023 - Startup sequence (`main()` function)
- `package.json` - Zod 4.3.6, strip-json-comments 5.0.3 (transitive), ESM project

### Secondary (MEDIUM confidence)
- [Zod v4 Migration Guide](https://zod.dev/v4/changelog) - strictObject/looseObject are new, .strict()/.passthrough() deprecated
- [Zod API Reference](https://zod.dev/api) - Schema definitions, default behavior, enum usage
- [Zod Error Formatting](https://zod.dev/error-formatting) - treeifyError, prettifyError, flattenError usage
- [Zod Error Customization](https://zod.dev/error-customization) - Unified `error` param, error map priority
- [strip-json-comments npm](https://www.npmjs.com/package/strip-json-comments) - trailingCommas option, ESM-only
- [Zod Basic Usage](https://zod.dev/basics) - .parse() vs .safeParse(), ZodError.issues structure

### Tertiary (LOW confidence)
- [Zod abort-early discussion](https://github.com/colinhacks/zod/issues/3884) - No global abortEarly; only per-refine `abort` flag

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Libraries verified in actual node_modules, APIs confirmed from .d.ts source files
- Architecture: HIGH - Patterns derived from existing codebase conventions (config.ts, index.ts startup flow, boxed error banner)
- Pitfalls: HIGH - Zod 4 behaviors verified against installed source code (default short-circuit, strictObject, error types)

**Research date:** 2026-02-07
**Valid until:** 2026-03-07 (stable -- Zod 4 and strip-json-comments are mature)
