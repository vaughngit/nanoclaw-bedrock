# Testing Patterns

**Analysis Date:** 2026-02-07

## Test Framework Status

**No formal test framework present.** The codebase has no Jest, Vitest, Mocha, or other testing infrastructure configured.

**Current State:**
- No `.test.ts` or `.spec.ts` files in `src/` directory
- No test configuration files (`jest.config.js`, `vitest.config.js`, etc.)
- No testing dependencies in `package.json`
- No test scripts in `package.json` (`npm run test`, `npm run test:watch`, etc.)

**Available Commands:**
```bash
npm run build          # Compile TypeScript to dist/
npm run typecheck      # Run tsc --noEmit for type checking
npm run format         # Format code with prettier
npm run format:check   # Check format compliance
npm run dev            # Run with hot reload (tsx)
npm run start          # Run compiled dist/
```

## Implicit Testing Patterns (Code Structure)

While no formal tests exist, the codebase demonstrates testable design patterns:

### Dependency Injection Pattern

**Module:** `src/task-scheduler.ts`

```typescript
export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (groupJid: string, proc: ChildProcess, containerName: string) => void;
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  // Uses injected dependencies
  const groups = deps.registeredGroups();
  const output = await runContainerAgent(
    group,
    { ... },
    (proc, containerName) => deps.onProcess(task.chat_jid, proc, containerName),
  );
}

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  // All dependencies passed in
}
```

**Benefit:** Functions accept all dependencies as parameters, making them mockable for testing.

### Pure Functions

**Module:** `src/container-runner.ts`

```typescript
function getHomeDir(): string {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    throw new Error('Unable to determine home directory...');
  }
  return home;
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const homeDir = getHomeDir();
  const projectRoot = process.cwd();
  // ...
  return mounts;
}
```

**Benefit:** Functions have clear inputs and outputs; side effects are isolated.

### Isolated State Validation

**Module:** `src/mount-security.ts`

```typescript
export function loadMountAllowlist(): MountAllowlist | null {
  if (cachedAllowlist !== null) {
    return cachedAllowlist;
  }

  if (allowlistLoadError !== null) {
    return null;
  }

  try {
    if (!fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
      allowlistLoadError = `Mount allowlist not found at ${MOUNT_ALLOWLIST_PATH}`;
      logger.warn({ path: MOUNT_ALLOWLIST_PATH }, '...');
      return null;
    }

    const content = fs.readFileSync(MOUNT_ALLOWLIST_PATH, 'utf-8');
    const allowlist = JSON.parse(content) as MountAllowlist;

    // Validate structure
    if (!Array.isArray(allowlist.allowedRoots)) {
      throw new Error('allowedRoots must be an array');
    }
    // ...validation continues
  } catch (err) {
    allowlistLoadError = `Failed to load mount allowlist: ${String(err)}`;
    logger.error({ err }, 'Failed to load mount allowlist');
    return null;
  }

  cachedAllowlist = allowlist;
  allowlistLoadError = null;
  return cachedAllowlist;
}
```

**Testable Properties:**
- Validation logic can be tested with mock JSON files
- Error cases (missing file, invalid JSON, missing fields) have clear paths
- Return values are deterministic based on inputs

## Coverage Gaps

No automated test coverage is measured. High-risk areas that should be tested:

**High Priority:**
- `src/mount-security.ts` - Security-critical path validation
  - Risk: Malicious mounts could expose sensitive directories
  - Need: Unit tests for allowed/blocked pattern matching

- `src/group-queue.ts` - Concurrency and state management
  - Risk: Queue deadlock, message loss, task duplication
  - Need: Unit tests for enqueue/dequeue/drain logic

- `src/db.ts` - Database migrations and queries
  - Risk: Data loss, schema corruption, migration failures
  - Need: Integration tests with test database

- `src/index.ts` - WhatsApp message routing and state synchronization
  - Risk: Dropped messages, state inconsistency, LID translation failures
  - Need: Integration tests with mocked WhatsApp connection

**Medium Priority:**
- `src/task-scheduler.ts` - Cron scheduling and task execution
  - Risk: Tasks not running, infinite loops, timezone bugs
  - Need: Unit tests for cron parsing and next-run calculation

- `src/container-runner.ts` - Container lifecycle
  - Risk: Process leaks, hanging containers, mount configuration errors
  - Need: Integration tests with mock container commands

**Low Priority:**
- `src/slack.ts` - Slack message handling
  - Risk: Messages not stored, user resolution failures
  - Need: Unit tests for message parsing and caching

## Manual Testing Approach

Current testing is performed manually via:

```bash
# Development
npm run dev

# Watch for TypeScript errors
npm run typecheck

# Format validation
npm run format:check
```

**Operational Testing:**
- WhatsApp connection via physical device or WhatsApp Web
- Message routing through actual channels
- Container execution via actual Apple Container runtime
- Database state inspection via SQLite CLI

## Recommended Testing Setup (Future)

If testing infrastructure were to be added:

**Framework Choice:** Vitest (faster, ESM-native, less configuration than Jest)

**Structure:**
```
src/
├── index.ts
├── db.ts
├── db.test.ts           # Unit tests
├── group-queue.ts
├── group-queue.test.ts
├── mount-security.ts
├── mount-security.test.ts
└── ...
```

**Example Test Pattern (Not Present):**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadMountAllowlist } from './mount-security';

describe('mount-security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when allowlist file does not exist', () => {
    const result = loadMountAllowlist();
    expect(result).toBeNull();
  });

  it('validates allowedRoots structure', () => {
    // Would require fs mocking
  });
});
```

---

*Testing analysis: 2026-02-07*
