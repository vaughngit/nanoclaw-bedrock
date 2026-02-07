# Codebase Concerns

**Analysis Date:** 2026-02-07

## Tech Debt

**Large monolithic router file:**
- Issue: `src/index.ts` is 1023 lines and handles WhatsApp connection, message routing, IPC processing, group management, and state persistence all in one file
- Files: `src/index.ts`
- Impact: Difficult to test individual components; changes to one feature risk breaking others; state management is tightly coupled with message handling
- Fix approach: Consider extracting IPC processing (`processTaskIpc`, `startIpcWatcher`) and group management (`registerGroup`, `syncGroupMetadata`, `getAvailableGroups`) into separate modules. Keep router as message flow coordinator.

**Type safety gaps:**
- Issue: 8 uses of `any` type throughout codebase; `(lastDisconnect?.error as any)` in index.ts:799 and `(data as any)` patterns in socket handling
- Files: `src/index.ts` (lines 799, 863)
- Impact: Loss of TypeScript type checking on error handling and message structures
- Fix approach: Create strict types for WhatsApp error objects and message event payloads using Baileys' proto types

**Database schema migrations with try-catch:**
- Issue: Column addition migrations (lines 66-97 in db.ts) use bare try-catch blocks without error context
- Files: `src/db.ts`
- Impact: Silent failures if migrations fail for reasons other than "column already exists" (e.g., permission errors, disk full)
- Fix approach: Check if columns exist before attempting ALTER TABLE; log migration failures with specific error context

**Hardcoded allowlist location decision:**
- Issue: `MOUNT_ALLOWLIST_PATH` is hardcoded to `~/.config/nanoclaw/mount-allowlist.json` in config.ts; no override mechanism
- Files: `src/config.ts` (line 12-17), `src/mount-security.ts`
- Impact: Cannot use different mount policies on different systems or for different deployment scenarios
- Fix approach: Allow `MOUNT_ALLOWLIST_PATH` environment variable override while keeping default

## Known Bugs

**LID to phone JID translation incomplete:**
- Symptoms: WhatsApp self-messages may not be properly translated from LID format to phone format if LID mapping wasn't captured during connection
- Files: `src/index.ts` (lines 72-94, 814-821)
- Trigger: Occurs when messages arrive before WhatsApp socket fully initializes; self-messages sent to LID JIDs won't match registered groups keyed by phone JIDs
- Workaround: Manually register groups using phone JID format; avoid using LID format JIDs in registered_groups

**Container output parsing fragile to debug output:**
- Symptoms: If agent emits debug output before sentinel markers, the JSON parsing at line 411-423 in container-runner.ts may extract stale output from previous runs
- Files: `src/container-runner.ts` (lines 411-423)
- Trigger: When LOG_LEVEL is 'debug' and container writes debug logs to stdout
- Workaround: Keep LOG_LEVEL at 'info' in production; debug output goes to stderr and is not parsed

**Race condition in state saving:**
- Symptoms: If NanoClaw crashes between `lastTimestamp` update (line 894 in index.ts) and `lastAgentTimestamp` update (line 258), some messages will be re-processed on restart
- Files: `src/index.ts` (lines 894-895, 258-260)
- Trigger: Node process termination between two separate state saves
- Workaround: Re-processing is idempotent (agent runs again on same messages); duplicate prevention via trigger pattern check

**IPC file processing assumes JSON validity:**
- Symptoms: Malformed IPC message JSON causes file to be moved to error directory and never reprocessed
- Files: `src/index.ts` (lines 424-425, 492)
- Trigger: Container writes incomplete or corrupted JSON to IPC message/task files
- Workaround: Monitor `data/ipc/errors/` directory; manually fix and retry if needed

## Security Considerations

**Container name shell injection mitigation incomplete:**
- Risk: Container names are sanitized before passing to `container run` in container-runner.ts:206, but re-sanitized in group-queue.ts:262 with different rules
- Files: `src/container-runner.ts` (line 206), `src/group-queue.ts` (line 262)
- Current mitigation: Double sanitization (belt and suspenders approach)
- Recommendations: Consolidate sanitization logic into one place; use parametrized shell execution if possible instead of string interpolation

**Mount allowlist cached in memory:**
- Risk: If mount allowlist is modified after process starts, changes won't be reflected until restart
- Files: `src/mount-security.ts` (lines 21-23, 54-60)
- Current mitigation: Allowlist is external to project (outside mounted containers), making it tamper-proof during container execution
- Recommendations: Add periodic reload (e.g., every hour) or add a `reload-allowlist` IPC command for manual refresh

**Environment variable filtering for container:**
- Risk: Only whitelisted env vars are exposed to containers (lines 137-142 in container-runner.ts), but whitelist is hardcoded
- Files: `src/container-runner.ts` (lines 137-142)
- Current mitigation: Whitelist is conservative; secrets like AWS credentials are included only if explicitly set
- Recommendations: Log all attempted access to non-whitelisted env vars for audit trail; document the complete whitelist in comments

