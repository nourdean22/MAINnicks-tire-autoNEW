/**
 * Historical data census — statenour (2026-08-06, parity with nickstire's
 * #1398 census).
 *
 * Machine-readable inventory of what already exists, BEFORE any backfill:
 * per source — row count, time range, PII class, retention risk, backfill
 * priority. READ-ONLY prisma counts + min/max createdAt. Coverage metrics
 * are deliberately NOT fabricated (they belong to per-source backfill
 * specs). Unknown model names error loudly — an error row is a FINDING
 * (renamed/absent model), never hidden.
 *
 * Run:  pnpm exec tsx scripts/data-census.ts
 * Output: eval-datasets/data-census-statenour.json + console readout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../lib/prisma";

interface SourceSpec {
  model: string;
  containsPII: boolean;
  retentionRisk: "LOW" | "MEDIUM" | "HIGH";
  backfillPriority: number;
  notes: string;
}

/** Curated from verified findings — annotate, never guess. */
const SOURCES: SourceSpec[] = [
  { model: "brainMemory", containsPII: true, retentionRisk: "LOW", backfillPriority: 1, notes: "the brain: memories + reply_judgment + suggestion_loop + comparison runs + coach_event all live here by category (coach events are NOT a separate model — census finding); fact-age stamps at recall since #1388" },
  { model: "prediction", containsPII: true, retentionRisk: "LOW", backfillPriority: 1, notes: "Brier lane; operator forecasts ride metadata.author since #1393; expired_unverifiable excluded from calibration since #1399" },
  { model: "chatMessage", containsPII: true, retentionRisk: "MEDIUM", backfillPriority: 2, notes: "full chat history; feedbackScore thumbs = 32 lifetime (prod-verified 2026-08-06) — operator-label scarcity is structural" },
  { model: "agentTrace", containsPII: true, retentionRisk: "MEDIUM", backfillPriority: 2, notes: "~90 importers write here (provider/model/durationMs/errorClass); OTel export manual-only (WP-20)" },
  { model: "intelligenceOutcome", containsPII: true, retentionRisk: "LOW", backfillPriority: 1, notes: "the UPSTREAMS fine-tune trigger counts THIS table's corrections: 0/200 (prod-verified) — the gate that parks training" },
  { model: "systemMetric", containsPII: false, retentionRisk: "MEDIUM", backfillPriority: 3, notes: "quality_bench.pass_rate baseline lives here since #1386; shadow-prompt rows frozen since the V2 cutover (stale-producer trap)" },
  { model: "cronJobLog", containsPII: false, retentionRisk: "MEDIUM", backfillPriority: 3, notes: "liveness spine; self-row-first pattern since the 07-28 drift incident" },
  { model: "vectorEmbedding", containsPII: true, retentionRisk: "HIGH", backfillPriority: 2, notes: "pgvector lives OUTSIDE Prisma's model view in part — the --accept-data-loss trap; 1024-dim Cohere pinned, 1536 fallback poison risk" },
  { model: "task", containsPII: true, retentionRisk: "LOW", backfillPriority: 4, notes: "operator task spine; WorkItem is a QUEUE and must never merge into Task (standing rule)" },
  { model: "workItem", containsPII: true, retentionRisk: "LOW", backfillPriority: 4, notes: "the queue (see rule above)" },
  { model: "journalThreadEntry", containsPII: true, retentionRisk: "LOW", backfillPriority: 3, notes: "journal capture fan-out is a durable Inngest flow since the 07-15 audit (model name finding: JournalThreadEntry, not JournalEntry)" },
];

interface CensusRow {
  sourceId: string;
  domain: "statenour";
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
  const rows: CensusRow[] = [];
  for (const s of SOURCES) {
    const base: CensusRow = {
      sourceId: s.model, domain: "statenour", recordCount: null,
      oldestRecordAt: null, newestRecordAt: null,
      containsPII: s.containsPII, retentionRisk: s.retentionRisk,
      backfillPriority: s.backfillPriority, notes: s.notes,
    };
    try {
      const delegate = (prisma as unknown as Record<string, {
        count: () => Promise<number>;
        aggregate: (a: { _min: { createdAt: true }; _max: { createdAt: true } }) => Promise<{ _min: { createdAt: Date | null }; _max: { createdAt: Date | null } }>;
      }>)[s.model];
      if (!delegate?.count) throw new Error(`no prisma model "${s.model}"`);
      base.recordCount = await delegate.count();
      if (base.recordCount > 0) {
        const agg = await delegate.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } });
        base.oldestRecordAt = agg._min.createdAt?.toISOString() ?? null;
        base.newestRecordAt = agg._max.createdAt?.toISOString() ?? null;
      }
    } catch (err) {
      base.error = err instanceof Error ? err.message.slice(0, 120) : String(err);
    }
    rows.push(base);
    console.log(`  ${s.model}: ${base.error ? `ERROR ${base.error}` : `${base.recordCount} rows · ${base.oldestRecordAt?.slice(0, 10) ?? "?"} → ${base.newestRecordAt?.slice(0, 10) ?? "?"}`}`);
  }

  const outDir = join(process.cwd(), "eval-datasets");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "data-census-statenour.json");
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), domain: "statenour", sources: rows }, null, 2));
  const errors = rows.filter((r) => r.error).length;
  console.log(`\ncensus: ${rows.length} sources · ${errors} errors → ${outPath}`);
  if (errors) console.log("errors are FINDINGS (renamed/absent models) — fix the spec, do not hide them");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[data-census] fatal:", err);
  process.exit(1);
});
