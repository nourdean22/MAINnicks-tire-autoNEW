# Runbook · TiDB Cloud backup + restore (nicks-tire-auto prod)

> 2026-07-28 (NL-6). This database holds the shop's operating truth —
> $1.46M of invoice history, customers, consent state, the opportunity
> queue. Staleness markers: [STABLE] safe to follow · [CHECK] verify in
> the TiDB Cloud console — plan-level settings are NOT verifiable from
> the repo and must never be assumed.

## What protects us today [CHECK — verify each in console]

- TiDB Cloud Serverless takes automatic daily backups with a retention
  window; the exact cadence + retention for THIS cluster must be read
  from Console → Backup. Record what you find here with a date.
- Point-in-time restore availability is plan-dependent — [CHECK] and
  record.
- A repo-managed external dump job exists since 2026-10-17 (next
  section) but is OFF until `TIDB_BACKUP_ENABLED=true`. While it is off,
  the console backups are the ONLY line of defense — treat any
  "just clean up the table" script accordingly (see the
  agent-destructive-script incident, 2026-07: 870 prod rows deleted by
  a "verification" run).

## Independent nightly backup (repo-managed) [CHECK the flag before relying on it]

Added 2026-10-17 (JOB 2026-10-17-tidb-independent-backup). The free TiDB Cloud
Starter tier keeps 1 day of backups, has no point-in-time restore, and cannot
restore a deleted instance (docs.pingcap.com/tidbcloud/backup-and-restore-serverless,
read 2026-10-17). This job is the copy that survives all three.

- **What:** cron job `tidb-backup`, tier `nightly`, ET slot 03:30-06:00, claimed
  once per ET night (wall-clock slot CAS + cron lock). Code: `server/services/tidbBackup.ts`.
- **Where:** private Railway bucket, `backups/tidb/<YYYY-MM-DD>/`: one
  `<table>.jsonl.gz` per table (each line a JSON array of the row's values as text,
  binary columns hex) and `manifest.json` (rows, bytes, sha256, `SHOW CREATE TABLE`
  DDL, columns, key, started/finished, job version). The public `/generated/*`
  proxy refuses every `backups/` key (`server/storage.ts`).
- **Classes:** every table nightly, except two derived tables copied weekly (when the
  last set holding them is 7+ days old): `search_performance` (GSC mirror, re-fetchable
  for 16 months) and `revenue_reconciliation_candidates` (re-derived every 2h from
  nightly tables). The manifest's `skipped` list names them with the reason.
- **Retention:** 14 newest complete sets + 8 newest weekly sets. Deletes only keys
  inside `backups/tidb/<date>/`; anything else in the bucket is never touched.
- **Success = completion:** cron_log `completed` only after every file and the
  manifest are confirmed in the bucket listing at their recorded sizes. Each table
  gets 2 retries (10s, 30s backoff); a table that still fails fails the run with the
  table named and writes no manifest. A night without a manifest is re-claimed by a
  later container in the same 03:30-06:00 window once the last claim is 30+ minutes
  old (nightly tier only; the other wall-clock tiers send and stay once-per-day).
  A retention (delete) error after a verified set is a WARNING in the run's details,
  not a failed night.
- **Columns:** only true generated columns (EXTRA `VIRTUAL GENERATED` / `STORED
  GENERATED`) are left out, each listed with its reason in the manifest's
  `excludedColumns`. `DEFAULT_GENERATED` columns (DEFAULT now(), uuid()) are kept.
- **Alert:** the hourly `safety-check` sends a CRITICAL Telegram when the flag is on
  and no `tidb-backup` run completed in 27h (a failed night and a missed night look
  the same), or when it never completed.
- **Switch:** `TIDB_BACKUP_ENABLED=true` (exactly). Default OFF.

### Turning it on (manager, with Nour's go)

1. After merge and deploy, one manual run (reads prod, writes the bucket):
   `railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/tidb-backup-run-once.mts --execute`
   (from `apps/nickstire`; without `--execute` it is a dry run that connects to nothing).
2. Verify the set without touching any database:
   `railway run -s MAINnicks-tire-auto -- node scripts/tidb-restore-from-backup.mjs --verify-only --date <ET date of step 1>`
3. Read the RU cost in TiDB Cloud console (Usage) for the hour of step 1, and the
   `cron_log` row (`job_name='tidb-backup'`, status, duration, details).
4. Only then set `TIDB_BACKUP_ENABLED=true` on the Railway service.

### RU estimate [INFERRED until step 3 measures it]