**IPC authorization based on directory naming:**
- Risk: If group folder names can be controlled/guessed by container agents, they could potentially spoof authorization
- Files: `src/index.ts` (lines 412, 540-541)
- Current mitigation: Group folders are created by router only; containers cannot create peer group folders; authorization checks both isMain flag and sourceGroup directory
- Recommendations: Add immutability flag to group folder names once created; validate consistency between JID-to-folder mappings

## Performance Bottlenecks

**Message queue blocks on container execution:**
- Problem: GroupQueue processes groups sequentially; if one group's container takes 5 minutes, other groups wait 5 minutes
- Files: `src/group-queue.ts` (lines 117-150)
- Cause: `activeCount` throttling limits to `MAX_CONCURRENT_CONTAINERS`; when limit reached, queue blocks
- Improvement path: MAX_CONCURRENT_CONTAINERS defaults to 5 (line 34-37 in config.ts); this is already configurable. Monitor actual concurrency with `npm run dev LOG_LEVEL=debug` and increase if host can handle it. Consider per-group timeout budgets instead of global container count limit.

**IPC polling interval tight for large deployments:**
- Problem: `IPC_POLL_INTERVAL` is 1000ms; with many groups, filesystem operations become costly
- Files: `src/index.ts` (lines 394, 515), `src/config.ts` (line 33)
- Cause: Polling `data/ipc/{groupFolder}/messages` and `data/ipc/{groupFolder}/tasks` for each registered group every second
- Improvement path: Implement file system watching (fs.watch) instead of polling, or increase IPC_POLL_INTERVAL to 5000ms if latency is acceptable

**Database query per group on every message loop iteration:**
- Problem: `getNewMessages()` (line 884 in index.ts) queries all registered groups' messages every POLL_INTERVAL (default 2000ms)
- Files: `src/index.ts` (line 884), `src/db.ts` (lines 256-282)
- Cause: No index on `(chat_jid, timestamp)` tuple; full table scan for each poll
- Improvement path: Add composite index: `CREATE INDEX idx_chat_timestamp ON messages(chat_jid, timestamp)`. Already has idx_timestamp (line 34 in db.ts) but not combined with chat_jid.

**Task scheduler polls at 60-second intervals:**
- Problem: Due tasks may have up to 60-second delay before execution
- Files: `src/task-scheduler.ts` (line 188), `src/config.ts` (line 5)
- Cause: SCHEDULER_POLL_INTERVAL hardcoded to 60000ms
- Improvement path: Reduce to 10000ms for more responsive scheduling; or implement next-run-time-based sleep instead of fixed polling

## Fragile Areas

**Message deduplication depends on lastTimestamp ordering:**
- Files: `src/index.ts` (lines 883-906)
- Why fragile: Message ordering in database must be guaranteed by SQLite's rowid ordering. If two messages arrive with identical timestamps from same group, ordering is undefined
- Safe modification: Always use `id` as secondary sort key when querying by timestamp; add `ORDER BY timestamp, id` to ensure deterministic ordering
- Test coverage: No explicit test for message ordering; add test with concurrent messages

**Container spawn error handling path:**
- Files: `src/container-runner.ts` (lines 457-465)
- Why fragile: If container spawn fails before stdio setup completes (line 238), the promise still resolves with an error response. If spawn errors occur after file has been partially written, error state may be lost
- Safe modification: Validate container command exists before spawning; catch spawn errors immediately before stdio setup
- Test coverage: No test for spawn failures on nonexistent container binary

**Group sync metadata can timeout silently:**
- Files: `src/index.ts` (lines 153-184)
- Why fragile: If `sock.groupFetchAllParticipating()` hangs (line 169), there's no timeout mechanism; it will block the entire message loop until timeout or completion
- Safe modification: Add explicit timeout to groupFetchAllParticipating call (5-10 seconds); wrap in Promise.race
- Test coverage: No test for timeout scenarios

**IPC task authorization relies on single sourceGroup parameter:**
- Files: `src/index.ts` (lines 522-542)
- Why fragile: Authorization is determined by which directory the IPC file came from. If filesystem permissions are misconfigured, a group folder could potentially be accessed by wrong group agent
- Safe modification: Cross-check authorization with registered group mapping; don't trust directory name alone
- Test coverage: No test for authorization boundary violations

## Scaling Limits

**SQLite write contention:**
- Current capacity: Single-file SQLite database; concurrent writes from message storage and task logging may contend
- Limit: Noticeable slowdown expected above 5-10 concurrent groups with high message volume
- Scaling path: For large deployments, migrate to PostgreSQL or implement write batching with a message queue

