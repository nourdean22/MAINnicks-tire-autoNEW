# Shop-clock backfill

Corrects shop-day dates that app writers stored as UTC digits. Tool: `scripts/backfills/backfill-shop-clock.ts`
(CLI) over `scripts/backfills/shopClockBackfill.ts` (pure classifier). Tests:
`server/__tests__/shopClockBackfill.test.ts` and `shopClockBackfillCli.test.ts`.

## What it fixes, and what it leaves alone

Until 2026-10-14 several writers stored `new Date()` (the UTC clock digits) in shop-day columns, so an
evening row landed on the next shop day. The shop-day convention is the Cleveland wall-clock digits
(`shopWallClock`, `server/lib/timezoneAssert.ts`). The writers are fixed (#3037, and the Snap double
conversion in #3045). This tool corrects the history.

| Table.column | Scanned | Corrected when |
|---|---|---|
| `invoices.invoiceDate` | all rows | digits match `createdAt` AND `source` is `manual` or `stripe` (`--sources`) |
| `alg_estimates.estimate_date` | all rows | same, but only for sources named in `--estimate-sources` (default: none) |

Rows owned by a feed are never planned. `invoices.source = 'shopdriver'` and the `alg`, `alg-historical`
and `wave-97-recovery` estimates carry the ALG feed's own timestamps; the ShopDriver mirror rewrites
`invoiceDate` on every sync of an existing row (`shopDriverMirror.ts`, the `updates.invoiceDate` line), so a
correction would be reverted, and most of those rows do not change shop day anyway. They are reported as
`feed_owned_utc` and the tool refuses a feed name (any letter case) in `--sources` / `--estimate-sources`.

For an app-written source the digit signature alone decides: a row whose seconds are `00` is planned like
any other. The corrected value is the Cleveland wall clock of the **stored** digits (`shopWallClock(stored)`);
`createdAt` only proves the row came from the UTC-clock writer. A row stored 03:55Z with `createdAt` 04:05Z
moves to 23:55 on the PRIOR day, not to 00:05. The one exception is a Snap row (`snap_double_converted`): its
stored value was converted twice, so its target is the wall clock of `createdAt`. Left alone on purpose: `review_replies.approved_at` and `reel_publish_approvals.approved_at` are
event instants on the DB clock, used for ages and TTL, not shop-day columns.

## Expected size: about 8 rows

A SELECT-only look at production on 2026-10-15 (reported to this job, not re-run by it) found 8 `manual`
invoices with UTC digits, no Snap rows, and no app-written estimate rows. The plan should hold roughly that
many rows, all `invoices`.

**A much larger plan means stop and report.** It points at a mislabelled source, a wrong `--cutoff`, or a
writer that is still on the UTC clock. Do not snapshot or apply it.

## Warning: invoiceDate feeds customer-SMS crons

Moving `invoiceDate` earlier can move an invoice across an age threshold in a cron that texts customers.
Run `apply` once, after reading the plan, and read the rows first.

- `cron/jobs/unpaidInvoiceRecovery.ts` reads `invoiceDate` of any source for `pending` / `partial` invoices
  (7 to 90 days old; 7-day and 30-day reminders, once each). A planned row in that state can become due
  sooner. Check the payment status of every planned id before `apply`. Sends are gated by
  `FEATURE_UNPAID_INVOICE_RECOVERY`.
- `services/invoiceReviewRequests.ts` reads only `source = 'shopdriver'` invoices, so manual rows do not
  reach it.
- Reports and dashboards (`statenourSync`, `dashboardSync`, `morningBrief`, `kpiSnapshot`,
  `weeklyRevenueDigest`) read the date by shop day: history figures change, which was approved.

## How to run it

All commands run from `apps/nickstire`, one plain command per call (the Claude Code auto-mode classifier
blocks compound chains). `railway run` injects `DATABASE_URL`; the tool reads it from the process
environment only (no dotenv), so a stray `.env` cannot pick the database. Railway prints a harmless
`Skipped 1 service variable ... NODE_OPTIONS` line.

Shape: `railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts <subcommand> <flags>`

Classification flags (probe, plan, verify; none has a default except the source lists):

- `--cutoff <ISO>`: the instant the #3037 writer fix went live. Read it from the Railway deployment, with a zone (`2026-10-15T03:15:00Z`). A real calendar instant only (no hour 24, no 30 February).
- `--snap-bug-start <ISO>`: the same instant. `--snap-fix-cutoff <ISO>`: when #3045 went live.
- `--tol-minutes 15`: how close the digits must be (1 to 60).
- `--sources manual,stripe` (default) and `--estimate-sources <list>` (default empty).

Exit codes: 0 done, 1 refused or failed, 2 bad arguments (nothing was connected), 3 `apply` or `rollback`
finished its writes but `updatedAt` moved, or could not be measured, while preserving it was asked for (see
Guards). Exit 3 outranks a `STOPPED` exit 1 when both happen.

1. **probe.** Read-only look. Check the first line, `DB host: <host>  database: <name>`, against what you expect for production. The database name is whatever `probe` prints; nothing else in the repo records it.

   `railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts probe --cutoff <ISO> --snap-bug-start <ISO> --snap-fix-cutoff <ISO> --tol-minutes 15`

2. **plan.** Read-only. Writes the plan file; refuses to overwrite one. Keep it outside the repo.

   `railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts plan --cutoff <ISO> --snap-bug-start <ISO> --snap-fix-cutoff <ISO> --tol-minutes 15 --out <PLAN>`

   Check `planned rows:` (about 8) and `day_changes:`. Exit 1 writes no file when either `FAILED:` line
   prints: an app-written row after the cutoff that still carries UTC digits, or an app-written row sitting a
   whole 8 or 10 hours behind `createdAt` that no class explains. Both stop the run before any snapshot.

3. **Operator go.** `plan` ends with `Show these rows to the operator and wait for an explicit go before
   snapshot or apply:` and one line per planned row:
   `<table>#<id> source=<source> createdAt=<digits> <from> -> <to> <class> day_change=<yes|no>`.
   Show those lines to the operator, add the payment status of each id (see the warning above), and wait
   for an explicit go. A row count alone is not approval. Do not run `snapshot` or `apply` before it.

4. **snapshot.** Run without `--execute` first (prints the SQL, opens no connection), then with it.

   `railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts snapshot --plan <PLAN> --stamp 20261015 --execute`

5. **apply.** Dry run first, then, once:

   `railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts apply --plan <PLAN> --stamp 20261015 --execute`

6. **verify.** Same flags as plan, no `--out`. Expect `verify ok (sources: ...; estimate-sources: ...)`. Read the
   source lists in that line: a list that matches nothing also ends in `verify ok`.

   `railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts verify --cutoff <ISO> --snap-bug-start <ISO> --snap-fix-cutoff <ISO> --tol-minutes 15`

**Rollback** (needs the same plan file and stamp; dry run first):

`railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/backfills/backfill-shop-clock.ts rollback --plan <PLAN> --stamp 20261015 --execute`

## What each subcommand prints

| Subcommand | Output |
|---|---|
| all | `DB host` and `database` first; then `time_zone before pin: global= session= system=`, then `session time_zone pinned: +00:00` (the tool aborts if the session does not report it), then one `schema ok:` line per table |
| probe | per table: row count; `stored - createdAt` histogram (`utc_match`, `minus_4h`, `minus_5h`, `minus_8h`, `minus_10h`, `other`); class counts; per class the min and max `createdAt` and up to 5 sample ids with dates; `feed_owned_utc by source`; post-cutoff rows, how many are `already_correct` and how many are `post_cutoff_utc_match`; per-month counts |
| plan | per table class counts and the first feed-owned ids; then `FAILED` (post-cutoff UTC rows, or unexplained 8h/10h rows) or `planned rows`, per-table `day_changes`, one line per planned row (table, id, source, createdAt, from -> to, class, day_change), the file path and its `sha256` |
| snapshot | dry run: `CREATE TABLE ... LIKE`, `INSERT ... SELECT`; execute: `backup <name>: N rows (plan N)` |
| apply, rollback | dry run: the `UPDATE` and its first parameter sets; execute: one line per batch (`updated`, `already at target`), then `updatedAt moved on N of M rows (expected 0)`, then `apply done` or `STOPPED`; on an updatedAt failure also `FAILED: updatedAt moved ...` or `updatedAt preservation UNVERIFIED: ...`, `Backups kept: ...` and, for apply, the exact rollback command |
| verify | per table class counts, then `verify ok (sources: ...; estimate-sources: ...)` or `FAILED: N row(s) not clean:` with one `table#id label createdAt= stored=` line per row |

Classes: `already_correct`, `needs_correction`, `snap_double_converted`, `post_cutoff_utc_match`,
`feed_owned_utc`, `other`. `needs_correction` and `snap_double_converted` (from an app-written source) are
the only classes that reach the plan.

`verify` is not clean while any row is `needs_correction`, `snap_double_converted` or
`post_cutoff_utc_match`, or is an `other_anomaly`: an app-written row in `other` whose digits sit a whole 8 or
10 hours behind `createdAt` (the double-conversion signature without a Snap marker). Feed-owned rows and
ordinary `other` rows do not count.

## Stop conditions

1. The `DB host` line is not the expected database, or the time zone check aborts.
2. A `schema ok` line is missing, or the tool reports a missing column or an empty table.
3. The plan is much larger than about 8 rows, or lists any non-`invoices` row you did not expect.
4. `plan` prints `FAILED`: an app-written row after the cutoff still has UTC digits (a writer is still wrong
   or the cutoff is wrong), or an app-written row sits 8 or 10 hours behind `createdAt` with no class to
   explain it. Report; do not snapshot or apply.
5. No explicit operator go on the listed rows.
6. `snapshot` says the backup already exists or the counts differ; `apply` or `rollback` says the backup count, ids
   or saved dates differ from the plan, or `apply` prints `STOPPED` (a row no longer holds the value the plan read). `STOPPED`
   rolled back that batch and ran nothing after it; investigate, then re-run `apply`, which resumes
   (rows already at their target are skipped and counted).
7. `verify` prints `FAILED`.
8. `apply` or `rollback` exits 3 (`updatedAt` moved or is unverified): do not run `verify` and move on. Report, keep
   the backups, and decide on the rollback command it printed.

## Guards, as built

- **Read-only is an allowlist, not a session setting.** TiDB rejects `SET SESSION TRANSACTION READ ONLY`
  ("function READ ONLY has only noop implementation"); do not enable `tidb_enable_noop_functions`. probe,
  plan and verify go through a wrapper that allows only a statement starting with `SELECT` or `SHOW`, plus the
  fixed `SET time_zone = '+00:00'`. It rejects any `;`, any comment (`/* */`, `--`, `#`) and the words
  INSERT, UPDATE, DELETE, REPLACE, CREATE, DROP, TRUNCATE, ALTER, RENAME, GRANT, REVOKE, CALL, LOAD, LOCK,
  SHARE, OUTFILE, DUMPFILE. The driver keeps `multipleStatements` off.
- **Time zone is pinned, not trusted.** Dates are read as strings (`dateStrings`) and written as digit
  strings, never `Date` objects, after `SET time_zone = '+00:00'` and a check of `@@session.time_zone`.
- **Writes need `--execute`.** snapshot, apply and rollback print their SQL and return before the connection
  is opened. A misspelled flag or subcommand is a usage error, not a quiet dry run.
- **The plan is hashed and tied to its database.** Its `sha256` covers the arguments, host, database, count
  and rows; snapshot, apply and rollback refuse an edited file or a different host or database.
- **Backup first.** `_bak_<table>_shopclock_<stamp>` is built with `CREATE TABLE ... LIKE` then
  `INSERT ... SELECT`, because TiDB rejects `CREATE TABLE ... AS SELECT`. The row count must equal the plan
  and `apply` and `rollback` also require the backup to hold exactly the plan's ids and, for every row, the
  original date the plan read, before anything is written. The tool never drops a backup; drop
  them by hand once the correction is confirmed, on an explicit operator go.
- **Compare-and-swap, in batches of 200.** Each row is `UPDATE ... SET <date> = ? WHERE id = ? AND <date> = ?`
  on the value that was read, one transaction per batch; the first miss rolls that batch back and stops.
- **`updatedAt` is preserved by self-assignment** (`--preserve-updated-at true`, the default), which relies on
  MySQL's rule that assigning a column to itself stops its `ON UPDATE CURRENT_TIMESTAMP`. That rule is
  **unverified on TiDB until the line `updatedAt moved on N of M rows (expected 0)` prints 0.** The line is
  measured after the last batch by joining the backup (which holds the original `updatedAt`) to the live
  table by id. With the default, a nonzero count fails the command with exit 3: it prints
  `FAILED: updatedAt moved on N of M rows ...`, keeps the backups, and for `apply` prints the exact
  `rollback` command. If the measurement cannot run or its result cannot be read, the command also exits 3
  with `updatedAt preservation UNVERIFIED`; the dates it wrote stay written. A nonzero count means TiDB
  ignored the self-assignment, or another writer touched the rows meanwhile. `--preserve-updated-at false`
  lets it move and keeps the line informational (`expected any`). Nothing in the app reads
  `invoices.updatedAt` or `alg_estimates.updated_at` (only payment and refund writers set it).

## If the correction has to be undone

`rollback` restores the original digits from the backup table by id, with a compare-and-swap on the value the
plan wrote, so a row someone edited since is reported instead of overwritten. It refuses if the backup no
longer holds the plan's original value or ids.

Use the same `--preserve-updated-at` value on `rollback` as on `apply`: the updatedAt check compares the live
rows with the backup. `rollback` restores the date only; the original `updatedAt` values stay in the backup tables.

## Not part of this tool

`scripts/backfills/backfill-historical-estimates.ts` is an ALG-API import into `alg_estimates`, not a
correction tool, and a `--commit` run can queue recovery SMS (see its header). Do not run it for this job.
