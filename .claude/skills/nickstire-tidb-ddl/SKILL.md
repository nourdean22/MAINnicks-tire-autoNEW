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
`varchar(32)` convention. Current values top out at `assets_ready` (12), so
there are 8 characters of headroom. A longer status added here throws inside
the reel failure handler. Widen the column in the same migration that adds the
value.

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
