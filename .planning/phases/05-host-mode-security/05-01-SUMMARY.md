---
phase: 05-host-mode-security
plan: 01
subsystem: security
tags: [zod, config, sandbox, seatbelt, host-mode, schema-validation]

# Dependency graph
requires:
  - phase: 01-config-loader
    provides: "NanoClawConfigSchema with z.strictObject, config singleton, env var expansion"
  - phase: 04-runner-abstraction-and-host-runner
    provides: "ContainerInput interface, host-runner subprocess model"
provides:
  - "HostSecuritySchema with sandbox (boolean) and tools (optional string array)"
  - "HostSecurityConfig exported type"
  - "ContainerInput.security optional field for host-to-agent-runner IPC"
  - "Live hostSecurity config section with inline documentation"
affects:
  - 05-host-mode-security  # Plans 02 and 03 consume this schema and type
  - 08-per-group-overrides  # Per-group sandbox overrides will reference HostSecurityConfig

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional nested z.strictObject for feature-specific config sections"
    - "ContainerInput as the IPC contract between host-runner and agent-runner"

key-files:
  created: []
  modified:
    - src/config-loader.ts
    - src/container-runner.ts
    - nanoclaw.config.jsonc

key-decisions:
  - "HostSecuritySchema uses z.strictObject (not z.object) -- consistent with NanoClawConfigSchema, catches typos"
  - "tools field (not allowedTools) -- maps to SDK tools query option (availability), not allowedTools (auto-approval)"
  - "tools min(1) when present -- prevents accidentally disabling all tools with empty array"
  - "ContainerInput.security is optional (undefined = no restrictions for main group)"

patterns-established:
  - "Nested strictObject pattern: HostSecuritySchema nested inside NanoClawConfigSchema"
  - "IPC security contract: ContainerInput.security flows security config from host to agent-runner"

# Metrics
duration: 3min
completed: 2026-02-09
---

# Phase 5 Plan 1: Host Security Config Schema Summary

**HostSecurity Zod schema with sandbox boolean and tools allowlist, ContainerInput.security IPC field, and live config template with inline documentation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-09T04:28:29Z
- **Completed:** 2026-02-09T04:31:38Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- HostSecuritySchema validates sandbox (boolean, default true) and tools (optional string array, min 1)
- ContainerInput extended with optional security field for host-to-agent-runner communication
- Config template has live hostSecurity section with comprehensive inline documentation
- Full backward compatibility preserved -- configs without hostSecurity still parse correctly

## Task Commits

Each task was committed atomically:

1. **Task 1: Add hostSecurity Zod schema to config-loader** - `c0426a5` (feat)
2. **Task 2: Extend ContainerInput with security field and update config template** - `db76c0f` (feat)

## Files Created/Modified
- `src/config-loader.ts` - Added HostSecuritySchema, extended NanoClawConfigSchema, exported HostSecurityConfig type, updated startup log
- `src/container-runner.ts` - Extended ContainerInput interface with optional security and isScheduledTask fields
- `nanoclaw.config.jsonc` - Replaced commented-out hostSecurity with live section, documented sandbox and tools allowlist

## Decisions Made
- HostSecuritySchema uses z.strictObject consistent with existing NanoClawConfigSchema pattern -- catches typos like "snadbox"
- Field named `tools` (not `allowedTools`) to match SDK's `tools` query option which restricts tool availability, versus `allowedTools` which only controls auto-approval without prompts
- tools array requires min(1) when present to prevent users from accidentally disabling all tools with empty array
- ContainerInput.security is optional -- undefined means no restrictions (main group behavior), defined means apply restrictions (non-main groups)
- Fixed executionMode trailing comma in config template for multi-field JSON compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed missing comma after executionMode in config template**
- **Found during:** Task 2 (config template update)
- **Issue:** User's config had `"executionMode": "host"  //"container", ` which after comment stripping left no trailing comma. Adding hostSecurity as a second field required a comma separator.
- **Fix:** Changed to `"executionMode": "host",  //"container"` to ensure valid JSON after comment stripping
- **Files modified:** nanoclaw.config.jsonc
- **Verification:** Config parses and loads correctly with both fields
- **Committed in:** db76c0f (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix for JSON validity. No scope creep.

## Issues Encountered
None beyond the comma fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- HostSecurityConfig type is exported and ready for Plan 02 (host-runner integration)
- ContainerInput.security field is ready for Plan 03 (agent-runner consumption)
- Config template is live with sandbox=true, ready for immediate use
- All verification checks pass: build, startup log, backward compat, min(1) rejection, unknown key rejection

---
*Phase: 05-host-mode-security*
*Completed: 2026-02-09*
