/**
 * Production wiring for the nightly TiDB backup (services/tidbBackup.ts): a
 * dedicated mysql2 connection (UTC session, every value as text) and the
 * private bucket. Kept apart from the core so the core is testable without a
 * database and every one of its exports has a production caller here.
 */
import { backupTypeCast, createMysqlBackupSource, createS3BackupStore, manifestKeyFor, runTidbBackup, type BackupRunResult } from "./tidbBackup";

/** The cron entry (tier `nightly`, and the manual-run registry). */
export async function runTidbBackupJob(): Promise<BackupRunResult> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("tidb-backup: DATABASE_URL is not set");
  const { getPrivateBucket } = await import("../storage");
  const { s3, bucket } = await getPrivateBucket();
  const mysql = (await import("mysql2/promise")).default;
  const conn = await mysql.createConnection({ uri: url, typeCast: backupTypeCast as never, connectTimeout: 20_000 });
  try {
    await conn.query("SET time_zone = '+00:00'");
    const [dbRows] = (await conn.query("SELECT DATABASE() AS db")) as unknown as [Array<{ db: string | null }>];
    const database = String(dbRows[0]?.db ?? "");
    return await runTidbBackup({ source: createMysqlBackupSource(conn as never, database), store: createS3BackupStore(s3, bucket) });
  } finally {
    await conn.end().catch(() => { /* connection already gone; the run's own result stands */ });
  }
}

/**
 * Is the ET night `dayKey` done, as far as the nightly wall-clock slot is
 * concerned? Done = the job is switched off (nothing to retry) or that night's
 * manifest is in the bucket. A failed bucket read throws; the slot treats that
 * as not done and retries, which is safe because a run with the manifest present
 * is a no-op.
 */
export async function isNightlyBackupComplete(dayKey: string): Promise<boolean> {
  if (process.env.TIDB_BACKUP_ENABLED !== "true") return true;
  const { getPrivateBucket } = await import("../storage");
  const { s3, bucket } = await getPrivateBucket();
  const key = manifestKeyFor(dayKey);
  return (await createS3BackupStore(s3, bucket).list(key)).some((o) => o.key === key);
}
