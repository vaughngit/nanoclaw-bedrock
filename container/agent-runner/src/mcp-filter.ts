/**
 * MCP Server Filtering and SDK Translation
 *
 * Filters NanoClaw MCP server configs by execution mode and translates
 * to Claude Agent SDK format. The "nanoclaw" server name is reserved
 * for IPC and is rejected if found in user config.
 */

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
