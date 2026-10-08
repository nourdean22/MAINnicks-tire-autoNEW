# Pending migrations · awaiting production DB access

Migrations parked here are NOT in the live `prisma/migrations/`
directory · `prisma migrate deploy` will not apply them. Move
them back when ready.

## APPLIED 2026-09-29 - RealityEvent envelope

`20260929123500_reality_event_envelope` was applied to production after a live durable-mission proof exposed the expected `event_version` schema drift. Production read-back verified all five columns, all three indexes, and zero NULL `occurred_at` rows. The migration is now canonical under `prisma/migrations/`, and production Prisma migration history records it applied.

## ⏳ 2026-10-07 — TWO PENDING

Every dir parked here must be registered in the guarded endpoint with its exact
statements, or listed with a reason in the test's `OPERATOR_ONLY` map:
`tests/api/apply-pending-migration.test.ts` fails otherwise. #2784 parked one
its code already needed without registering it: production failed every
reality-event read and write, and the one-request fix only existed after #2788.

### `20261007120000_device_events_identity_indexes`

Camera audit 2026-10-07 (PR #2920). **Not applied.** Two expression indexes on
`device_events`, no ALTER, no DROP, no row touched: a partial UNIQUE on
`(device_id, data->>'eventId')` so a retried edge event can exist once per device
(the service's findFirst-then-create dedupe had no database behind it), and an
index on `(device_id, data->>'visitId')` so the visit window can span a weekend.
Registered in the guarded endpoint
(`POST /api/system/apply-pending-migration { name: "20261007120000_device_events_identity_indexes" }`).
The code is safe before the apply: `lib/services/vehicle-detection.ts` keeps its
pre-check and additionally catches the P2002 the index raises once it exists.
`lib/db/schema-sentinel.ts` expects the unique index, so `/system/health` reports
it missing until the apply -- that reading is true. The unique CREATE fails on
existing duplicate eventIds; the migration header has the read-only preflight.
After applying: promote the dir to `prisma/migrations/`, then
`prisma migrate resolve --applied 20261007120000_device_events_identity_indexes` -- both halves.

### `20260929090000_bridge_receipts`

ADR-0019 phase 0b (the receiver's dedupe table). **Not applied.** One new table
plus one index; no ALTER or DROP. Registered in the guarded endpoint
(`POST /api/system/apply-pending-migration { name: "20260929090000_bridge_receipts" }`).
The code that reads it (`lib/services/bridge-receipts.ts`) treats a missing
table as "not migrated" and falls back to today's write, so the deploy is safe
before the apply. After applying: promote the dir to `prisma/migrations/`, then
`prisma migrate resolve --applied 20260929090000_bridge_receipts` — both halves.

## ✅ 2026-09-23 — EMPTY AGAIN

`20260923150000_cron_job_log_skip_reason` was parked here, then applied to
production the same day on the operator's instruction, promoted to
`prisma/migrations/` and recorded in `_prisma_migrations` (66 rows; checksum
= sha256 of the file, matching how every earlier row is recorded).

## ✅ 2026-09-18 — THIS DIRECTORY IS EMPTY, AND THAT IS THE CORRECT STATE

It held five migrations for weeks. Measured read-only against Neon prod on
2026-09-17, **all five were already applied** — the directory's whole premise,
"not yet applied", was false for every entry in it.

★ A "pending" directory that is 100% applied is worse than an empty one: it
tells every reader there is outstanding schema work, and it would hide a
genuinely pending entry behind five that are not. The same stale-cache defect
this repo keeps finding in comments and doc headers, wearing a directory for a
costume.

**They were applied through the guarded endpoint, which deliberately does NOT
write `_prisma_migrations`** (#1231). So the ledger had no row, `prisma/migrations/`
had no dir, and `prisma migrate status` read "Database schema is up to date!"
*precisely because neither side knew they existed.* ⚠ **A green `migrate status`
is not evidence a migration was recorded** — it compares the ledger against the
directory, and a migration missing from both is invisible to it.

**Resolved 2026-09-18 (operator-directed): promoted + recorded.** Each was moved
to `prisma/migrations/<name>/` and then `prisma migrate resolve --applied <name>`.
`cron_job_log_result_count` already had both and only its stale copy here was
removed. Ledger went 57 -> 61 rows; `migrate status` reads 61 found, up to date.

⚠ BOTH HALVES OR NEITHER, if you ever do this again: a dir with no ledger row
turns `migrate status` RED, and a ledger row with no dir is the 2026-07-30
orphan incident (9 rows deleted). Promotion preserves the SQL as history;
deleting them would have lost it, which is why it was the operator's call.

> **Preferred path — no prod creds needed (use this).** Apply via the guarded
> endpoint `POST /api/system/apply-pending-migration { name }`. It runs an
> idempotent (IF NOT EXISTS) copy of the migration's statements from inside the
> deployed app — which has the prod `DATABASE_URL`. It deliberately does NOT
> write `_prisma_migrations` (2026-07-29: hand-inserted rows for names with no
> `prisma/migrations/<name>/` dir turned `prisma migrate status` red — see
> docs/STATENOUR-OBSERVABILITY-TRUTH-ARC.2026-07-29.cgd.md). After applying,
> promote the SQL into `prisma/migrations/<name>/` and run
> `prisma migrate resolve --applied <name>` so status stays green.
> Steps: add the SQL to that route's `MIGRATIONS`
> registry → deploy → from the authed app tab run
> `fetch('/api/system/apply-pending-migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'<name>'}),credentials:'include'})`.
> The dev/agent env has NO prod creds and there is NO statenour Vercel project,
> so the `vercel env pull` route below is usually a dead end.

## How to apply a parked migration (legacy / with-creds path)

1. Confirm DATABASE_URL points at production (Neon)
   ```bash
   echo $DATABASE_URL  # should NOT be localhost:5432
   # If it is, pull prod env first:
   vercel env pull .env.production.local
   # OR run from a Vercel deployment shell that has prod env vars
   ```

2. Move the migration back into the live folder
   ```bash
   mv prisma/migrations-pending/<NAME> prisma/migrations/<NAME>
   ```

3. Apply the migration
   ```bash
   pnpm release:db   # = prisma migrate deploy
   ```

4. Restore the schema fields that the migration adds (the rollback
   commit removed them so the live code matches the un-migrated
   prod DB · with the migration applied, the fields can come back
   in)

5. Verify
   ```bash
   pnpm prisma migrate status   # shows migration as applied
   ```

6. Commit + push the schema-restore + the migration move

## Parked migrations

### `20260823010000_discovery_index_narrow` + `20260823010001_discovery_index_drop_broad` — ✅ APPLIED 2026-08-23, staying parked

Two steps that replace `brain_memories_discovery_verdict_idx` with
`brain_memories_discovery_scoped_idx`. **Deliberately NOT promoted to
`prisma/migrations/`**: both use `CREATE`/`DROP INDEX CONCURRENTLY`, which cannot
run inside a transaction block, and `prisma migrate deploy` wraps the file in
one. Promoting them would make a fresh `migrate deploy` fail. Apply with
`scripts/apply-pending-migration.ts` (autocommit), same as
`20260806120000_drop_duplicate_indexes`.

**Why.** The index shipped in `prisma/migrations/20260823000000_brain_memory_discovery_columns`
is partial on `deleted_at IS NULL` ALONE, so it indexed every live row: **5144 kB
covering 92,228 rows to serve 246**. 99.7% dead weight, maintained on every
INSERT/UPDATE to a table taking 222 writes from 45 writers in 13 hours.

**Applied 2026-08-23**, in order, with the `indisvalid` gate between them.
Before → after on the same query, same 239 rows: **5144 kB → 32 kB** (161×),
**508 → 118 buffers**, 0.572 ms → 0.485 ms. The planner confirms the predicate —
the new plan's `Index Cond` drops `category = ANY(...)` because Postgres proves
the implication.

**Rollback** is in each file's header. An index holds no data, so both are
lossless and fully reconstructible.

**FRESH DATABASE.** `migrate deploy` replays `20260823000000` and creates the
BROAD index; these two steps are what narrow it. A fresh environment therefore
has the broad index until they are applied, and
`lib/db/schema-sentinel.ts` will report drift (two expectations: the index name,
and — the one that matters — that the category list is in its predicate).
`prisma db push` (what e2e uses) creates neither index; the degradation is a
bitmap scan, slow rather than wrong.

### `20260822230000_cron_job_log_result_count` — ✅ APPLIED 2026-08-22, promoted to `prisma/migrations/`

Adds a nullable `"resultCount" INTEGER` to `cron_job_logs`. Additive, no backfill,
no data loss; `rollback.sql` drops it.

**Why.** The table has six columns and no result count, so a full ingest and a
zero-result ingest are indistinguishable BY SCHEMA — no amount of monitoring
discipline could have caught the difference, because the difference was not
representable. `ingest-reviews` ran 4x/day for 16 days with a 100% failure rate
(measured: 64 runs, 64 failures, 2026-08-04 → 08-19) and nothing paged.

**Shipped with its producer, as required.** `countFrom(result)` in
`lib/services/cron-manager.ts` is threaded into the `cronJobLog.create` calls and
`ingest-reviews` returns a `resultCount`. `tests/services/cron-manager-result-count.test.ts`
proves the column DISCRIMINATES — two runs identical on every pre-existing column
write different rows — and mutation-fires on both an always-null `countFrom` and
the subtler `|| null`, which would coerce a real 0 back into "made no claim".

**Applied 2026-08-22.** Before: 66,529 rows / 6 columns. After: 66,531 rows (+2 live
cron runs mid-window, none lost) / 7 columns, `integer`, nullable, DEFAULT NULL,
0 non-null values. `prisma migrate resolve --applied` recorded it and
`prisma migrate status` reports "Database schema is up to date!" (49 migrations).
Rollback is `prisma/migrations/20260822230000_cron_job_log_result_count/rollback.sql`.

**NULL vs 0 is load-bearing:** NULL = this run reported no count (every existing
row). 0 = ran and produced nothing. A `DEFAULT 0` would backfill a manufactured
"produced nothing" onto ~66,000 historical rows.

### `20260902000000_restore_idempotency_partials` — ✅ APPLIED 2026-09-02 (directly, statement by statement)

Restored six indexes the live DB was missing: five partial uniques on
`idempotency_key` (`scheduled_actions`, `task_events`, `goal_events`,
`reflections`, `decision_replays`) plus the `chat_messages` GIN over
`searchable_tsv`. Reported as five HIGH + one MEDIUM by the schema sentinel on
`/system/health`. Additive only, every statement `IF NOT EXISTS`.

Cause: Prisma cannot express a partial unique in `@@unique` — the
`AutonomousAction` model says so in a comment — so none of these were known to
Prisma, and an index Prisma does not know about is one `prisma db push` drops.
That is failure mode #1 in `lib/db/schema-sentinel.ts`'s own header.
`20260429190000_universal_idempotency` created all six in one file; five went
away while `autonomous_actions` and `entity_audits` — same expectation shape,
same checker — survived. **That control was re-confirmed against prod before
applying**: six absent, two present.

Applied directly against the production branch (project `statenour`,
`spring-art-47050555`), same as `20260806120000_drop_duplicate_indexes` above.

**The read-only preflight found a real duplicate**, which is the whole reason
the preflight exists. `task_events` held two byte-identical rows — same
`idempotency_key`, `taskId`, `kind: completed`, same payload — written **17 ms
apart** at 2026-09-02T14:45:12 by one `service:checkTask` double-fire. The key
was minted correctly and correctly IDENTIFIED the duplicate; with no unique
index the database had nothing to reject it with. Both rows were copied to
**`_bak_task_events_dedup_20260902`** (still present — drop only on operator
say-so) before deleting the later row `cmtk7k0pj00hrqh01sqi72gp0` by explicit
`id`, never by predicate. The other four tables had zero blocking rows.

**Verified after applying**, three ways:
- all six present in `pg_indexes` with predicate `WHERE (idempotency_key IS NOT NULL)`
- the sentinel's own three conditions (`unique` + `where` + predicate substring)
  evaluated in SQL against prod: all seven expectations return SENTINEL PASSES
- **enforcement proven, not inferred** — a deliberate duplicate INSERT was
  rejected with `duplicate key value violates unique constraint
  "task_events_idempotency_key_uniq"`, zero rows written. A green `pg_indexes`
  read says an index exists, not that it enforces.

**Left in this folder on purpose**, same as `20260806120000_drop_duplicate_indexes`
and `0003_ambition_engine`: it is already applied, and moving it into
`prisma/migrations/` could trip migrate-deploy ordering. `_prisma_migrations`
was deliberately NOT hand-written — see the header note at the top of this file
about that turning `prisma migrate status` red.

**Rollback**: `DROP INDEX IF EXISTS` on the six names. An index holds no data,
so this is lossless and fully reconstructible. The deleted `task_events` row is
recoverable from the backup table.

### `20260806120000_drop_duplicate_indexes` — ✅ APPLIED 2026-08-06 (directly, one transaction)

Dropped 42 duplicate indexes across 24 tables (~18.7 MB). Indexes only — no data touched.

Cause: `scripts/emit-index-migration.ts` built index NAMES from Prisma FIELD names while building
index BODIES from `@map`'d COLUMN names, so `CREATE INDEX IF NOT EXISTS "Mission_deletedAt_idx"`
never matched the existing `Mission_deleted_at_idx` and created a byte-identical twin instead of
no-opping. Generator fixed at the source in the same PR (#1409), so re-running it is now genuinely
idempotent and will not recreate them.

Applied as a single transaction against the production branch (project `statenour`,
`spring-art-47050555`) rather than via the endpoint — every statement is `DROP INDEX IF EXISTS`,
so it is idempotent and safe to re-run.

**Verified after applying**, both checks in this directory's `migration.sql` header:
- the duplicate-pair query returns **0 rows** (was 42)
- all **42 surviving twins** confirmed present by name

**Rollback**: `rollback.sql` in this directory holds the exact `pg_indexes.indexdef` for all 42,
captured immediately before the drop. Those definitions also document why the drop is plan-neutral:
every one was a plain btree over the same column list as its twin — no UNIQUE, no partial
predicate, no expression or differing opclass.

Left in this folder on purpose, same as `0003_ambition_engine` below: it is already applied, and
moving it into `prisma/migrations/` could trip migrate-deploy ordering. `_prisma_migrations` was
deliberately NOT hand-written (see the header note at the top of this file about that turning
`prisma migrate status` red).


### `20260722120000_experiment_factory` — ✅ APPLIED 2026-07-22 (COLUMN-FIRST, via `apply.mjs`)

Closed-loop Experiment factory: new `experiments` table (1:1 with an accepted `opportunity_logs` row, FK to `intelligence_sources`) + nullable columns `opportunity_logs.source_id`, `intelligence_sources.auth_score_updated_at` / `auth_score_samples`. Additive, idempotent, pgvector-verified untouched. **COLUMN-FIRST**: applied to prod Neon BEFORE the schema-bearing deploy (the two `ADD COLUMN`s touch hot tables the regenerated Prisma client SELECTs — deploying first would 500 every read until apply). Applied via the DO-`$$`-aware `apply.mjs` in the migration dir (`railway run … node apply.mjs`), NOT the legacy `;`-split script. Also mirrored in the `apply-pending-migration` route's `MIGRATIONS` map (idempotent re-apply path).

### `20260625000000_action_receipts_and_completion_criteria` — ✅ APPLIED 2026-06-26 (via script)

Patience XP ledger and auto-closer migration (adds `completionCriteria` column to `Mission` table and `action_receipts` table for logging). Applied directly to Neon database and registered in `apply-pending-migration` route's `MIGRATIONS` map.

### `20260618000000_consolidated_models` — ⏳ REGISTERED, awaiting apply (PR #217)

The NOUR OS consolidation (#206) added 10 Prisma models — `ContentNode`,
`Contact`, `Booking`, `Agreement`, `Product`, `Order`, `FinancialTransaction`,
`InvestmentHolding`, `ShortLink`, `LinkClick` — backing `/crm` `/wealth`
`/finance` `/links`. Their idempotent DDL (`CREATE TABLE IF NOT EXISTS` +
indexes + FKs) is registered in the `apply-pending-migration` route's
`MIGRATIONS` map under key `20260618000000_consolidated_models` (PR #217).

**Registered ≠ applied.** To apply to prod, from the authed app tab run:
```js
fetch('/api/system/apply-pending-migration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'20260618000000_consolidated_models'}),credentials:'include'})
```
then confirm with `prisma migrate status`. DDL is idempotent — safe to re-run.
DDL ↔ `schema.prisma` parity verified for all 10 tables (column names/types,
nullability, defaults, `@unique`, indexes, FK `onDelete`).

### `0003_ambition_engine` — ✅ APPLIED 2026-05-30 (via endpoint)

Ambition Engine P1 (the `/stats` goals redesign · 8 additive `life_goals`
columns + a `goal_stats` join table + a self-relation). Applied to production
Neon on 2026-05-30 through the guarded endpoint described above, recorded in
`_prisma_migrations` as `0003_ambition_engine`; the schema fields were restored
+ shipped in `e285e9dc`. Left in this folder on purpose (see the header note in
`0003_ambition_engine/migration.sql`) — moving it into `prisma/migrations/`
could trip migrate-deploy ordering. Drift-safe: the apply is already recorded
and `migrate deploy` only touches the live folder.

### `20260508001336_add_updated_at_to_8_mutable_models`

Originally shipped at v10.0.462. The deploy sequence assumed
`pnpm release:db` had been run against production before the code
was pushed · in fact the local DATABASE_URL pointed at a
non-running localhost:5432, so the migration never reached
production Neon. Production tables (`brain_dumps`, `mission_links`,
`WorkResult`, `mastery_scores`, `body_tracking`, `financial_snapshots`,
`contradictions`, `vector_embeddings`) didn't get the `updated_at`
column, but the deployed Prisma client expected it · every CRUD on
those tables failed at runtime with "column does not exist" until
v10.0.473 rolled the schema back.

When restoring this migration · the schema additions are:

```prisma
// MissionLink, MasteryScore, BodyTracking, FinancialSnapshot,
// BrainDump, Contradiction · @map("updated_at") column name
updatedAt DateTime @updatedAt @map("updated_at")

// WorkResult, VectorEmbedding · default PascalCase column "updatedAt"
updatedAt DateTime @updatedAt
```

The audit trail for which models needed this is in the v10.0.462
commit body (HEAD~10 from this README · `git log --grep "v10.0.462"`).

The 8 confirmed-mutable models came out of a code-explorer agent
audit at v10.0.462 (1 already-tracked-via-editedAt: ChatMessage ·
2 immutable-zero-update-sites: CommandResolution · ToolVerbRatio).
