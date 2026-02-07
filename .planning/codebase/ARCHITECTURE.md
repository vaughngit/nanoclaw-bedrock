# Architecture

**Analysis Date:** 2026-02-07

## Pattern Overview

**Overall:** Event-driven message router with isolated container-based agent execution

**Key Characteristics:**
- Single Node.js process acts as message broker between messaging platforms and isolated agent containers
- Each group/channel runs agents in separate Linux containers with filesystem isolation
- State stored in SQLite database (`store/messages.db`)
- Asynchronous message processing with per-group queuing and concurrency limits
- IPC communication via JSON files for inter-process coordination

## Layers

**Router/Entry Point Layer:**
- Purpose: Connect to messaging platforms (WhatsApp, Slack), receive messages, route to processing pipeline
- Location: `src/index.ts` (main function at line 990+)
- Contains: WhatsApp socket connection, Slack integration, message event handlers
- Depends on: Baileys library (`@whiskeysockets/baileys`), Slack Bolt (`@slack/bolt`), database, queue
- Used by: All other layers depend on this for message input

**Message Processing Layer:**
- Purpose: Extract messages from database, check triggers, prepare prompts, invoke agents
- Location: `src/index.ts` (functions: `processGroupMessages` at line 208, `runAgent` at line 276)
- Contains: Message fetching logic, trigger pattern matching, XML formatting, typing indicators
- Depends on: Database, container runner, group queue
- Used by: Message loop and scheduler

**Container Orchestration Layer:**
- Purpose: Spawn agent processes in isolated containers with security-validated mounts
- Location: `src/container-runner.ts`
- Contains: Volume mount configuration, container argument building, IPC output parsing, process lifecycle
- Depends on: Child process management, config, mount security validator, logger
- Used by: Message processing layer, task scheduler

**Group Queue/Concurrency Layer:**
- Purpose: Manage per-group message/task queues, enforce MAX_CONCURRENT_CONTAINERS limit, implement retry logic
- Location: `src/group-queue.ts`
- Contains: Group state tracking, queue management, exponential backoff retry (max 5 attempts)
- Depends on: Logger
- Used by: Main router, scheduler

**Scheduled Task Execution Layer:**
- Purpose: Poll for due scheduled tasks (cron, interval, once) and execute them
- Location: `src/task-scheduler.ts`
- Contains: Task polling loop (60s intervals), cron expression parsing, task lifecycle
- Depends on: Database, container runner, group queue, cron-parser library
- Used by: Main startup

**State Persistence Layer:**
- Purpose: Store and retrieve messages, groups, sessions, tasks, router state
- Location: `src/db.ts`
- Contains: SQLite schema initialization, CRUD operations for all entities
- Depends on: better-sqlite3 library
- Used by: All layers that need state

**IPC Communication Layer:**
- Purpose: Enable agents running in containers to send messages, create/manage tasks, refresh metadata
- Location: `src/index.ts` (functions: `startIpcWatcher` at line 387, `processTaskIpc` at line 522)
- Contains: File-system-based JSON message protocol, authorization checks (main-group isolation), error handling
- Depends on: Filesystem, logger, database
- Used by: Agents in containers write JSON files; main process polls and processes them

## Data Flow

**Incoming Message Flow:**

1. **Message Receipt** (WhatsApp/Slack event)
   - WhatsApp: Socket event handler in `connectWhatsApp()` (line 769)
   - Slack: Socket Mode message handler in `src/slack.ts` (line 69)
   - Both: Store message in database via `storeMessage()` or `storeGenericMessage()`

2. **Message Detection**
   - `startMessageLoop()` (line 872) polls at POLL_INTERVAL (2000ms)
   - Gets new messages from database via `getNewMessages(chatJid)`
   - Enqueues message check: `queue.enqueueMessageCheck(jid)`

3. **Queue Processing**
   - `GroupQueue` (src/group-queue.ts) manages per-group concurrency
   - If group inactive and under MAX_CONCURRENT_CONTAINERS limit (default 5), runs immediately
   - Otherwise queues message check, waits for slot
   - Calls `processGroupMessages(chatJid)`

