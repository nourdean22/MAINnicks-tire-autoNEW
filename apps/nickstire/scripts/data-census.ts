/**
 * Historical data census — nickstire (2026-08-06, next-wave charter item 1).
 *
 * Machine-readable inventory of what already exists, BEFORE any mass
 * backfill: per source — row count, time range, PII class, retention risk,
 * backfill priority. "This prevents building another backfill for data that
 * already has one."
 *
 * READ-ONLY: information_schema estimates + MIN/MAX on each table's own
 * timestamp column. Coverage metrics (identity/outcome linkage rates) are
 * deliberately NOT fabricated here — they need per-source join logic and
 * belong to each source's backfill spec; a census that guesses coverage
 * numbers poisons the prioritization it exists to serve.
 *
 * PII/priority annotations are curated from verified findings (90d call
 * report, revenue-truth arc, Ossuary, experiment wiring), not inferred.
 *
 * Run:  pnpm exec tsx scripts/data-census.ts
 * Output: eval-datasets/data-census-nickstire.json + console readout.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function loadEnvFromDotenv(): void {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* shell may already carry the vars */ }
}
loadEnvFromDotenv();

interface SourceSpec {
  table: string;
  timeColumn: string | null;
  containsPII: boolean;
  retentionRisk: "LOW" | "MEDIUM" | "HIGH";
  backfillPriority: number; // 1 = highest
  notes: string;
}

/** Curated from verified findings — annotate, never guess. */
const SOURCES: SourceSpec[] = [
  { table: "vapi_call_logs", timeColumn: "createdAt", containsPII: true, retentionRisk: "HIGH", backfillPriority: 1, notes: "2,448 calls/90d; evals+signals persisted; raw transcripts were LOST pre-Ossuary (0109) — history before 2026-07-23 is unrecoverable upstream" },
  { table: "vapi_call_archives", timeColumn: "archived_at", containsPII: true, retentionRisk: "LOW", backfillPriority: 1, notes: "the Ossuary (0109, applied 2026-08-06) — self-backfills the surviving 14d window; grows ~27/day" },
  { table: "sms_messages", timeColumn: "createdAt", containsPII: true, retentionRisk: "MEDIUM", backfillPriority: 2, notes: "full SMS history; export-sms-corpus.ts already exists (corpus lane precedent)" },
  { table: "sms_conversations", timeColumn: "createdAt", containsPII: true, retentionRisk: "MEDIUM", backfillPriority: 3, notes: "conversation spine for identity linking" },
  { table: "customers", timeColumn: "createdAt", containsPII: true, retentionRisk: "LOW", backfillPriority: 2, notes: "identity anchor; 77% one-and-done VERIFIED (2026-07-19) — retention assumptions must respect this" },
  { table: "invoices", timeColumn: "createdAt", containsPII: true, retentionRisk: "LOW", backfillPriority: 1, notes: "$1.39M / 2,888+ invoices — the revenue ground truth every outcome joins against" },
  { table: "leads", timeColumn: "createdAt", containsPII: true, retentionRisk: "MEDIUM", backfillPriority: 2, notes: "call→lead→booking→invoice chain member" },
  { table: "bookings", timeColumn: "createdAt", containsPII: true, retentionRisk: "LOW", backfillPriority: 2, notes: "appointment truth for show-rate reconstruction" },
  { table: "callback_requests", timeColumn: "createdAt", containsPII: true, retentionRisk: "MEDIUM", backfillPriority: 2, notes: "28% of VAPI forwards redial ≤15m (90d report) — the failure taxonomy source" },
  { table: "alg_estimates", timeColumn: "estimate_date", containsPII: true, retentionRisk: "MEDIUM", backfillPriority: 2, notes: "declined-work intelligence: offered vs accepted vs later conversion" },
  { table: "customer_events", timeColumn: "createdAt", containsPII: true, retentionRisk: "LOW", backfillPriority: 3, notes: "~4.7k rows, funnel truth (analytics memory: umami DEAD, this is canonical)" },
  { table: "ig_autopost_log", timeColumn: "createdAt", containsPII: false, retentionRisk: "LOW", backfillPriority: 2, notes: "116+ posts w/ self-eval scores; shadowJudge verdicts accumulate here since #1389/#1395" },
  { table: "ig_metric_snapshots", timeColumn: "capturedAt", containsPII: false, retentionRisk: "LOW", backfillPriority: 2, notes: "engagement truth; consumed by content-experiment-resolve since #1384" },
  { table: "content_experiments", timeColumn: "started_at", containsPII: false, retentionRisk: "LOW", backfillPriority: 4, notes: "registry wired end-to-end #1384; empty until operator starts hook_style_v1" },
  { table: "content_experiment_assignments", timeColumn: "assigned_at", containsPII: false, retentionRisk: "LOW", backfillPriority: 4, notes: "arm lineage per episode" },
  { table: "reel_jobs", timeColumn: "createdAt", containsPII: false, retentionRisk: "LOW", backfillPriority: 3, notes: "reel pipeline states; status column varchar(20) headroom trap (skill note)" },
  { table: "autonomy_audit_events", timeColumn: "occurred_at", containsPII: false, retentionRisk: "LOW", backfillPriority: 3, notes: "publishAttemptLedger + kill-switch + approval audit spine - proves attempts, never absence (winback lesson)" },
  { table: "cron_log", timeColumn: "started_at", containsPII: false, retentionRisk: "MEDIUM", backfillPriority: 3, notes: "~2,600 rows/day; loop-shape verdicts ride observer details since #1385; growth needs a retention policy eventually" },
  { table: "conversation_memory", timeColumn: "createdAt", containsPII: true, retentionRisk: "LOW", backfillPriority: 4, notes: "SMS conversation memory; nickMemory lessons live inside shop_settings kv, not a table (census finding)" },
];