TiDB Cloud Starter pricing (pingcap.com/tidb-cloud-starter-pricing-details, read
2026-10-17): free 50M RUs per instance per month (250M per organization); a free
instance is throttled when the quota runs out. Reads cost 1 RU per 1 KiB of network
egress on the public endpoint, plus 1 RU per 64 KiB of read payload, per 8 read
requests and per 2 read batches. Egress dominates: a full pass of the ~203 MB
database is about 0.2M RU (up to ~0.5M if the wire size is 2-2.5x the stored size).
With the two weekly tables (~164 MB) out of the nightly pass: ~40 MB nightly is
~1.2M RU/month plus ~0.7M RU/month for the weekly copies, so about 2-5M RU/month,
4-10% of the free quota. The app's own monthly RU use is NOT CHECKED; read it in the
console before arming, because exhausting the quota throttles the whole shop app.

### Restore

1. Verify first (no database): `node scripts/tidb-restore-from-backup.mjs --verify-only --date <date>`.
2. Dry run (default, connects to nothing):
   `node scripts/tidb-restore-from-backup.mjs --date <date> --target-url mysql://user:pw@host:port/scratch_db --tables invoices,customers`
3. Add `--execute`. The script checks sha256 and row counts before writing, CREATEs
   each table from the manifest DDL (refuses a table that already exists), inserts in
   batches with the backup's time zone, and checks `COUNT(*)` against the manifest.
   It never drops, truncates or updates.
4. Copy the needed rows forward into prod by primary key, per the decision tree below.

A night that skipped the weekly tables does not hold them. Restoring or verifying
that set ends **INCOMPLETE (exit 3)** and prints the exact command for the set that
holds them (`--date <weekly set> --tables search_performance,...`). Exit codes:
0 complete, 1 error, 2 refused, 3 incomplete.

The target is REFUSED when its host equals or contains the production host in
`DATABASE_URL` (and when `DATABASE_URL` is unknown). Hosts are compared after
percent-decoding (as mysql2 dials them), and IP-literal hosts are refused: use
`localhost` or a host name. Known limit: TiDB Cloud Starter
clusters in one region share one gateway host, so a new cluster in the production
region is refused too. Restore into another region, a local MySQL 8 or TiDB, or ask
for a rule scoped by the username's cluster prefix.

## Restore decision tree [STABLE]

1. **Single rows / one table damaged** (the common agent-mistake case):
   do NOT restore the cluster. Restore the backup to a NEW cluster
   (console → Restore → new cluster), point a read-only session at it,
   and copy the damaged rows forward with explicit INSERT…SELECT by
   primary key. Verify counts before and after with the read-only
   diagnostic pattern (scratchpad SELECT script, DOTENV preload).
2. **Whole database corrupted**: restore to a new cluster, verify the
   critical tables (invoices count ≈ expected, customers, sms consent
   columns, revenue_opportunities), then repoint `DATABASE_URL` on
   Railway (service MAINnicks-tire-auto) and redeploy. The app's
   schema guard + /api/health criticalSchema will confirm table
   presence on boot.
3. **Never** run a restore INTO the live cluster while the app is
   writing — stop the Railway service first (deploys → remove, or
   pause), restore, verify, then start.

## Verification drill [STABLE — run quarterly, ~20 min]

The backup you have never restored is a hope, not a backup:

1. Console → restore latest backup to a throwaway cluster.
2. Read-only checks against it:
   `SELECT COUNT(*) FROM invoices;` ·
   `SELECT MAX(invoiceDate) FROM invoices;` ·
   `SELECT COUNT(*) FROM customers WHERE smsOptOut = 1;`
   Compare against prod's numbers from the same morning.
3. Record the drill (date, counts, minutes taken) in this file's log
   below. Delete the throwaway cluster.

## Drill log

| Date | Restored to | invoices | max date | optOuts | minutes | by |
|---|---|---|---|---|---|---|
| _none yet — first drill pending_ | | | | | | |

## Standing warnings [STABLE]

- `.env`'s DATABASE_URL is prod but `.env` is NOT prod config — verify
  runtime behavior via cron_log//api/health, never by grepping env.
- STRICT_TRANS_TABLES: out-of-enum writes are REJECTED and the row is
  lost — a restore script must use exact enum values.
- DDL on TiDB: additive, idempotent, INFORMATION_SCHEMA-guarded
  (`scripts/migrations/*` pattern); TiDB needs two separate ALTERs
  where MySQL allows one combined.
