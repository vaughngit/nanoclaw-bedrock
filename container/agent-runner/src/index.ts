/**
 * NanoClaw Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 */

import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput } from '@anthropic-ai/claude-agent-sdk';
import { createIpcMcp } from './ipc-mcp.js';
import { filterMcpServersByMode, NanoClawMcpServer } from './mcp-filter.js';

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function resolvePathVar(envVar: string, defaultPath: string): string {
  const value = process.env[envVar];
  if (!value) return defaultPath;
  if (!path.isAbsolute(value)) {
    log(`Warning: ${envVar}="${value}" is not absolute, using default: ${defaultPath}`);
    return defaultPath;
  }
  return value;
}

const GROUP_DIR = resolvePathVar('NANOCLAW_GROUP_DIR', '/workspace/group');
const GLOBAL_DIR = resolvePathVar('NANOCLAW_GLOBAL_DIR', '/workspace/global');
const IPC_DIR = resolvePathVar('NANOCLAW_IPC_DIR', '/workspace/ipc');
const NANOCLAW_MODE = process.env.NANOCLAW_MODE || 'container';

if (NANOCLAW_MODE !== 'container') {
  log(`Mode: ${NANOCLAW_MODE}`);
  log(`Group dir: ${GROUP_DIR}`);
  log(`Global dir: ${GLOBAL_DIR}`);
  log(`IPC dir: ${IPC_DIR}`);
}

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  security?: {
    sandbox: boolean;
    tools?: string[];
  };
  mcpServers?: Record<string, NanoClawMcpServer>;
}

interface AgentResponse {
  outputType: 'message' | 'log';
  userMessage?: string;
  internalLog?: string;
}

const AGENT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    outputType: {
      type: 'string',
      enum: ['message', 'log'],
      description: '"message": the userMessage field contains a message to send to the user or group. "log": the output will not be sent to the user or group.',
    },
    userMessage: {
      type: 'string',
      description: 'A message to send to the user or group. Include when outputType is "message".',
    },
    internalLog: {
      type: 'string',
      description: 'Information that will be logged internally but not sent to the user or group.',
    },
  },
  required: ['outputType'],
} as const;

interface ContainerOutput {
  status: 'success' | 'error';
  result: AgentResponse | null;
  newSessionId?: string;
  error?: string;
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  // sessions-index.json is in the same directory as the transcript
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

/**
 * Archive the full transcript to conversations/ before compaction.
 */
function createPreCompactHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = path.join(GROUP_DIR, 'conversations');
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, summary);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {};
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
    }
  }

  return messages;
}

function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : (process.env.ASSISTANT_NAME || 'Andy');
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

function createPermissionDenialHook(): HookCallback {
  return async (_input, _toolUseId, _context) => {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        additionalContext: 'If any tool use is denied due to permissions or sandbox restrictions, use the mcp__nanoclaw__send_message tool to explain to the group what you cannot do and why. Suggest they contact the admin group for assistance. Do not silently fail.',
      }
    };
  };
}

