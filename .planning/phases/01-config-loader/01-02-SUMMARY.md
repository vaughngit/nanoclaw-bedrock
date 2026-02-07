---
phase: 01-config-loader
plan: 02
subsystem: config
tags: [config-loader, startup-integration, esm, import-elision, side-effect-import]

# Dependency graph
requires:
  - phase: 01-01
    provides: "src/config-loader.ts with typed config singleton and JSONC validation"
provides:
  - "Config loader wired into app startup via side-effect import in src/index.ts"
  - "Config loads and validates before database, container system, and WhatsApp"
  - "Backward compatibility verified -- zero behavior change when config file absent"
affects: [phase 2 env expansion, phase 3 container runner, phase 4 host runner]

# Tech tracking
tech-stack:
  added: []
  patterns: [side-effect ESM import for module-level singletons, process.stderr.write for pre-pino logging]

key-files:
  created: []
  modified: [src/index.ts, src/config-loader.ts]

key-decisions:
  - "Side-effect import (`import './config-loader.js'`) instead of named import to prevent esbuild/tsx import elision"
  - "process.stderr.write() instead of pino logger for module-level startup messages (pino async transport not ready during ESM evaluation)"

patterns-established:
  - "Side-effect import pattern: modules with module-level singletons must use bare `import './module.js'` to survive tree-shaking"
  - "Pre-pino logging: use process.stderr.write() for log messages that run during ES module evaluation"

# Metrics
duration: 10min
completed: 2026-02-07
---

# Phase 1 Plan 2: Startup Integration Summary

**Config loader wired into index.ts via side-effect import; loads before all startup logic; backward compatibility verified across three scenarios**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-07T21:16:03Z
- **Completed:** 2026-02-07T21:27:01Z
- **Tasks:** 2
- **Files modified:** 2 (src/index.ts, src/config-loader.ts)

## Accomplishments

- Wired config-loader into app startup as the first local import in src/index.ts
- Config message appears as the very first line of startup output, before database/container/WhatsApp logs
- Verified backward compatibility: app starts identically when no nanoclaw.config.jsonc exists
- Verified valid config acceptance and invalid config rejection with boxed error banner

## Task Commits

Each task was committed atomically:

1. **Task 1: Add config-loader import to src/index.ts** - `a83246b` (feat)
2. **Task 2: Verify app startup behavior + fix import elision and pino timing bugs** - `52f7a73` (fix)

## Files Created/Modified

- `src/index.ts` - Added side-effect import of config-loader.js as first local import (line 13)
- `src/config-loader.ts` - Replaced pino logger with process.stderr.write for module-level messages; removed logger.js import dependency

## Decisions Made

- **Side-effect import over named import:** esbuild (used by tsx) elides named imports whose bindings are never referenced in value position. Since Phase 1 loads the config but doesn't use it yet (later phases will), a bare `import './config-loader.js'` is the correct pattern to ensure the module always evaluates. This is a well-known ESM/bundler behavior.
- **process.stderr.write over pino logger:** pino's async worker thread (pino-pretty transport) is not ready during ES module evaluation. logger.info() calls at this stage are silently dropped. Using process.stderr.write() guarantees synchronous output. This is consistent with the existing printConfigError() function which also uses console.error (stderr).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] esbuild/tsx elides unused named import, config-loader never evaluates**
- **Found during:** Task 2 (Scenario A verification)
- **Issue:** The plan specified `import { config as nanoclawConfig } from './config-loader.js'` but since `nanoclawConfig` is never used in index.ts during Phase 1, esbuild's transpilation removes the import entirely. The config-loader module never runs.
- **Fix:** Changed to side-effect import `import './config-loader.js'` which bundlers/transpilers must preserve
- **Files modified:** src/index.ts
- **Verification:** esbuild output confirmed import is preserved; app startup shows config message
- **Committed in:** 52f7a73 (Task 2 commit)

**2. [Rule 1 - Bug] pino async transport drops module-level logger.info() calls**
- **Found during:** Task 2 (Scenario A verification)
- **Issue:** logger.info() from config-loader.ts during module evaluation is silently dropped because pino-pretty's worker thread transport hasn't initialized yet. The log message never appears in output.
- **Fix:** Replaced `logger.info()` with `process.stderr.write()` for the two startup messages; removed logger.js import from config-loader.ts
- **Files modified:** src/config-loader.ts
- **Verification:** "[config]" prefix message appears as first line of startup output
- **Committed in:** 52f7a73 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both bugs prevented the config loader from functioning as designed. Fixes are minimal and correct. No scope creep.

## Issues Encountered

- WhatsApp "stream errored (conflict)" during testing was expected -- the dev instance conflicts with the running production instance. This didn't affect verification since the config loading happens before WhatsApp connection.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 1 (Config Loader) is complete: config loads, validates, and logs at startup
- `NanoClawConfig` type and `config` singleton are available for downstream modules
- Schema is extensible for Phase 2 (env expansion) and beyond
- Side-effect import pattern documented for any future module-level singletons
- No blockers for Phase 2

---
*Phase: 01-config-loader*
*Completed: 2026-02-07*
