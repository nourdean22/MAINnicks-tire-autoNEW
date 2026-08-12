---
name: nickstire-tidb-ddl
description: Use when adding or altering a column, table, status value, or index in the nickstire database (apps/nickstire/drizzle/). TiDB rejects several things MySQL allows, and one of them loses the row silently instead of erroring.
---

# nickstire-tidb-ddl

nickstire runs on TiDB Cloud (MySQL wire protocol, not MySQL semantics).
Migrations are **hand-applied** — there is no auto-migrate. The traps below
have each cost a session at least once.

## The rule that loses data

**TiDB runs with `STRICT_TRANS_TABLES`: a write whose value does not fit the
column is REJECTED and the row is LOST** — not truncated, not defaulted.

Two ways to hit it:

1. **Out-of-enum write.** Any value not in the `ENUM(...)` list is rejected.
2. **Over-width VARCHAR.** `published_partial` (17 chars) went into a
   `varchar(16)` and was rejected, wedging rows — see the comment in
   `drizzle/0091_content_runs.sql`.

Both are worse inside a failure handler: the handler tries to record
`status = 'failed_<reason>'`, the write is rejected, and the job is left in
its previous state with no error recorded.

## Do this instead

- **Never `ENUM` for a value set that will grow.** Use `VARCHAR` + app-level
  validation. `drizzle/0099_revenue_opportunity_queue.sql` states the standing
  reason: out-of-enum writes lose the row, and ENUM evolution needs ALTERs.
- **Size status columns at `varchar(32)` or wider.** `content_runs` does this
  deliberately after the 0091 incident.
- **Before adding a status value, check the column width.** Compute the longest
  value you will ever write, not the longest one today.

### Known narrow column

`reel_jobs.status` is **`varchar(20)`** ([drizzle/schema.ts:3249](../../../apps/nickstire/drizzle/schema.ts)) —
the narrowest status column in the schema, and an outlier against the
`varchar(32)` convention.

**Do not size against the column's own doc comment.** It lists eight values
topping out at `assets_ready` (12), which suggests 8 characters of headroom.
The code writes values the comment omits — `publish_ambiguous` (17) is set at
`server/cron/jobs/dailyReelPost.ts:381`, alongside `assembled`, `needs_review`
and `review_ready`. **Real headroom is 3 characters.**

Nothing currently written exceeds the limit (verified 2026-08-03: the longest
status reaching any column is 17 chars). But `publish_ambiguous` is itself a
failure path, so the margin is thinnest exactly where a rejected write costs
the most — the job is parked with no state recorded. Enumerate the values the
**code** writes, not the ones the comment lists, and widen the column in the
same migration that adds a longer one.

## Shipping `schema.ts` AHEAD of the hand-applied DDL

Migrations are hand-applied, so there is always a window where the CODE knows
about a column the DATABASE does not. Two rules make that window survivable:

- **Grep `.from(<table>)` for projection-less `select()` reads and pin each to
  the pre-migration column set.** A bare `db.select().from(t)` enumerates every
  column in the drizzle definition, so adding a column to `schema.ts` silently
  rewrites those queries to name a column prod lacks. Adding the 0110 ledger
  columns to `audit_log` would have 500'd three such reads
  (`services/adminAudit.ts`, `services/snapApplications.ts`,
  `services/complianceLog.ts`) until the DDL landed.
- **New-column WRITES must be conditional** — build the insert values object
  and attach each new key only when the caller supplied it, so every
  pre-existing call site emits byte-identical SQL. `services/auditTrail.ts`
  does this deliberately.

The inverse of this class already cost an outage: the bridge-send guard queried
a column that did not exist and failed CLOSED for months (#1485). Same window,
opposite direction — the code and the schema disagreeing about what is real.

## DDL that TiDB accepts

- **Additive, idempotent, `INFORMATION_SCHEMA`-guarded** — follow the existing
  `scripts/migrations/*` pattern. Re-running a migration must be a no-op.
- **TiDB needs two separate `ALTER`s where MySQL allows one combined.** Split
  them.
- **TiDB rejects `ALTER`-add of a STORED generated column.** Achieve the same
  result with an application-side normalized column plus a unique index (this
  is what the customer-dedup work had to do).

## Applying

Prod DDL runs through Railway, which injects the real connection string:

```bash
railway run --service MAINnicks-tire-auto -- node <script.cjs>
```

`apps/nickstire/docs/operations/SCHEMA_DRIFT_RUNBOOK.md` is the full procedure.
Read [prod-db-guard](../prod-db-guard/SKILL.md) before running anything that
writes — `.env` binds the production database.

After applying, re-run `pnpm run check` from `apps/nickstire/` — `tsc` fails
against the schema until the migration is actually applied.
