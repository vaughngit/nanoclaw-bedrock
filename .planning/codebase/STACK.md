# Technology Stack

**Analysis Date:** 2026-02-07

## Languages

**Primary:**
- TypeScript 5.7.0 - All source code (`src/**/*.ts`)
- Node.js - JavaScript runtime (Node >= 20 required)

**Secondary:**
- Shell/Bash - Container orchestration, system integration

## Runtime

**Environment:**
- Node.js >= 20 (required in `package.json` engines)
- Apple Container (macOS) or Docker (referenced in docs, primary deployment target)

**Package Manager:**
- npm 11+ (inferred from Node v25.5.0 environment)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Baileys (@whiskeysockets/baileys ^7.0.0-rc.9) - WhatsApp Web API client (message I/O, authentication)
- Slack Bolt (@slack/bolt ^4.6.0) - Slack Bot API with Socket Mode

**Database:**
- better-sqlite3 ^11.8.1 - Embedded SQL database (message history, tasks, state)

**Utilities:**
- cron-parser ^5.5.0 - Cron expression parsing (scheduled tasks)
- zod ^4.3.6 - Runtime schema validation
- pino ^9.6.0 - Structured JSON logging
- pino-pretty ^13.0.0 - Pretty-printed console output
- qrcode-terminal ^0.12.0 - Terminal QR code generation (WhatsApp auth)

**Build/Dev:**
- tsx ^4.19.0 - TypeScript executor with native ESM support (used in dev mode)
- Prettier ^3.8.1 - Code formatting
- TypeScript ^5.7.0 - Compiler

## Key Dependencies

**Critical:**
- @whiskeysockets/baileys - WhatsApp connectivity; without it, no message I/O
- better-sqlite3 - Persistent state; without it, no message history or task scheduling
- @slack/bolt - Slack integration; required for multi-channel support

**Infrastructure:**
- pino/pino-pretty - Observability; structured logging with pretty formatting
- cron-parser - Task scheduling engine
- zod - Runtime validation for environment config
- qrcode-terminal - Auth flow UX

## Configuration

**Environment:**
- `.env` file required at project root (see `.env.example`)
- Key variables:
  - `ASSISTANT_NAME` - Bot display name in chats (default: "Andy")
  - `ANTHROPIC_API_KEY` - Direct Claude API auth (one of two auth options)
  - `CLAUDE_CODE_USE_BEDROCK` - Enable Amazon Bedrock inference (alternate auth)
  - `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` - Slack Socket Mode credentials (optional)
  - `CONTAINER_IMAGE` - Apple Container image name (default: "nanoclaw-agent:latest")
  - `LOG_LEVEL` - Logging verbosity (default: "info")
  - `TZ` - Timezone for cron expressions (system default if unset)

**Build:**
- `tsconfig.json` - ES2022 target, NodeNext module resolution, strict mode enabled
- `.prettierrc` - Single quotes formatting
- No ESLint or Biome config (linting not enforced)

## Platform Requirements

**Development:**
- macOS (tested on macOS 26.2 / Tahoe with Apple Silicon)
- Apple Container v0.9.0+ installed
- Node.js 20+
- npm with `package-lock.json`

**Production:**
- macOS with Apple Container (primary), or Linux/macOS with Docker (secondary)
- Single host (not distributed)
- Requires persistent storage for: `/store/` (auth, messages.db), `/data/` (IPC, sessions), `/groups/` (group memories)

## Module System

- **Type:** ES Modules (specified as `"type": "module"` in `package.json`)
- **Main entry:** `src/index.ts` (compiled to `dist/index.js`)
- **Compilation target:** `dist/` directory
- **Dev command uses tsx for direct execution:** `node --env-file=.env --import tsx/esm src/index.ts`
- **Prod command uses pre-compiled:** `node dist/index.js`

## Notable Absence

- **No API framework:** Routing handled by Baileys (WhatsApp) and Slack Bolt (Slack)
- **No ORM:** Raw SQL via better-sqlite3 prepared statements
- **No HTTP server:** Slack uses Socket Mode (inbound), WhatsApp uses WebSocket (Baileys)
- **No task queue:** In-process queue (`src/group-queue.ts`) handles message/task scheduling
- **No testing framework:** No tests in codebase

---

*Stack analysis: 2026-02-07*
