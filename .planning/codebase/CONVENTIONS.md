# Coding Conventions

**Analysis Date:** 2026-02-07

## Naming Patterns

**Files:**
- kebab-case for filenames: `container-runner.ts`, `group-queue.ts`, `mount-security.ts`, `task-scheduler.ts`, `whatsapp-auth.ts`
- Descriptive names indicating purpose/responsibility
- No index files; each file exports specific functions/classes directly

**Functions:**
- camelCase: `initDatabase`, `loadState`, `saveState`, `registerGroup`, `syncGroupMetadata`
- Verb-first naming: `load`, `store`, `update`, `get`, `set`, `run`, `start`, `stop`
- Private functions prefixed with `private` keyword in TypeScript classes
- Async functions use `async`/`await` pattern throughout

**Variables:**
- camelCase for all variables: `lastTimestamp`, `messageLoopRunning`, `userNameCache`, `registeredGroups`
- SCREAMING_SNAKE_CASE for constants: `GROUP_SYNC_INTERVAL_MS`, `MAX_CONCURRENT_CONTAINERS`, `TRIGGER_PATTERN`, `CONTAINER_TIMEOUT`
- Descriptive names reflecting purpose: `activeCount`, `pendingMessages`, `gracePeriodMs`, `delayMs`

**Types:**
- PascalCase for interfaces and types: `RegisteredGroup`, `NewMessage`, `ScheduledTask`, `AgentResponse`, `ContainerOutput`
- Descriptive interface names indicating purpose: `SlackConnectOpts`, `SchedulerDependencies`, `VolumeMount`
- Single letter type parameters avoided; use descriptive names instead

## Code Style

**Formatting:**
- Prettier v3.8.1 configured with `singleQuote: true`
- Single quotes for all strings: `'use strict'`, `'utf-8'`, `'pino'`
- Manual formatting consistency across all TypeScript files

**Linting:**
- No ESLint configuration present
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- Consistent indentation (2 spaces observed)

**TypeScript Compilation:**
- Target: ES2022
- Module: NodeNext
- Strict mode enabled with `esModuleInterop: true`
- Source maps generated: `"declaration": true`, `"declarationMap": true`

## Import Organization

**Order:**
1. Node.js built-in modules: `import fs from 'fs'`, `import path from 'path'`
2. Third-party packages: `import Database from 'better-sqlite3'`, `import { App } from '@slack/bolt'`
3. Local modules: `import { config } from './config.js'`

**Path Style:**
- Full relative paths with file extensions: `import { logger } from './logger.js'`
- Explicit `.js` extensions required for ES modules (TypeScript compilation)
- No path aliases configured

**Example Pattern:**
```typescript
// From index.ts
import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  DisconnectReason,
  WASocket,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { CronExpressionParser } from 'cron-parser';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  SLACK_ENABLED,
  STORE_DIR,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
```

## Error Handling

**Patterns:**
- Try-catch blocks for expected failures with logging:
```typescript
// From mount-security.ts
try {
  if (!fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
    allowlistLoadError = `Mount allowlist not found at ${MOUNT_ALLOWLIST_PATH}`;
    logger.warn({ path: MOUNT_ALLOWLIST_PATH }, 'Mount allowlist not found...');
    return null;
  }
} catch {
  /* column already exists */
}
```

- Silent catches with comments for schema migrations:
```typescript
// From db.ts
try {
  db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
} catch {
  /* column already exists */
}
```

- Async error handling with `instanceof Error` type guard:
```typescript
// From task-scheduler.ts
catch (err) {
  error = err instanceof Error ? err.message : String(err);
  logger.error({ taskId: task.id, error }, 'Task failed');
}
```

- Promise rejections logged without rethrowing (graceful degradation):
```typescript
// From index.ts
try {
  await sock.sendPresenceUpdate(isTyping ? 'composing' : 'paused', jid);
} catch (err) {
  logger.debug({ jid, err }, 'Failed to update typing status');
}
```

## Logging

**Framework:** Pino v9.6.0

**Configuration:**
```typescript
// From logger.ts
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});
```

**Patterns:**
- Structured logging with context objects as first parameter:
```typescript
logger.info(
  { groupCount: Object.keys(registeredGroups).length },
  'State loaded',
);
```

- Error logging includes error object:
```typescript
logger.error({ err }, 'Failed to sync group metadata');
```

- Debug logging for detailed operational data:
```typescript
logger.debug({ lastSync }, 'Skipping group sync - synced recently');
```

- Info level for significant events:
```typescript
logger.info({ count: dueTasks.length }, 'Found due tasks');
```

- Warn level for degraded scenarios:
```typescript
logger.warn({ err: err.message }, 'container stop failed');
```

## Comments

**When to Comment:**
- JSDoc comments for exported functions and interfaces:
```typescript
/**
 * Translate a JID from LID format to phone format if we have a mapping.
 * Returns the original JID if no mapping exists.
 */
function translateJid(jid: string): string {
  // ...
}
```

- Inline comments explaining non-obvious logic:
```typescript
// Defense-in-depth: re-sanitize before shell interpolation.
// Primary sanitization is in container-runner.ts when building the name,
// but we sanitize again here since exec() runs through a shell.
const safeName = containerName.replace(/[^a-zA-Z0-9-]/g, '');
```

- Comments explaining workarounds or business logic:
```typescript
// Prevent double-queuing of the same task
if (state.pendingTasks.some((t) => t.id === taskId)) {
```

## Function Design

**Size:** Functions range from 5-30 lines; longer functions break into helper functions.

**Parameters:**
- Single parameter objects preferred for functions with multiple related parameters:
```typescript
export interface SlackConnectOpts {
  registeredGroups: () => Record<string, RegisteredGroup>;
  onMessage: (channelId: string) => void;
}
export async function connectSlack(opts: SlackConnectOpts): Promise<void>
```

- Named destructuring for clarity:
```typescript
app.message(async ({ message }) => {
  const channelId = message.channel;
  const timestamp = new Date(parseFloat(message.ts) * 1000).toISOString();
})
```

**Return Values:**
- Async functions return `Promise<T>` or `Promise<void>`
- Functions that don't throw errors return `null` for missing values:
```typescript
export function loadMountAllowlist(): MountAllowlist | null {
  // ...
  return null;
}
```

- Type-safe returns with union types:
```typescript
export interface ContainerOutput {
  status: 'success' | 'error';
  result: AgentResponse | null;
  newSessionId?: string;
  error?: string;
}
```

## Module Design

**Exports:**
- Named exports for functions and interfaces: `export function initDatabase()`, `export interface RegisteredGroup`
- No default exports; all modules use named imports
- Each module has single responsibility

**Module Boundaries:**
- `config.ts`: Configuration constants and environment variables
- `db.ts`: All SQLite operations and state management
- `types.ts`: Shared interfaces and type definitions
- `logger.ts`: Logging configuration
- `container-runner.ts`: Container lifecycle and execution
- `group-queue.ts`: Message/task queue management
- `task-scheduler.ts`: Scheduled task execution loop
- `index.ts`: WhatsApp connection and message routing
- `slack.ts`: Slack integration
- `mount-security.ts`: Mount validation logic

**No Barrel Files:** Each module imported directly by full path.

---

*Convention analysis: 2026-02-07*
