/**
 * Host Runner for NanoClaw
 * Spawns agent execution as a native Node.js subprocess (no container)
 */
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
} from './config.js';
import { config, HostSecurityConfig } from './config-loader.js';
import { ContainerInput, ContainerOutput } from './container-runner.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface HostRunnerSecurityContext {
  hostSecurity?: HostSecurityConfig;
  mainGroupJid?: string;    // For sandbox violation alerts
  mainGroupFolder: string;  // Always 'main'
}

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Environment variables allowed to pass through to the subprocess
const ALLOWED_ENV_VARS = [
  'PATH', 'HOME', 'TERM', 'SHELL', 'USER', 'LANG', 'LC_ALL',
  'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL',
  'CLAUDE_CODE_USE_BEDROCK', 'AWS_REGION', 'AWS_BEDROCK_CROSS_REGION',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'ASSISTANT_NAME',
];

/**
 * Detect sandbox-related errors in agent output.
 * The SDK sandbox uses macOS Seatbelt which produces various error messages.
 * Match broadly to catch different Seatbelt error formats.
 */
function isSandboxViolation(errorText: string): boolean {
  const patterns = [
    'sandbox',
    'seatbelt',
    'operation not permitted',
    'not allowed by sandbox',
    'deny(default)',
  ];
  const lower = errorText.toLowerCase();
  return patterns.some(p => lower.includes(p));
}

/**
 * Send a sandbox violation alert to the main group via IPC.
 * Writes a message file that the IPC poller picks up and delivers via WhatsApp.
 * Also logs to the violating group's log directory for audit.
 */
function sendSandboxAlert(
  groupName: string,
  groupFolder: string,
  errorText: string,
  securityCtx: HostRunnerSecurityContext,
): void {
  // Log to group's log directory for audit trail
  const logsDir = path.join(GROUPS_DIR, groupFolder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const auditFile = path.join(
    logsDir,
    `sandbox-violation-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
  );
  fs.writeFileSync(auditFile, [
    `=== Sandbox Violation ===`,
    `Timestamp: ${new Date().toISOString()}`,
    `Group: ${groupName} (${groupFolder})`,
    `Error: ${errorText}`,
  ].join('\n'));

  // Send WhatsApp alert to main group if we have the JID
  if (securityCtx.mainGroupJid) {
    const mainIpcMessages = path.join(
      DATA_DIR, 'ipc', securityCtx.mainGroupFolder, 'messages',
    );
    fs.mkdirSync(mainIpcMessages, { recursive: true });

    const alertFilename = `${Date.now()}-sandbox-alert.json`;
    const alertData = {
      type: 'message',
      chatJid: securityCtx.mainGroupJid,
      text: `[SANDBOX ALERT] Agent in "${groupName}" hit a restriction:\n${errorText.slice(0, 300)}`,
      groupFolder: securityCtx.mainGroupFolder,
      timestamp: new Date().toISOString(),
    };

    // Atomic write: write to temp then rename
    const tempPath = path.join(mainIpcMessages, `${alertFilename}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(alertData, null, 2));
    fs.renameSync(tempPath, path.join(mainIpcMessages, alertFilename));

    logger.warn(
      { group: groupName, alertFile: alertFilename },
      'Sandbox violation alert sent to main group',
    );
  } else {
    logger.warn(
      { group: groupName },
      'Sandbox violation detected but no main group JID available for alert',
    );
  }
}