interface CensusRow {
  sourceId: string;
  domain: "nickstire";
  recordCount: number | null;
  oldestRecordAt: string | null;
  newestRecordAt: string | null;
  containsPII: boolean;
  retentionRisk: string;
  backfillPriority: number;
  notes: string;
  error?: string;
}

async function main() {
  const { getDb } = await import("../server/db");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { sql } = await import("drizzle-orm");
  const { rowsFromExecute } = await import("../server/cron/jobs/vapiCallEval");

  const rows: CensusRow[] = [];
  for (const s of SOURCES) {
    const base: CensusRow = {
      sourceId: s.table, domain: "nickstire", recordCount: null,
      oldestRecordAt: null, newestRecordAt: null,
      containsPII: s.containsPII, retentionRisk: s.retentionRisk,
      backfillPriority: s.backfillPriority, notes: s.notes,
    };
    try {
      const countRes = await d.execute(sql.raw(`SELECT COUNT(*) AS n FROM \`${s.table}\``));
      base.recordCount = Number(rowsFromExecute<{ n: unknown }>(countRes)[0]?.n ?? 0);
      if (s.timeColumn && base.recordCount > 0) {
        const rangeRes = await d.execute(sql.raw(
          `SELECT MIN(\`${s.timeColumn}\`) AS oldest, MAX(\`${s.timeColumn}\`) AS newest FROM \`${s.table}\``,
        ));
        const r = rowsFromExecute<{ oldest: unknown; newest: unknown }>(rangeRes)[0];
        base.oldestRecordAt = r?.oldest ? new Date(r.oldest as string).toISOString() : null;
        base.newestRecordAt = r?.newest ? new Date(r.newest as string).toISOString() : null;
      }
    } catch (err) {
      base.error = err instanceof Error ? err.message.slice(0, 120) : String(err);
    }
    rows.push(base);
    console.log(`  ${s.table}: ${base.error ? `ERROR ${base.error}` : `${base.recordCount} rows · ${base.oldestRecordAt?.slice(0, 10) ?? "?"} → ${base.newestRecordAt?.slice(0, 10) ?? "?"}`}`);
  }

  const outDir = join(process.cwd(), "eval-datasets");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "data-census-nickstire.json");
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), domain: "nickstire", sources: rows }, null, 2));
  const errors = rows.filter((r) => r.error).length;
  console.log(`\ncensus: ${rows.length} sources · ${errors} errors → ${outPath}`);
  if (errors) console.log("errors are FINDINGS (renamed/missing tables) — fix the spec, do not hide them");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[data-census] fatal:", err);
  process.exit(1);
});