4. **Trigger Matching & Agent Invocation**
   - `processGroupMessages()` fetches messages since last agent interaction
   - Non-main groups: Check for `@ASSISTANT_NAME` trigger pattern (unless `requiresTrigger=false`)
   - Format messages as XML prompt
   - Call `runAgent()` which:
     - Writes group snapshot files (tasks, available groups)
     - Spawns container via `runContainerAgent()`
     - Waits for output, stores new session ID if returned

5. **Response Delivery**
   - If agent returns `outputType: 'message'`, send via `sendMessage()` (WhatsApp/Slack)
   - Update `lastAgentTimestamp[chatJid]` to prevent re-processing
   - Save state to database

**Scheduled Task Flow:**

1. **Task Polling** (60s intervals, `task-scheduler.ts` line 156)
   - `getDueTasks()` from database
   - Re-check status (may have been paused/cancelled)
   - Enqueue via `queue.enqueueTask(jid, taskId, runTask())`

2. **Task Execution**
   - `runTask()` (task-scheduler.ts line 33) builds group context
   - Spawns agent container with task prompt
   - Logs execution result (success/error, duration)
   - Updates `next_run` based on schedule type (cron parsed, interval calculated)
   - Optionally sends result message to chat

**IPC Output Flow:**

1. **Container Writes to IPC Directory**
   - Container mounts: `data/ipc/{group-folder}/messages/` and `/tasks/`
   - Writes JSON files: `{type: 'message'|'image'|'task'|...}`

2. **IPC Watcher Polls** (IPC_POLL_INTERVAL, 1000ms)
   - Scans `data/ipc/{sourceGroup}/messages/` and `tasks/`
   - Parses JSON, validates authorization (main can send anywhere, others only to their own group)
   - Processes message/image send, task create/update operations
   - Deletes processed files; moves errors to `data/ipc/errors/`

**State Management:**

- **In-Memory Maps:**
  - `sessions`: Map of group folder → current session ID (persisted to DB)
  - `registeredGroups`: Map of chat JID → group config
  - `lastAgentTimestamp`: Map of chat JID → last processed message timestamp
  - `lidToPhoneMap`: WhatsApp LID → phone JID translation (for self-chats)

- **Database Persistence:**
  - All changes to `sessions`, `registeredGroups`, `lastAgentTimestamp` synced to SQLite
  - `loadState()` restores at startup, `saveState()` writes periodically

## Key Abstractions

**RegisteredGroup:**
- Purpose: Represents a chat that has been set up to receive agent messages
- Files: Type defined in `src/types.ts` (line 35-42)
- Pattern: Each group has a `folder` (filesystem namespace), `trigger` pattern, `containerConfig` (mounts)
- Main group (`MAIN_GROUP_FOLDER = 'main'`) has special privileges: reads all groups, full project mount

**GroupQueue:**
- Purpose: Singleton queue manager for coordinating concurrent container execution
- Files: `src/group-queue.ts`
- Pattern:
  - Per-group state tracking (active, pendingMessages, pendingTasks)
  - Global active count with MAX_CONCURRENT_CONTAINERS limit
  - Exponential backoff retry on failure (BASE_RETRY_MS = 5000, up to 5 retries)
  - Graceful shutdown collects active processes and sends SIGTERM/SIGKILL

**VolumeMounts:**
- Purpose: Security-validated filesystem isolation for containers
- Files: `src/container-runner.ts` (line 56-60, buildVolumeMounts line 62)
- Pattern:
  - Main group: Full project root (`/workspace/project`) + group folder + global
  - Other groups: Only their own group folder + global (read-only)
  - All groups: Per-group sessions directory (`data/sessions/{folder}/.claude`)
  - IPC namespace: Per-group `data/ipc/{folder}` (messages, tasks)
  - Env filtering: Only auth/Claude vars exposed in container

