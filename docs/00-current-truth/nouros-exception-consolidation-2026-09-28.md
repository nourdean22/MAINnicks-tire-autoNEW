# NourOS exception consolidation — current truth

Date: 2026-09-28 ET
Status: MERGED to `main` in PR #2757 as `3178a894ff1d39d402837b214d060ce7b61b3a55`. Production exercise of real dead-letter/UNKNOWN/stalled rows remains pending.

## Design decision

The repo already had the intended owner-level exception surface: the Q-24 Owner Panel on `/system`.

This slice extends that incumbent. It does **not** create another inbox, queue, status table, or exception database.

Canonical sources remain canonical:

- cron failures/skips -> `cron_job_logs`
- deploy-page delivery -> `action_attempts` for `railway.deploy_alert`
- classic approvals -> `autonomous_actions` + `approval_requests`
- overdue commitments -> `commitments`
- AI budget stops -> existing lane-budget service
- post-turn dead letters -> `post_turn_outbox`
- consequential execution uncertainty/failure -> generic `action_attempts`

## New consolidated signals

### Post-turn durability queue

The Owner Panel reads the existing `getOutboxHealth()` projection.

- `dead > 0` becomes one rolled-up rose exception.
- The row includes dead count, oldest age, latest available error context, and a link to the existing system-health/redrive surface.
- A failed outbox-health read becomes `unreadable: chat outbox`; it never renders as zero dead work.

No redrive logic is duplicated. `redriveDeadOutboxRows()` remains the canonical mutation.

### Generic ActionAttempt exceptions

The generic read explicitly excludes `railway.deploy_alert`, because deploy pages already have a specialized Owner Panel path.

Included states:

- `WAITING_APPROVAL` -> joins the existing **decisions waiting** list.
- `UNKNOWN` -> rose exception: operation may or may not have committed; reconcile before retry.
- recent `FAILED` -> rose exception.
- `EXECUTING` older than 30 minutes -> amber stalled-execution exception.
- fresh `EXECUTING` stays quiet.
- `SUCCEEDED_UNVERIFIED` is deliberately **not** promoted into a generic exception yet; verification is not uniformly wired across all tools, so doing so would manufacture noise.

If the action-attempt read fails, the Owner Panel names `action attempts` as unreadable and cannot claim the decision surface is clear.

## Pure-status dependency repair

The Owner Panel previously imported `isHardFailure` from the DB-heavy `cron-control.ts`, which initializes Prisma even though status classification is pure.

This slice adds `lib/services/cron-status.ts` as a DB-free vocabulary:

- `HARD_FAILURE_STATUSES`
- `isHardFailure()`

`cron-control.ts` imports and re-exports those names, so existing callers keep the same public API. The Owner Panel now imports the pure module directly.

## Verification

Focused local proof on the isolated worktree:

- Owner Panel: 26/26 tests green.
- Post-turn outbox: 9/9 tests green.
- ActionAttempt state machine: 18/18 tests green.
- **53/53 combined focused tests green.**
- Changed-file ESLint green.
- `git diff --check` green.

The isolated worktree reuses the installed test/lint binaries from the existing dependency tree; no package reinstall was performed.

## Not claimed

This does not resolve the underlying dead letters or UNKNOWN actions automatically. It makes them impossible to disappear across separate subsystem pages and routes the operator to the existing canonical remediation surfaces.

Production proof remains pending until the merged code is deployed and exercised against real dead-letter/UNKNOWN/stalled rows.
