---
phase: 02-config-template-and-env-expansion
plan: 01
subsystem: config
tags: [jsonc, env-expansion, config-template, zod, strip-json-comments]

# Dependency graph
requires:
  - phase: 01-config-loader
    provides: "src/config-loader.ts with JSONC parsing pipeline and Zod strictObject validation"
provides:
  - "nanoclaw.config.jsonc self-documenting template with all sections documented via inline comments"
  - "expandEnvVars() function in config-loader.ts for ${VAR} and ${VAR:-default} syntax"
  - "Unresolved env var warning on stderr before Zod validation"
affects: [phase 3 container runner, phase 4 host runner, phase 5 host security, phase 6 MCP servers, phase 8 per-group overrides]

# Tech tracking
tech-stack:
  added: []
  patterns: [env var expansion in config pipeline, bash-convention ${VAR:-default} syntax, recursive JSON value walker]

key-files:
  created: [nanoclaw.config.jsonc]
  modified: [src/config-loader.ts]

key-decisions:
  - "Hand-rolled 15-line expandEnvVars() instead of adding a dependency -- trivial when operating on parsed JSON"
  - "Empty env var treated as unset for :- syntax (bash convention: envVal !== undefined && envVal !== '')"
  - "Only executionMode is active JSON in template; all future fields commented out to avoid z.strictObject() rejection"
  - "Expansion runs after JSON.parse, before Zod -- comments not expanded, expanded values validated"
  - "Unresolved vars produce warning then expand to empty string (standard behavior)"

patterns-established:
  - "Config template pattern: JSONC with commented-out future sections, uncommented as schema grows per phase"
  - "Env expansion pipeline position: raw -> strip comments -> JSON.parse -> expandEnvVars -> Zod validate"
  - "Recursive JSON walker: strings get regex replacement, arrays mapped, objects walk values (not keys), primitives pass through"

# Metrics
duration: 3min
completed: 2026-02-07
---

# Phase 2 Plan 1: Config Template and Env Expansion Summary

**Self-documenting nanoclaw.config.jsonc template with ${VAR} and ${VAR:-default} env expansion in config-loader pipeline**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T22:08:40Z
- **Completed:** 2026-02-07T22:12:05Z
- **Tasks:** 1
- **Files modified:** 2 (nanoclaw.config.jsonc, src/config-loader.ts)

## Accomplishments

- Created `nanoclaw.config.jsonc` template with inline JSONC comments documenting execution mode (active), MCP servers (commented), host security (commented), and per-group overrides (comments only)
- Added `expandEnvVars()` recursive function to config-loader.ts -- resolves `${VAR}` and `${VAR:-default}` in all string config values
- Integrated expansion into pipeline between JSON.parse and Zod safeParse, with unresolved var warning on stderr
- Verified backward compatibility: app starts identically with no config file and with config file containing no env vars

## Task Commits

Each task was committed atomically:

1. **Task 1: Create config template and add env expansion** - `7ddaa22` (feat)

## Files Created/Modified

- `nanoclaw.config.jsonc` - Self-documenting config template with 5 sections: header, execution mode, MCP servers, host security, per-group overrides (107 lines)
- `src/config-loader.ts` - Added ENV_VAR_PATTERN regex, unresolvedVars tracking, expandEnvVars() recursive walker, pipeline integration with warning (228 lines, +57 from Phase 1)

## Decisions Made

- **Hand-rolled env expansion:** No npm package supports exact `${VAR:-default}` bash syntax on arbitrary JSON values. Implementation is 15 lines of recursive walk on parsed JSON -- trivially correct with no escaping or multiline concerns.
- **Empty string = unset for :- syntax:** Matches bash behavior where `${VAR:-default}` uses default when VAR is empty OR unset. Users expect this convention from Docker Compose and GitHub Actions.
- **Template as actual config file:** The `nanoclaw.config.jsonc` at project root IS the template. Users edit it in place. No separate template directory needed.
- **Future fields commented out:** z.strictObject() rejects unknown keys, so mcpServers, hostSecurity etc. must remain JSONC comments until their Zod schema fields are added in later phases.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Config template ships with all future sections documented via comments
- Env var expansion is ready for use by MCP server configs (Phase 6), host security settings (Phase 5), and any string config values added in later phases
- Schema remains extensible -- future phases add fields to z.strictObject() and uncomment corresponding template sections
- No blockers for Phase 3 (Container Runner)

---
*Phase: 02-config-template-and-env-expansion*
*Completed: 2026-02-07*
