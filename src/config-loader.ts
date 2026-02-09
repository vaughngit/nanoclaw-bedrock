import fs from 'node:fs';
import path from 'node:path';
import stripJsonComments from 'strip-json-comments';
import { z } from 'zod';

// NOTE: We intentionally do NOT use the pino logger here. This module runs
// during ES module evaluation (top-level singleton), before pino's async
// worker thread (pino-pretty transport) is ready to receive messages. Any
// logger.info() calls at this stage are silently dropped. We use console.log
// for info messages and console.error (via printConfigError) for errors,
// ensuring config status always appears in startup output.

const CONFIG_FILENAME = 'nanoclaw.config.jsonc';

// Schema: z.strictObject rejects unknown keys (catches typos like "executonMode")

const HostSecuritySchema = z.strictObject({
  /** macOS Seatbelt sandbox for non-main group Bash commands */
  sandbox: z.boolean().default(true),
  /**
   * Positive allowlist of tools for non-main groups.
   * Maps to the SDK's `tools` query option (restricts availability).
   * When undefined: full tool set. When present: must be non-empty (min 1).
   * NOT the same as `allowedTools` (which only controls auto-approval).
   */
  tools: z.array(z.string()).min(1).optional(),
});

const NanoClawConfigSchema = z.strictObject({
  executionMode: z.enum(['container', 'host']).default('container'),
  hostSecurity: HostSecuritySchema.optional(),
});

export type NanoClawConfig = z.output<typeof NanoClawConfigSchema>;
export type HostSecurityConfig = z.output<typeof HostSecuritySchema>;

/**
 * Format Zod validation issues into human-readable lines for error banner.
 */
function formatZodIssues(issues: z.core.$ZodIssue[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const fieldPath =
      issue.path.length > 0 ? issue.path.join('.') : '(root)';

    switch (issue.code) {
      case 'invalid_type':
        lines.push(
          `${fieldPath}: expected ${(issue as z.core.$ZodIssueInvalidType).expected}, got invalid type`,
        );
        break;
      case 'invalid_value':
        lines.push(`${fieldPath}: ${issue.message}`);
        if ('values' in issue && Array.isArray(issue.values)) {
          lines.push(
            `  Valid values: ${(issue.values as string[]).map((v) => `"${v}"`).join(', ')}`,
          );
        }
        break;
      case 'unrecognized_keys':
        lines.push(
          `Unknown fields: ${(issue as z.core.$ZodIssueUnrecognizedKeys).keys.join(', ')}`,
        );
        lines.push('  Hint: Check for typos in field names');
        break;
      default:
        lines.push(`${fieldPath}: ${issue.message}`);
    }
  }
  return lines;
}

/**
 * Wrap a single line of text to fit within a given width.
 */
function wrapLine(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];

  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/**
 * Print a boxed ASCII error banner matching the existing codebase style.
 * Uses 64-char inner width to match ensureContainerSystemRunning pattern.
 */
function printConfigError(title: string, details: string[]): void {
  const innerWidth = 64;
  const border = '═'.repeat(innerWidth);

  console.error(`\n╔${border}╗`);
  console.error(`║  ${'CONFIG ERROR: ' + title}`.padEnd(innerWidth + 1) + '║');
  console.error(`╠${border}╣`);
  console.error(`║${' '.repeat(innerWidth)}║`);
  for (const line of details) {
    const wrapped = wrapLine(line, innerWidth - 4);
    for (const w of wrapped) {
      console.error(`║  ${w}`.padEnd(innerWidth + 1) + '║');
    }
  }
  console.error(`║${' '.repeat(innerWidth)}║`);
  console.error(`╚${border}╝\n`);
}

/**
 * Regex for ${VAR} and ${VAR:-default} patterns.
 * Matches valid POSIX env var names: letters, digits, underscores, not starting with digit.
 * The :- delimiter and default value are optional.
 */
const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?}/g;

/**
 * Track env var references that had no value and no default.
 * Reset at the start of each loadAndValidateConfig() call.
 */
let unresolvedVars: string[] = [];

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
      unresolvedVars.push(name);
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

/**
 * Load and validate nanoclaw.config.jsonc from the project root.
 * Returns a frozen, typed config object.
 *
 * If the config file is absent, returns defaults (executionMode='container').
 * If the config file is invalid, prints a boxed error banner and exits.
 */
function loadAndValidateConfig(): NanoClawConfig {
  unresolvedVars = [];
  const configPath = path.join(process.cwd(), CONFIG_FILENAME);

  // Case 1: No config file -- use all defaults
  if (!fs.existsSync(configPath)) {
    process.stderr.write(`[config] No ${CONFIG_FILENAME} found, using defaults\n`);
    return Object.freeze(NanoClawConfigSchema.parse({}));
  }

  // Case 2: Config file exists -- parse and validate
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (err) {
    printConfigError(`Cannot read ${CONFIG_FILENAME}`, [
      `File exists but is not readable: ${(err as Error).message}`,
    ]);
    process.exit(1);
  }

  // Strip JSONC comments and trailing commas
  let stripped: string;
  try {
    stripped = stripJsonComments(raw, { trailingCommas: true });
  } catch (err) {
    printConfigError(`Cannot parse comments in ${CONFIG_FILENAME}`, [
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
    printConfigError(`Invalid JSON in ${CONFIG_FILENAME}`, [
      syntaxErr.message,
      'Hint: Check for missing commas, unclosed braces, or invalid syntax',
    ]);
    process.exit(1);
  }

  // Expand env vars in all string values
  data = expandEnvVars(data);

  // Warn about unresolved env vars before validation
  if (unresolvedVars.length > 0) {
    process.stderr.write(
      `[config] Warning: unresolved env vars: ${unresolvedVars.join(', ')}\n`,
    );
  }

  // Validate with Zod (collects all errors by default)
  const result = NanoClawConfigSchema.safeParse(data);
  if (!result.success) {
    const errorLines = formatZodIssues(result.error.issues);
    printConfigError(`Invalid config in ${CONFIG_FILENAME}`, errorLines);
    process.exit(1);
  }

  const config = Object.freeze(result.data);
  process.stderr.write(`[config] Config loaded: executionMode=${config.executionMode}${config.hostSecurity ? `, sandbox=${config.hostSecurity.sandbox}` : ''}\n`);
  return config;
}

export const config: NanoClawConfig = loadAndValidateConfig();