**IPC Protocol:**
- Purpose: Container-to-host communication for messages, tasks, admin operations
- Files: `src/index.ts` (startIpcWatcher line 387, processTaskIpc line 522)
- Pattern: JSON files in `data/ipc/{group-folder}/{messages|tasks}/`
  - Messages: `{type: 'message'|'image', chatJid, text?, image?, caption?, sourceGroup}`
  - Tasks: `{type: 'create_task'|'pause_task'|..., groupFolder?, taskId?, ...}`
  - Authorization: Source group identity from directory name, main=unrestricted

## Entry Points

**`src/index.ts` - main()**
- Location: Line 990
- Triggers: Node process starts (`npm run dev` or `node dist/index.js`)
- Responsibilities:
  - Initialize database
  - Load persisted state (sessions, groups, timestamps)
  - Set up graceful shutdown handlers (SIGTERM, SIGINT)
  - Connect Slack (if enabled)
  - Connect WhatsApp and start message loop

**WhatsApp Socket Events**
- Location: `connectWhatsApp()` (line 769)
- Triggers:
  - `connection.update`: Emit QR codes, handle reconnection
  - `creds.update`: Save auth credentials when they change
  - `messages.upsert`: Handle incoming messages, store in DB, queue processing
  - `groups.upsert`: Update group names in cache

**Slack Socket Mode**
- Location: `connectSlack()` (src/slack.ts, line 31)
- Triggers: Regular messages in registered channels
- Handler: Stores message, calls `onMessage(channelId)` to enqueue

**Message Loop**
- Location: `startMessageLoop()` (line 872)
- Triggers: Runs every POLL_INTERVAL (2s) after WhatsApp/Slack connects
- Checks: New messages across all registered groups
- Actions: Enqueues message processing for groups with new messages

**Scheduler Loop**
- Location: `startSchedulerLoop()` (task-scheduler.ts, line 156)
- Triggers: Runs every SCHEDULER_POLL_INTERVAL (60s) after WhatsApp connects
- Checks: Tasks where next_run <= now
- Actions: Enqueues task execution via GroupQueue

**IPC Watcher Loop**
- Location: `startIpcWatcher()` (line 387)
- Triggers: Runs every IPC_POLL_INTERVAL (1s)
- Checks: JSON files in `data/ipc/{group-folder}/`
- Actions: Processes IPC commands (send message, create task, register group, etc.)

## Error Handling

**Strategy:** Graceful degradation with logging; failed operations don't crash the process

**Patterns:**

1. **Container Failures:**
   - If agent container exits with error, `runContainerAgent()` returns error status
   - Message processing returns 'error' signal
   - `GroupQueue` schedules retry with exponential backoff
   - Logs error with group name, container name, and error details

2. **Database Errors:**
   - All DB operations wrapped in try-catch
   - Migration failures (ALTER TABLE) silently ignored (column may already exist)
   - Corruption in JSON state fields reset to defaults

3. **IPC Errors:**
   - Malformed JSON files moved to `data/ipc/errors/` for manual inspection
   - Unauthorized IPC commands logged with warning, not processed
   - Missing group/task references logged but don't block other operations

4. **WhatsApp Reconnection:**
   - Disconnect triggered by `lastDisconnect.error`
   - Auto-reconnect if reason != loggedOut
   - Message/scheduler loops already running, resume immediately on reconnect (guards prevent duplication)

## Cross-Cutting Concerns

**Logging:**
- Tool: Pino (`src/logger.ts`)
- Pattern: Structured logging with context objects
- Levels: debug (container config), info (major events), warn (authorization issues), error (failures)

**Validation:**
- Mount security: `validateAdditionalMounts()` in `src/mount-security.ts`
- Zod schemas: Not used extensively; mostly implicit type safety via TypeScript
- Authorization: Checked at IPC layer (main group unrestricted, others limited to own group)

**Authentication:**
- WhatsApp: Baileys library handles; credentials stored in `store/auth/`
- Slack: Socket Mode tokens in env vars
- Claude: Injected into containers via env file (`data/env/env`)

---

*Architecture analysis: 2026-02-07*