export async function runHostAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: null) => void,
  securityCtx?: HostRunnerSecurityContext,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  // Resolve agent-runner path
  const agentRunnerPath = path.resolve(process.cwd(), 'container/agent-runner/dist/index.js');
  if (!fs.existsSync(agentRunnerPath)) {
    logger.error(
      { path: agentRunnerPath },
      'Agent runner not found. Run `npm run build:agent` to compile.',
    );
    return {
      status: 'error',
      result: null,
      error: `Agent runner not found at ${agentRunnerPath}. Run \`npm run build:agent\` to compile.`,
    };
  }

  // Ensure group directory exists
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Ensure IPC directory and subdirectories exist
  const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });

  // Global memory directory
  const globalDir = path.join(GROUPS_DIR, 'global');

  // Home directory for CLAUDE_CONFIG_DIR
  const homeDir = process.env.HOME || os.homedir();

  // Build environment: allowlist approach
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_VARS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }

  // NanoClaw-specific env vars
  env.NANOCLAW_MODE = 'host';
  env.NANOCLAW_GROUP_DIR = groupDir;
  env.NANOCLAW_GLOBAL_DIR = globalDir;
  env.NANOCLAW_IPC_DIR = groupIpcDir;
  env.CLAUDE_CONFIG_DIR = path.join(homeDir, '.claude');

  logger.debug(
    {
      group: group.name,
      agentRunnerPath,
      envNanoclaw: {
        NANOCLAW_MODE: env.NANOCLAW_MODE,
        NANOCLAW_GROUP_DIR: env.NANOCLAW_GROUP_DIR,
        NANOCLAW_GLOBAL_DIR: env.NANOCLAW_GLOBAL_DIR,
        NANOCLAW_IPC_DIR: env.NANOCLAW_IPC_DIR,
        CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR,
      },
    },
    'Host agent configuration',
  );

  // Resolve security config for non-main groups
  const isMain = input.isMain;
  if (!isMain && securityCtx?.hostSecurity) {
    input.security = {
      sandbox: securityCtx.hostSecurity.sandbox,
      tools: securityCtx.hostSecurity.tools,
    };
    logger.debug(
      {
        group: group.name,
        sandbox: input.security.sandbox,
        tools: input.security.tools ?? 'all (default)',
      },
      'Host agent security config applied',
    );
  }

  // Pass configured MCP servers (agent-runner will filter by mode and translate to SDK format)
  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    input.mcpServers = config.mcpServers as Record<string, Record<string, unknown>>;
  }

  logger.info(
    {
      group: group.name,
      isMain: input.isMain,
      sandboxed: !isMain && input.security?.sandbox !== false,
      permissionMode: isMain ? 'bypassPermissions' : 'default',
    },
    'Spawning host agent',
  );

  const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const proc = spawn('node', [agentRunnerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      cwd: groupDir,
    });

    logger.info(
      { group: group.name, pid: proc.pid },
      'Host agent process started',
    );

    onProcess(proc, null);

    let stdout = '';
    let stderr = '';

    // Send input via stdin
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();

    // Collect stdout without size limits (host mode: higher trust)
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Log stderr lines and collect
    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ host: group.folder }, line);
      }
      stderr += chunk;
    });

    let timedOut = false;
    const timeoutMs = group.containerConfig?.timeout || CONTAINER_TIMEOUT;

    const timeout = setTimeout(() => {
      timedOut = true;
      logger.error(
        { group: group.name, pid: proc.pid },
        'Host agent timeout, sending SIGTERM',
      );
      proc.kill('SIGTERM');

      // Grace period: SIGKILL after 5 seconds if still alive
      setTimeout(() => {
        if (!proc.killed && proc.exitCode === null) {
          logger.warn(
            { group: group.name, pid: proc.pid },
            'Host agent did not exit after SIGTERM, sending SIGKILL',
          );
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `host-${ts}.log`);
        fs.writeFileSync(timeoutLog, [
          `=== Host Agent Run Log (TIMEOUT) ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `PID: ${proc.pid}`,
          `Duration: ${duration}ms`,
          `Exit Code: ${code}`,
        ].join('\n'));

        logger.error(
          { group: group.name, pid: proc.pid, duration, code },
          'Host agent timed out',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Host agent timed out after ${timeoutMs}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `host-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Host Agent Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `PID: ${proc.pid}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Environment (NANOCLAW_*) ===`,
          ...Object.entries(env)
            .filter(([k]) => k.startsWith('NANOCLAW_') || k === 'CLAUDE_CONFIG_DIR')
            .map(([k, v]) => `${k}=${v}`),
          ``,
          `=== Stderr ===`,
          stderr,
          ``,
          `=== Stdout ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
        );
      }

      // Detect sandbox violations (both error and success paths)
      if (!input.isMain && securityCtx) {
        const fullError = `${stderr}\n${stdout}`;
        if (isSandboxViolation(fullError)) {
          sendSandboxAlert(group.name, group.folder, stderr.slice(-500), securityCtx);
          logLines.push(``, `=== Sandbox Violation Detected ===`, `Alert sent to main group: ${!!securityCtx.mainGroupJid}`);
        }
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Host agent log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Host agent exited with error',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Host agent exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Host agent completed',
        );

        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse host agent output',
        );

        resolve({
          status: 'error',
          result: null,
          error: `Failed to parse host agent output: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      logger.error(
        { group: group.name, error: err },
        'Host agent spawn error',
      );
      resolve({
        status: 'error',
        result: null,
        error: `Host agent spawn error: ${err.message}`,
      });
    });
  });
}
