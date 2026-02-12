/**
 * MCP Server Filtering and SDK Translation
 *
 * Filters NanoClaw MCP server configs by execution mode and translates
 * to Claude Agent SDK format. The "nanoclaw" server name is reserved
 * for IPC and is rejected if found in user config.
 *
 * Also provides global MCP server name reading (for logging visibility)
 * and source logging (config vs global server breakdown).
 */

import fs from 'fs';
import path from 'path';
import type {
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';

// Local interface matching Zod output shape from config-loader.ts.
// Duplicated here because agent-runner is a separate build target
// with its own dependencies -- do NOT import from config-loader.ts.
export interface NanoClawMcpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  headers?: Record<string, string>;
  modes: string[];
}

export type SdkMcpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig;

function log(message: string): void {
  console.error(`[mcp-filter] ${message}`);
}

/**
 * Translate a NanoClaw MCP server config to Claude Agent SDK format.
 * Strips NanoClaw-only fields (modes) and produces the SDK union type.
 */
function translateToSdkFormat(server: NanoClawMcpServer): SdkMcpServerConfig {
  if (server.type === 'sse') {
    return { type: 'sse', url: server.url!, headers: server.headers };
  }
  if (server.type === 'http') {
    return { type: 'http', url: server.url!, headers: server.headers };
  }
  // Default: stdio
  return {
    command: server.command!,
    args: server.args,
    env: server.env,
  };
}

/**
 * Filter MCP servers by execution mode and translate to SDK format.
 *
 * - Servers whose `modes` array includes `currentMode` are translated and returned as `active`.
 * - Servers whose `modes` do NOT include `currentMode` are returned as `filtered` (for logging).
 * - The reserved name "nanoclaw" is warned about and skipped entirely.
 *
 * @returns active: SDK-format servers keyed by name; filtered: skipped servers with their modes.
 */
export function filterMcpServersByMode(
  servers: Record<string, NanoClawMcpServer>,
  currentMode: string,
): {
  active: Record<string, SdkMcpServerConfig>;
  filtered: Array<{ name: string; modes: string[] }>;
} {
  const active: Record<string, SdkMcpServerConfig> = {};
  const filtered: Array<{ name: string; modes: string[] }> = [];

  for (const [name, server] of Object.entries(servers)) {
    // Reserved name check: "nanoclaw" is the IPC MCP server injected by agent-runner
    if (name === 'nanoclaw') {
      log(
        'Warning: MCP server name "nanoclaw" is reserved for IPC -- skipping config server',
      );
      continue;
    }

    if (server.modes.includes(currentMode)) {
      active[name] = translateToSdkFormat(server);
    } else {
      filtered.push({ name, modes: server.modes });
    }
  }

  return { active, filtered };
}

/**
 * Read global MCP server names from ~/.claude/settings.json.
 *
 * This is for LOGGING ONLY -- the SDK's settingSources: ['user'] handles
 * actual server loading. We read the file separately to log which servers
 * come from the user's global settings vs the nanoclaw config.
 *
 * Uses CLAUDE_CONFIG_DIR env var (set by host-runner), falling back to ~/.claude.
 * Returns empty array on any error (file not found, parse error, no mcpServers).
 */
export function readGlobalMcpServerNames(): string[] {
  const configDir = process.env.CLAUDE_CONFIG_DIR
    || path.join(process.env.HOME || '', '.claude');
  const settingsPath = path.join(configDir, 'settings.json');

  try {
    if (!fs.existsSync(settingsPath)) return [];
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    return settings.mcpServers ? Object.keys(settings.mcpServers) : [];
  } catch (err) {
    log(`Warning: Failed to parse global settings: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Log MCP server sources in separate sections for startup visibility.
 *
 * Shows config servers (from nanoclaw.config.jsonc), global servers
 * (from ~/.claude/settings.json), and any config servers that override
 * same-named global servers.
 *
 * @param configNames - Server names from nanoclaw.config.jsonc (already filtered by mode)
 * @param globalNames - Server names from ~/.claude/settings.json
 * @param currentMode - Current execution mode (for log context)
 */
export function logMcpServerSources(
  configNames: string[],
  globalNames: string[],
  currentMode: string,
): void {
  // Filter out reserved "nanoclaw" name from global list
  const cleanGlobalNames = globalNames.filter(n => n !== 'nanoclaw');

  // Compute overridden names: global servers shadowed by config servers
  const overriddenNames = cleanGlobalNames.filter(n => configNames.includes(n));

  // Active global names: not overridden by config
  const activeGlobalNames = cleanGlobalNames.filter(n => !configNames.includes(n));

  if (configNames.length === 0 && activeGlobalNames.length === 0 && overriddenNames.length === 0) {
    log('No additional MCP servers configured');
    return;
  }

  log('--- MCP Server Sources ---');

  if (configNames.length > 0) {
    log(`  Config (nanoclaw.config.jsonc): ${configNames.join(', ')}`);
  }

  if (activeGlobalNames.length > 0) {
    log(`  Global (~/.claude/settings.json): ${activeGlobalNames.join(', ')}`);
  }

  if (overriddenNames.length > 0) {
    log(`  Overridden by config: ${overriddenNames.join(', ')}`);
  }
}
