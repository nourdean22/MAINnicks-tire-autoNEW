/**
 * One manual run of the nightly TiDB backup (server/services/tidbBackup.ts).
 *
 * Goes through runJobByName, so it takes the same cross-dyno cron lock as the
 * nightly tier and writes the same cron_log row (a completed manual run counts
 * as the night's backup for the freshness alert). It ignores TIDB_BACKUP_ENABLED:
 * this is the operator's deliberate first run that measures the RU cost before
 * the flag is armed.
 *
 * READS the production database and WRITES backups/tidb/<ET date>/ to the bucket.
 * DRY RUN by default: prints what it would do and exits before importing the
 * database or bucket code.
 *
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/tidb-backup-run-once.mts            # dry run
 *   railway run -s MAINnicks-tire-auto -- pnpm exec tsx scripts/tidb-backup-run-once.mts --execute  # real run
 */
const execute = process.argv.includes("--execute");

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "(DATABASE_URL not set)";
  } catch {
    return "(DATABASE_URL not parsable)";
  }
}

if (!execute) {
  process.stdout.write(
    `DRY RUN: would read every table of ${hostOf(process.env.DATABASE_URL)} and write backups/tidb/<ET date>/ to bucket ${process.env.S3_BUCKET ?? "(S3_BUCKET not set)"}.\n` +
      "Nothing was connected. Re-run with --execute.\n",
  );
  process.exit(0);
}

const { runJobByName } = await import("../server/cron/index");
const started = Date.now();
const result = await runJobByName("tidb-backup");
process.stdout.write(`${JSON.stringify({ ...result, seconds: Math.round((Date.now() - started) / 1000) })}\n`);
// shortcut: runJobByName writes its cron_log row fire-and-forget; give it 5s before exiting. Check the row (step 3 in the runbook).
await new Promise((resolve) => setTimeout(resolve, 5000));
process.exit(result.status === "completed" ? 0 : 1);
