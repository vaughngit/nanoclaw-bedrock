# External Integrations

**Analysis Date:** 2026-02-07

## APIs & External Services

**Messaging Platforms:**
- **WhatsApp** - Message I/O via Baileys
  - SDK/Client: `@whiskeysockets/baileys` (v7.0.0-rc.9)
  - Auth: QR code scan stored in `store/auth/` (file-based credentials)
  - Used in: `src/index.ts` (connection, message receive/send), `src/whatsapp-auth.ts` (setup)
  - Capabilities: Send/receive text and image messages, presence updates, group metadata

- **Slack** - Multi-workspace messaging via Bolt (Socket Mode)
  - SDK/Client: `@slack/bolt` (v4.6.0)
  - Auth: Environment variables `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` (optional)
  - Used in: `src/slack.ts` (connection, message routing), `src/index.ts` (conditional startup)
  - Capabilities: Receive messages, send text, user name resolution via API
  - Connection: Socket Mode (no public URL required, uses WebSocket)
  - Limitations: No typing indicators, no image sending support

**AI Inference:**
- **Anthropic API** - Direct (Option A)
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Used by: Claude Agent SDK running in containers (not directly in router)
  - Note: Credentials filtered and exposed to containers via env mount

- **Amazon Bedrock** - Cross-region proxy (Option B, recommended for security)
  - Auth: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`
  - Config: `CLAUDE_CODE_USE_BEDROCK=1` enables it
  - Model: `ANTHROPIC_MODEL` specifies inference profile ID (e.g., `global.anthropic.claude-sonnet-4-5-20250929-v1:0`)
  - Used by: Claude Agent SDK running in containers
  - Note: Credentials filtered and exposed to containers via env mount

## Data Storage

**Databases:**
- **SQLite (better-sqlite3)**
  - Path: `store/messages.db`
  - Connection: Local file via better-sqlite3 (synchronous)
  - Tables:
    - `messages` - All message content (chat history)
    - `chats` - Chat metadata (JID, name, last activity)
    - `scheduled_tasks` - Recurring/one-time task definitions
    - `task_run_logs` - Task execution history
    - `router_state` - Global state (last message timestamp)
    - `sessions` - Claude Agent SDK session IDs per group
    - `registered_groups` - Group registration config

**File Storage:**
- **Local filesystem only** (no cloud storage)
  - `/store/auth/` - WhatsApp Baileys credentials (multi-file format)
  - `/store/` - SQLite database
  - `/data/` - Runtime: IPC directories per group, environment mount, group sessions
  - `/groups/{name}/` - Group working directories, logs, memory files

**Caching:**
- In-process: User name cache for Slack (Map in `src/slack.ts`)
- No distributed cache

## Authentication & Identity

**Auth Provider:**
- **Custom multi-channel** - No centralized provider
  - WhatsApp: Baileys QR code authentication (stored in `store/auth/`)
  - Slack: Bot token + App token (Socket Mode)
  - Claude inference: API key OR Bedrock credentials

**Implementation:**
- `src/whatsapp-auth.ts` - Interactive QR code setup, credentials saved to disk
- `src/slack.ts` - Token-based app initialization
- `.env` file - Auth credentials for inference engines
- No OAuth, no session management (stateless per inference call)

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, etc.)

**Logs:**
- **Framework:** Pino (structured JSON logging)
- **Transport:** pino-pretty (colorized terminal output)
- **Configuration:** `LOG_LEVEL` env var (default: "info")
- **Usage:**
  - `src/logger.ts` - Logger singleton exported to all modules
  - Container logs written to: `/groups/{name}/logs/container-{timestamp}.log`
  - Debug logs for container mounts, IPC operations, Slack user resolution

## CI/CD & Deployment

**Hosting:**
- **Single host** - macOS with Apple Container (primary)
- No automated deployment pipeline
- Manual service management via launchd (see `launchd/com.nanoclaw.plist`)
- Hot reload in dev: `npm run dev` with tsx

**CI Pipeline:**
- None (no GitHub Actions, no automated tests)

## Environment Configuration

**Required env vars (auth):**
- Choose one auth option:
  - Option A: `ANTHROPIC_API_KEY` (direct API)
  - Option B: `CLAUDE_CODE_USE_BEDROCK=1` + `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ANTHROPIC_MODEL`

**Optional env vars (integrations):**
- `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (both required for Slack support)
- `SLACK_ENABLED` is auto-computed from presence of both

**Runtime configuration:**
- `ASSISTANT_NAME` - Bot name in chats (default: "Andy")
- `CONTAINER_IMAGE` - Agent container image name (default: "nanoclaw-agent:latest")
- `LOG_LEVEL` - Logging level
- `TZ` - Timezone for cron expressions
- `CONTAINER_TIMEOUT` - Agent timeout in ms (default: 300000 / 5 min)
- `CONTAINER_MAX_OUTPUT_SIZE` - Max output captured (default: 10485760 / 10 MB)
- `MAX_CONCURRENT_CONTAINERS` - Max parallel agent runs (default: 5)
- `POLL_INTERVAL` - Message check frequency (hardcoded: 2000 ms)

**Secrets location:**
- `.env` file (local, never committed)
- `.env.example` - Template without secrets
- WhatsApp creds: `store/auth/` (file-based, persisted after auth setup)
- No secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)

## Webhooks & Callbacks

**Incoming:**
- **WhatsApp:** Baileys maintains persistent connection (WebSocket), no webhooks
- **Slack:** Socket Mode (bidirectional WebSocket), no webhooks
- **IPC:** File-based polling (containers write JSON to `/workspace/ipc/{group}/`, router polls every 1000ms)

**Outgoing:**
- **WhatsApp:** Direct messages via `sock.sendMessage()` in `src/index.ts`
- **Slack:** Direct messages via `app.client.chat.postMessage()` in `src/slack.ts`
- **Containers:** IPC files in `/workspace/ipc/{group}/messages/` and `/workspace/ipc/{group}/tasks/`

## Cross-Channel Architecture

**Message Flow:**
1. WhatsApp or Slack receives message
2. Stored in SQLite (metadata always, content only for registered groups)
3. Message loop polls every 2 seconds (`POLL_INTERVAL`)
4. If trigger pattern matched (or main group): enqueues group for processing
5. Group queue spawns Apple Container with agent
6. Container reads prompt, makes inference call
7. Container writes response to IPC file
8. Router reads IPC file, sends message back to original channel
9. Containers isolated - can't cross-communicate

**Channel-Agnostic Design:**
- `storeGenericMessage()` in `src/db.ts` handles both WhatsApp and Slack
- `isSlackId()` in `src/slack.ts` checks JID format to route messages
- `sendMessage()` in `src/index.ts` has Slack conditional logic
- Slack not supported for images (`sendImage()` logs warning)

---

*Integration audit: 2026-02-07*