**Container spawn rate:**
- Current capacity: Each message processing spawns a new container; cleanup happens asynchronously
- Limit: Apple Container may have limits on concurrent VMs or container creation rate (typically 20-30 concurrent)
- Scaling path: Implement container reuse pool instead of spawn-per-message; or implement request batching (group pending messages and run once per minute)

**IPC file accumulation:**
- Current capacity: IPC files are created and deleted synchronously; no rate limiting
- Limit: If container agents create many IPC tasks without being processed, disk space grows unbounded
- Scaling path: Add quota enforcement on `data/ipc/` directory size; implement priority-based task dropping if quota exceeded

**Mount allowlist validation overhead:**
- Current capacity: Validation is per-group on startup; allowlist is cached but symlink resolution happens on each mount
- Limit: With 50+ groups and complex mount paths, startup could take several seconds
- Scaling path: Pre-validate all mounts at startup; cache resolved paths in allowlist; implement lazy validation

## Dependencies at Risk

**@whiskeysockets/baileys on rc version:**
- Risk: `@whiskeysockets/baileys@^7.0.0-rc.9` is a release candidate; WhatsApp frequently changes APIs, breaking rc versions
- Impact: WhatsApp authentication or message handling could break on npm install after release candidate moves
- Migration plan: Pin to specific rc version rather than `^7.0.0-rc.9`; monitor Baileys releases and migrate to stable once available. Have fallback QR authentication script tested and documented

**better-sqlite3 on native binding:**
- Risk: better-sqlite3 requires native compilation; npm install may fail on Apple Silicon, Node version mismatches, or without build tools
- Impact: Installation failures if Xcode Command Line Tools not installed
- Migration plan: Consider sql.js (pure JS) as fallback for non-critical deployments; document required build tools in setup

**Apple Container dependency:**
- Risk: Project hardcoded to Apple Container; no Docker fallback
- Impact: Cannot run on Linux or Windows without significant refactoring
- Migration plan: Abstract container interface; implement Docker backend alongside Apple Container

## Missing Critical Features

**No message archival or cleanup:**
- Problem: Message database grows unbounded; old messages never deleted
- Blocks: Cannot run for years without disk space issues
- Solution: Implement message retention policy (e.g., keep 90 days of messages); add CLI command to vacuum database

**No error recovery for stuck tasks:**
- Problem: If a scheduled task hangs, it consumes a container slot and blocks other tasks
- Blocks: Long-running tasks can starve the system
- Solution: Implement per-task timeout enforcement; add manual task cancellation from main group

**No monitoring or alerting:**
- Problem: Silent failures common; no way to know if system stopped processing
- Blocks: Cannot detect outages until user notices lack of response
- Solution: Add health check endpoint; implement basic logging to `.planning/health.log`; send alert to main group if message loop stalls > 5 minutes

**No session compaction on Agent SDK:**
- Problem: Long-running groups will accumulate massive conversation history
- Blocks: Eventually agent will hit token limits or slow down
- Solution: Implement periodic context compaction (monthly or when context > 50k tokens); store summary in group CLAUDE.md

## Test Coverage Gaps

**Message routing authorization:**
- What's not tested: Whether group isolation is actually enforced; whether agents in group A can see messages from group B
- Files: `src/index.ts` (lines 208-274), `src/container-runner.ts` (lines 62-102)
- Risk: Critical security issue if a bug allows cross-group access
- Priority: HIGH - Add integration tests for group isolation

**IPC file format validation:**
- What's not tested: Whether invalid IPC JSON is properly quarantined; whether malformed data causes system-wide issues
- Files: `src/index.ts` (lines 424-427, 492)
- Risk: DOS attack via malformed IPC files
- Priority: MEDIUM - Add tests for file parsing errors

**Container spawn/timeout path:**
- What's not tested: Timeout handling; what happens if container doesn't respond to stop signal
- Files: `src/container-runner.ts` (lines 289-299, 457-465)
- Risk: Hung containers consuming resources
- Priority: MEDIUM - Add tests for timeout and cleanup

**Cron expression parsing:**
- What's not tested: Invalid cron expressions; what happens when user enters "* * * * * *" (6 fields) instead of 5
- Files: `src/index.ts` (line 579), `src/task-scheduler.ts` (line 136)
- Risk: Silent task failures
- Priority: LOW - Cron parser library likely handles this; add validation layer

**Mount security validation:**
- What's not tested: Symlink escaping; whether allowlist properly blocks common attack paths
- Files: `src/mount-security.ts` (lines 138-196)
- Risk: Container agents accessing host resources outside allowlist
- Priority: HIGH - Add comprehensive test suite for path validation

**State recovery after crash:**
- What's not tested: Whether unprocessed messages are properly recovered; whether race conditions cause double-processing
- Files: `src/index.ts` (lines 918-930)
- Risk: Message loss or infinite loops
- Priority: MEDIUM - Add tests for crash recovery scenarios

---

*Concerns audit: 2026-02-07*
