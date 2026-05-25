/**
 * VAPI Recordings Export · for bulk re-transcription via Whisper
 *
 * Category 5 of docs/eval-rubrics/huggingface-model-strategy.md.
 * Walks vapi_call_logs · exports a JSONL of recordings that need
 * (re-)transcription. Audit finding #321 wanted a richer eval corpus ·
 * this script is the export side · the Modal Whisper job writes back.
 *
 * Selection logic (configurable via CLI flags):
 *   - Only rows with non-null recordingUrl (without audio, nothing to do)
 *   - Default · skip rows where transcriptUrl is already set (idempotent re-run)
 *   - --force-all · re-transcribe every recording regardless of existing transcript
 *   - --eval-low-scores · only rows with evalScore < 50 (the "wasted" bucket
 *      that might be worth re-evaluating with better transcription)
 *   - --days N · only rows from last N days (default: all-time)
 *
 * Output: `data/training/vapi-recordings-YYYYMMDD.jsonl`
 *
 * Each line: { vapiCallId, recordingUrl, durationSeconds, phoneNumber?, customerName? }
 *
 * Usage:
 *   pnpm tsx scripts/export-vapi-recordings.ts                       # default
 *   pnpm tsx scripts/export-vapi-recordings.ts --force-all
 *   pnpm tsx scripts/export-vapi-recordings.ts --eval-low-scores --days 90
 *   pnpm tsx scripts/export-vapi-recordings.ts --output custom.jsonl --dry-run
 *
 * Next steps after export · run docs/runbooks/bulk-whisper-retranscribe.md
 * to process the JSONL through Modal + Whisper-large-v3-turbo.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

interface CliArgs {
  forceAll: boolean;
  evalLowScores: boolean;
  days: number;
  output: string;
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): CliArgs {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const args: CliArgs = {
    forceAll: false,
    evalLowScores: false,
    days: 0, // 0 means all-time
    output: `data/training/vapi-recordings-${today}.jsonl`,
    dryRun: false,
    limit: 0, // 0 means unlimited
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force-all") args.forceAll = true;
    else if (a === "--eval-low-scores") args.evalLowScores = true;
    else if (a === "--days") args.days = Number(argv[++i]);
    else if (a === "--output") args.output = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`usage: pnpm tsx scripts/export-vapi-recordings.ts [options]
  --force-all            re-transcribe every recording (else skip rows where transcriptUrl is set)
  --eval-low-scores      only rows with evalScore < 50 (the "wasted" bucket)
  --days N               last N days (default: all-time)
  --output PATH          output JSONL path (default data/training/...)
  --limit N              cap rows for testing
  --dry-run              compute stats, don't write file`);
      process.exit(0);
    }
  }
  return args;
}

interface VapiRow {
  vapiCallId: string;
  recordingUrl: string | null;
  durationSeconds: number;
  phoneNumber: string | null;
  customerName: string | null;
  transcriptUrl: string | null;
  evalScore: number | null;
  createdAt: Date;
}

async function fetchRows(args: CliArgs): Promise<VapiRow[]> {
  const { getDb } = await import("../server/db");
  const { vapiCallLogs } = await import("../drizzle/schema");
  const { and, gte, isNotNull, isNull, lt, sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("Database connection not available");

  const conditions = [isNotNull(vapiCallLogs.recordingUrl)];
  if (!args.forceAll) {
    conditions.push(isNull(vapiCallLogs.transcriptUrl));
  }
  if (args.evalLowScores) {
    conditions.push(lt(vapiCallLogs.evalScore, 50));
  }
  if (args.days > 0) {
    const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
    conditions.push(gte(vapiCallLogs.createdAt, cutoff));
  }

  const query = db
    .select({
      vapiCallId: vapiCallLogs.vapiCallId,
      recordingUrl: vapiCallLogs.recordingUrl,
      durationSeconds: vapiCallLogs.durationSeconds,
      phoneNumber: vapiCallLogs.phoneNumber,
      customerName: vapiCallLogs.customerName,
      transcriptUrl: vapiCallLogs.transcriptUrl,
      evalScore: vapiCallLogs.evalScore,
      createdAt: vapiCallLogs.createdAt,
    })
    .from(vapiCallLogs)
    .where(and(...conditions))
    .orderBy(sql`${vapiCallLogs.createdAt} ASC`);

  const rows = args.limit > 0 ? await query.limit(args.limit) : await query;
  return rows as VapiRow[];
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[export-vapi-recordings] selection: forceAll=${args.forceAll} evalLowScores=${args.evalLowScores} days=${args.days} limit=${args.limit || "unlimited"}`);

  const rows = await fetchRows(args);
  console.log(`[export-vapi-recordings] candidate rows: ${rows.length}`);

  if (rows.length === 0) {
    console.log(`[export-vapi-recordings] nothing to do · exiting`);
    return;
  }

  // Stats
  const totalSeconds = rows.reduce((s, r) => s + (r.durationSeconds || 0), 0);
  console.log(`[export-vapi-recordings] total audio: ${(totalSeconds / 3600).toFixed(2)} hours`);
  console.log(`[export-vapi-recordings] estimated Whisper cost on Modal A10G: ~$${((totalSeconds / 60) * 0.005).toFixed(2)} ($0.005/min · 8x realtime)`);

  if (args.dryRun) {
    console.log(`[export-vapi-recordings] --dry-run · skipping write`);
    return;
  }

  // Write JSONL
  const lines = rows.map((r) =>
    JSON.stringify({
      vapiCallId: r.vapiCallId,
      recordingUrl: r.recordingUrl,
      durationSeconds: r.durationSeconds,
      phoneNumber: r.phoneNumber ?? null,
      customerName: r.customerName ?? null,
      hadTranscript: Boolean(r.transcriptUrl),
      evalScore: r.evalScore ?? null,
      createdAt: r.createdAt.toISOString(),
    }),
  );
  const outPath = resolve(args.output);
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  console.log(`[export-vapi-recordings] ✓ wrote ${rows.length} rows to ${outPath}`);
  console.log(`[export-vapi-recordings] next step · docs/runbooks/bulk-whisper-retranscribe.md (Modal job)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
