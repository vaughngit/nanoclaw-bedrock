---
phase: 01-config-loader
plan: 01
subsystem: config
tags: [jsonc, zod, strip-json-comments, config-loader, validation]

# Dependency graph
requires:
  - phase: none
    provides: first phase, no dependencies
provides:
  - "src/config-loader.ts exporting typed config singleton and NanoClawConfig type"
  - "JSONC parsing pipeline (comments, trailing commas)"
  - "Zod 4 strictObject validation with boxed ASCII error banners"
  - "strip-json-comments as direct dependency"
affects: [01-02 startup integration, phase 2 env expansion, phase 6 MCP config, phase 8 per-group overrides]

# Tech tracking
tech-stack:
  added: [strip-json-comments ^5.0.3 (direct dep)]
  patterns: [JSONC config file, Zod strictObject validation, frozen singleton export, boxed ASCII error banners]

key-files:
  created: [src/config-loader.ts]
  modified: [package.json, package-lock.json]

key-decisions:
  - "Used z.strictObject() over z.object() to reject unknown keys and catch typos"
  - "Error output via boxed ASCII banners + process.exit(1) instead of thrown exceptions"
  - "Config singleton is Object.freeze()d for runtime immutability"
  - "Collect-all error strategy (Zod default) so users see all problems in one shot"

patterns-established:
  - "Config loading: synchronous singleton export computed at module import time"
  - "Error formatting: printConfigError(title, details) with boxed ASCII banner"
  - "Validation: Zod 4 z.strictObject() + safeParse() with issue-specific formatting"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 1 Plan 1: Config Loader Summary

**JSONC config loader with Zod 4 strictObject validation, boxed ASCII error banners, and frozen singleton export via strip-json-comments**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T21:09:58Z
- **Completed:** 2026-02-07T21:13:12Z
- **Tasks:** 2
- **Files modified:** 3 (package.json, package-lock.json, src/config-loader.ts)

## Accomplishments

- Created `src/config-loader.ts` (164 lines) exporting typed `config` singleton and `NanoClawConfig` type
- JSONC parsing handles `//` comments, `/* */` block comments, and trailing commas via strip-json-comments
- Zod 4 `z.strictObject()` validation rejects unknown keys (catches typos like "executonMode")
- Three distinct error paths with boxed ASCII banners: file read errors, JSON syntax errors, validation errors
- Absent config file gracefully returns frozen defaults (`executionMode: 'container'`)
- Promoted strip-json-comments from transitive to direct dependency

## Task Commits

Each task was committed atomically:

1. **Task 1: Add strip-json-comments as direct dependency** - `41dc82d` (chore)
2. **Task 2: Create src/config-loader.ts** - `ef750bd` (feat)

## Files Created/Modified

- `src/config-loader.ts` - JSONC config loader with Zod validation, error formatting, and singleton export (164 lines)
- `package.json` - Added strip-json-comments ^5.0.3 as direct dependency
- `package-lock.json` - Updated lockfile for new direct dependency

## Decisions Made

- **z.strictObject() over z.object():** Rejects unknown keys to catch typos immediately at startup, rather than silently stripping them
- **process.exit(1) over throw:** Clean error output with boxed banners instead of ugly stack traces for config errors
- **Object.freeze() on config:** Runtime immutability prevents accidental mutation of config values by any module
- **Collect-all errors (Zod default):** Users see every config problem in a single banner, reducing fix-restart cycles
- **Separate try/catch per pipeline step:** File read, comment stripping, JSON parsing, and Zod validation each have distinct error messages with appropriate hints

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Config loader is ready for import by `src/index.ts` (plan 01-02 wires startup integration)
- `NanoClawConfig` type is available for use by downstream modules
- Schema is extensible -- later phases add fields to the `z.strictObject()` shape
- No blockers for plan 01-02 (startup integration)

---
*Phase: 01-config-loader*
*Completed: 2026-02-07*