async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    const stdinData = await readStdin();
    input = JSON.parse(stdinData);
    log(`Received input for group: ${input.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  const ipcMcp = createIpcMcp({
    chatJid: input.chatJid,
    groupFolder: input.groupFolder,
    isMain: input.isMain,
    ipcDir: IPC_DIR,
  });

  let result: AgentResponse | null = null;
  let newSessionId: string | undefined;

  // Add context for scheduled tasks
  let prompt = input.prompt;
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${input.prompt}`;
  }

  // Load global CLAUDE.md as additional system context (shared across all groups)
  const globalClaudeMdPath = path.join(GLOBAL_DIR, 'CLAUDE.md');
  let globalClaudeMd: string | undefined;
  if (!input.isMain && fs.existsSync(globalClaudeMdPath)) {
    globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
  }

  // Ensure group directory exists (host mode: may not exist on first run)
  fs.mkdirSync(GROUP_DIR, { recursive: true });

  const securityConfig = input.security;
  const isMain = input.isMain;

  if (!isMain && securityConfig) {
    log(`Security config: sandbox=${securityConfig.sandbox}, tools=${securityConfig.tools ? securityConfig.tools.join(',') : 'all'}`);
  }
  if (!isMain) {
    log(`Permission mode: default (non-main group)`);
  }

  // Filter MCP servers by current execution mode
  let configMcpServers: Record<string, any> = {};
  if (input.mcpServers && Object.keys(input.mcpServers).length > 0) {
    const { active, filtered } = filterMcpServersByMode(input.mcpServers, NANOCLAW_MODE);
    configMcpServers = active;

    // Startup logging: show what's active and what's filtered
    const activeNames = Object.keys(active);
    if (activeNames.length > 0) {
      log(`MCP servers active (${NANOCLAW_MODE} mode): ${activeNames.join(', ')}`);
    }
    if (filtered.length > 0) {
      for (const f of filtered) {
        log(`MCP server filtered out: "${f.name}" (modes: [${f.modes.join(', ')}], current: ${NANOCLAW_MODE})`);
      }
    }
  } else {
    log('No additional MCP servers configured');
  }

  // Setting sources: non-main groups use 'project' only to prevent shared ~/.claude permission leaks
  // (settings written by one group's session would leak to others via shared user config)
  const settingSources: ('project' | 'user')[] =
    isMain ? ['project', 'user'] : ['project'];

  // Build tool list for non-main groups
  // NanoClaw MCP tools always included (needed for IPC communication)
  const nonMainTools = securityConfig?.tools
    ? [...securityConfig.tools, 'mcp__nanoclaw__*']
    : [
        'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
        'WebSearch', 'WebFetch',
        'mcp__nanoclaw__*'
      ];

  const queryOptions = {
    cwd: GROUP_DIR,
    systemPrompt: globalClaudeMd
      ? { type: 'preset' as const, preset: 'claude_code' as const, append: globalClaudeMd }
      : undefined,

    // TOOLS: main gets all tools (no `tools` or `allowedTools` needed -- bypassPermissions
    // already auto-approves everything, and omitting `tools` means full SDK default tool set).
    // Non-main gets `tools` (positive allowlist) restricting which tools are AVAILABLE.
    ...(!isMain
      ? { tools: nonMainTools }
      : {}),

    // PERMISSION MODE: main bypasses all, non-main uses default (prompts for destructive ops)
    permissionMode: isMain ? 'bypassPermissions' as const : 'default' as const,
    allowDangerouslySkipPermissions: isMain,

    // SANDBOX: main exempt, non-main sandboxed when configured
    // sandbox only affects Bash tool (wraps in macOS Seatbelt)
    // allowUnsandboxedCommands: false prevents model from escaping with dangerouslyDisableSandbox
    ...(!isMain && NANOCLAW_MODE === 'host' && securityConfig?.sandbox !== false
      ? {
          sandbox: {
            enabled: true,
            autoAllowBashIfSandboxed: true,
            allowUnsandboxedCommands: false,
          },
        }
      : {}),

    settingSources,
    mcpServers: {
      nanoclaw: ipcMcp,          // Always injected (IPC communication)
      ...configMcpServers,       // Config servers (pre-filtered by mode)
    },
    hooks: {
      PreCompact: [{ hooks: [createPreCompactHook()] }],
      // Non-main groups get a PreToolUse hook that instructs the model
      // to explain permission denials to the group chat
      ...(!isMain ? {
        PreToolUse: [{ hooks: [createPermissionDenialHook()] }],
      } : {}),
    },
    outputFormat: {
      type: 'json_schema' as const,
      schema: AGENT_RESPONSE_SCHEMA,
    }
  };

  async function runQuery(sessionId: string | undefined): Promise<void> {
    log('Starting agent...');
    if (sessionId) log(`Resuming session: ${sessionId}`);

    for await (const message of query({
      prompt,
      options: { ...queryOptions, resume: sessionId }
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        newSessionId = message.session_id;
        log(`Session initialized: ${newSessionId}`);
      }

      if (message.type === 'result') {
        if (message.subtype === 'success' && message.structured_output) {
          result = message.structured_output as AgentResponse;
          if (result.outputType === 'message' && !result.userMessage) {
            log('Warning: outputType is "message" but userMessage is missing, treating as "log"');
            result = { outputType: 'log', internalLog: result.internalLog };
          }
          log(`Agent result: outputType=${result.outputType}${result.internalLog ? `, log=${result.internalLog}` : ''}`);
        } else if (message.subtype === 'success' || message.subtype === 'error_max_structured_output_retries') {
          // Structured output missing or agent couldn't produce valid structured output — fall back to text
          log(`Structured output unavailable (subtype=${message.subtype}), falling back to text`);
          const textResult = 'result' in message ? (message as { result?: string }).result : null;
          if (textResult) {
            result = { outputType: 'message', userMessage: textResult };
          }
        }
      }
    }
  }

  try {
    await runQuery(input.sessionId);

    log('Agent completed successfully');
    writeOutput({
      status: 'success',
      result: result ?? { outputType: 'log' },
      newSessionId
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // If resume failed, retry without session (handles cross-mode session incompatibility)
    if (input.sessionId) {
      log(`Agent failed with session resume, retrying without session: ${errorMessage}`);
      try {
        await runQuery(undefined);

        log('Agent completed successfully (after session retry)');
        writeOutput({
          status: 'success',
          result: result ?? { outputType: 'log' },
          newSessionId
        });
        return;
      } catch (retryErr) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        log(`Agent error (retry): ${retryMessage}`);
        writeOutput({
          status: 'error',
          result: null,
          newSessionId,
          error: retryMessage
        });
        process.exit(1);
      }
    }

    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
