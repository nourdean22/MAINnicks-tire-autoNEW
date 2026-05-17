/**
 * Storage quota watcher · v8.8 · Apr 29.
 *
 * Tracks Postgres storage costs that creep up silently — vector
 * embeddings (1536 floats × N rows = real bytes), brain memory
 * volume, entity-audit log size, chat-message growth.
 *
 * Composes:
 *   · Reads pg_relation_size + row counts via raw SQL
 *   · Emits BrainMemory category="storage_quota_alert" when crossing
 *     thresholds (60% / 80% / 95% of soft caps)
 *   · Idempotent via @@unique([category, key]) — one alert per
 *     {table + threshold} per day
 *
 * Threshold model (informed by Neon Pro free tier + Pro plan):
 *   · Per-table soft caps below tuned for ~10GB total budget
 *   · Adjust SOFT_CAPS once usage stabilizes around real ceiling
 *
 * Folded into mega-evening for daily roll-up; no standalone cron
 * (respects v8.7 budget rules).
 */

import { prisma } from "@/lib/prisma";

interface TableStat {
  /** Table name */
  table: string;
  /** Row count */
  rows: number;
  /** Bytes (toast + heap + indexes) */
  bytes: number;
  /** Bytes / row */
  bytesPerRow: number;
}

interface RawSizeRow {
  relname: string;
  bytes: bigint;
  rows: bigint;
}

/** Per-table soft cap in bytes. Crossing 60% emits low alert,
 *  80% medium, 95% high. */
const SOFT_CAPS: Record<string, number> = {
  vector_embeddings: 1_500_000_000, // 1.5 GB (1536 floats × 200K rows)
  brain_memories: 500_000_000, // 500 MB
  chat_messages: 1_000_000_000, // 1 GB
  entity_audits: 300_000_000, // 300 MB
  audit_events: 200_000_000, // 200 MB
};

const TABLES_TO_WATCH = Object.keys(SOFT_CAPS);
const ALERT_CATEGORY = "storage_quota_alert";

export interface QuotaReport {
  ranAt: string;
  tables: Array<TableStat & { softCap: number; pctOfCap: number; tier: "ok" | "low" | "medium" | "high" }>;
  totalBytes: number;
  alertsWritten: number;
}

function tierFor(pct: number): "ok" | "low" | "medium" | "high" {
  if (pct >= 0.95) return "high";
  if (pct >= 0.8) return "medium";
  if (pct >= 0.6) return "low";
  return "ok";
}

/**
 * Run a single pass: collect sizes, classify tiers, emit alerts for
 * tables crossing into low+ this day.
 */
export async function runStorageQuotaWatch(): Promise<QuotaReport> {
  const ranAt = new Date().toISOString();

  // Pull sizes from pg_class + reltuples for row estimates. reltuples
  // is post-ANALYZE estimate; precise enough for storage tracking,
  // and avoids COUNT(*) full-table scans on huge tables.
  const stats: TableStat[] = [];
  try {
    const rows = await prisma.$queryRaw<RawSizeRow[]>`
      SELECT
        c.relname,
        pg_total_relation_size(c.oid) AS bytes,
        c.reltuples::bigint AS rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ANY(${TABLES_TO_WATCH}::text[])
    `;
    for (const r of rows) {
      const rowsN = Number(r.rows);
      const bytesN = Number(r.bytes);
      stats.push({
        table: r.relname,
        rows: Math.max(0, rowsN),
        bytes: bytesN,
        bytesPerRow: rowsN > 0 ? Math.round(bytesN / rowsN) : 0,
      });
    }
  } catch (err) {
    console.warn("[storage-quota] size probe failed:", err);
    return {
      ranAt,
      tables: [],
      totalBytes: 0,
      alertsWritten: 0,
    };
  }

  let totalBytes = 0;
  const tables = stats.map((s) => {
    const softCap = SOFT_CAPS[s.table] ?? 0;
    const pctOfCap = softCap > 0 ? s.bytes / softCap : 0;
    totalBytes += s.bytes;
    return {
      ...s,
      softCap,
      pctOfCap,
      tier: tierFor(pctOfCap),
    };
  });

  // Emit alerts for any table at low+ tier. Idempotent via
  // (category, key=`<table>:<YYYY-MM-DD>:<tier>`) so the same
  // tier-day combo writes once.
  const dayKey = ranAt.slice(0, 10);
  let alertsWritten = 0;

  for (const t of tables) {
    if (t.tier === "ok") continue;
    const key = `${t.table}:${dayKey}:${t.tier}`;
    try {
      await prisma.brainMemory.create({
        data: {
          category: ALERT_CATEGORY,
          key,
          content:
            `Storage quota · ${t.table} at ${(t.pctOfCap * 100).toFixed(1)}% ` +
            `of soft cap (${(t.bytes / 1_000_000).toFixed(0)}MB / ` +
            `${(t.softCap / 1_000_000).toFixed(0)}MB · ${t.rows} rows · ` +
            `${t.bytesPerRow} bytes/row · tier=${t.tier})`,
          confidence: 0.9,
          source: "cron:storage-quota-watch",
          metadata: {
            table: t.table,
            bytes: t.bytes,
            rows: t.rows,
            softCap: t.softCap,
            pctOfCap: t.pctOfCap,
            tier: t.tier,
          } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
        },
      });
      alertsWritten++;
    } catch (err: unknown) {
      // P2002 = already alerted today
      if (!(err && typeof err === "object" && (err as { code?: string }).code === "P2002")) {
        console.warn(`[storage-quota] alert write failed for ${t.table}:`, err);
      }
    }
  }

  return {
    ranAt,
    tables,
    totalBytes,
    alertsWritten,
  };
}
