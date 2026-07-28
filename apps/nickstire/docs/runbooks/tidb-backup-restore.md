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
- There is currently NO repo-managed external dump job. Until one
  exists, the console backups are the ONLY line of defense — treat any
  "just clean up the table" script accordingly (see the
  agent-destructive-script incident, 2026-07: 870 prod rows deleted by
  a "verification" run).

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
