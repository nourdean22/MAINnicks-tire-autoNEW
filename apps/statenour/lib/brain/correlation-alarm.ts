/**
 * Correlation alarm clock · v8.2 · F2 · Apr 29.
 *
 * Periodic cron that runs `findCorrelations()` and emits a
 * BrainMemory alert when a NEW strong correlation appears that
 * wasn't on the previous pass. Strength threshold: |r| > 0.7
 * (the bar at which a relationship is meaningful enough to
 * surface to Nour, not just background noise).
 *
 * Storage shape:
 *   · Each pass writes one snapshot row: BrainMemory category=
 *     correlation_snapshot, key=YYYY-MM-DD-HHmm, content=summary,
 *     metadata.pairs=[{a,b,r,strength,direction,dataPoints}]
 *   · Each NEW correlation crossing the |r|>0.7 threshold
 *     vs. the last snapshot writes ONE alert row: category=
 *     correlation_alert, key=`<a>__<b>`, idempotency_key from
 *     mintIdempotencyKey({a,b,direction,roundedR}) so a flapping
 *     correlation doesn't re-fire alerts every pass.
 *
 * Hooked from: /api/cron/correlation-alarm (every 6h).
 */

import { prisma } from "@/lib/prisma";
import { findCorrelations } from "@/lib/brain/correlation-finder";
import { logCreate } from "@/lib/db/entity-audit";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/correlation-alarm");

const STRONG_THRESHOLD = 0.7;
const SNAPSHOT_CATEGORY = "correlation_snapshot";
const ALERT_CATEGORY = "correlation_alert";

export interface AlarmRunReport {
  ranAt: string;
  totalCorrelations: number;
  strongCount: number;
  newAlerts: Array<{ a: string; b: string; coefficient: number; direction: string }>;
  suppressedCount: number;
  snapshotKey: string | null;
}

/**
 * Make a key that's stable across passes for the SAME logical pair,
 * regardless of metric ordering. Sorts the pair so {revenue, sleep}
 * and {sleep, revenue} hit the same row.
 */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join("__");
}

/** Round r to 2 decimal places so micro-jitter doesn't re-fire alerts. */
function roundCoeff(r: number): number {
  return Math.round(r * 100) / 100;
}

/**
 * Compare current pass to the most recent snapshot. Returns the set
 * of pair keys that crossed the |r|>0.7 threshold this pass but
 * weren't strong on the prior pass.
 */
async function diffAgainstLastSnapshot(
  current: Awaited<ReturnType<typeof findCorrelations>>,
): Promise<Set<string>> {
  const previous = await prisma.brainMemory
    .findFirst({
      where: { category: SNAPSHOT_CATEGORY, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    })
    .catch(() => null);

  const prevStrong = new Set<string>();
  if (previous?.metadata && typeof previous.metadata === "object") {
    const pairs = (previous.metadata as { pairs?: Array<{ a: string; b: string; r: number }> }).pairs;
    if (Array.isArray(pairs)) {
      for (const p of pairs) {
        if (Math.abs(p.r) >= STRONG_THRESHOLD) prevStrong.add(pairKey(p.a, p.b));
      }
    }
  }

  const newKeys = new Set<string>();
  for (const c of current) {
    if (Math.abs(c.coefficient) < STRONG_THRESHOLD) continue;
    const k = pairKey(c.metricA, c.metricB);
    if (!prevStrong.has(k)) newKeys.add(k);
  }
  return newKeys;
}

/** Persist the current pass as a snapshot row for next time. */
async function writeSnapshot(
  current: Awaited<ReturnType<typeof findCorrelations>>,
): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const pairs = current.map((c) => ({
    a: c.metricA,
    b: c.metricB,
    r: roundCoeff(c.coefficient),
    strength: c.strength,
    direction: c.direction,
    dataPoints: c.dataPoints,
  }));
  const summary =
    `Correlation snapshot · ${current.length} pairs · ` +
    `${current.filter((c) => Math.abs(c.coefficient) >= STRONG_THRESHOLD).length} strong (|r|>0.7)`;

  // 2026-09-02 · this create had no try/catch while the alert-write loop 30
  // lines below already tolerates P2002. `key: stamp` is minute-resolution, so
  // two triggers in the same minute — a re-run, or the cron-healer re-firing a
  // job it thinks is stuck — collide on the unique and threw, killing the whole
  // correlation run AFTER its alerts had already been written. Duplicate
  // snapshot, same content: dedup is the correct outcome, not an exception.
  try {
    await prisma.brainMemory.create({
      data: {
        category: SNAPSHOT_CATEGORY,
        key: stamp,
        content: summary,
        confidence: 0.8,
        source: "cron:correlation-alarm",
        metadata: { pairs } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    });
  } catch (err: unknown) {
    // P2002 = idempotency hit — the snapshot for this minute already exists.
    if (!(err && typeof err === "object" && (err as { code?: string }).code === "P2002")) {
      throw err;
    }
  }
  return stamp;
}

/**
 * Public entry point. Runs the analyzer, writes the snapshot, emits
 * alerts for newly-crossed strong correlations.
 */
export async function runCorrelationAlarm(): Promise<AlarmRunReport> {
  const ranAt = new Date().toISOString();
  const correlations = await findCorrelations();
  const strong = correlations.filter((c) => Math.abs(c.coefficient) >= STRONG_THRESHOLD);

  if (correlations.length === 0) {
    return {
      ranAt,
      totalCorrelations: 0,
      strongCount: 0,
      newAlerts: [],
      suppressedCount: 0,
      snapshotKey: null,
    };
  }

  const newKeys = await diffAgainstLastSnapshot(correlations);
  const newAlerts: AlarmRunReport["newAlerts"] = [];
  let suppressedCount = 0;

  // Emit one alert row per NEW strong correlation. Idempotency-key
  // from {a,b,direction,roundedR} suppresses re-fires when the
  // correlation jitters around the 0.7 threshold.
  for (const c of strong) {
    const key = pairKey(c.metricA, c.metricB);
    if (!newKeys.has(key)) {
      suppressedCount++;
      continue;
    }
    // Dedup via the existing @@unique([category, key]) on brain_memories.
    // P2002 here means "we've already alerted for this pair" — that's a
    // good outcome, not an error. (BrainMemory has no idempotencyKey
    // column; v7.7 added that to event/action tables, not memory.)
    try {
      const created = await prisma.brainMemory.create({
        data: {
          category: ALERT_CATEGORY,
          key,
          content: `New strong correlation: ${c.interpretation}`,
          confidence: Math.min(0.95, Math.abs(c.coefficient)),
          source: "cron:correlation-alarm",
          metadata: {
            r: roundCoeff(c.coefficient),
            direction: c.direction,
            strength: c.strength,
            dataPoints: c.dataPoints,
            surprising: c.surprising,
          } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
        },
      });
      void logCreate("brainMemory", created.id, created as unknown as Record<string, unknown>, {
        source: "cron:correlation-alarm",
        reason: `r=${roundCoeff(c.coefficient)} · ${c.interpretation.slice(0, 80)}`,
      });
      newAlerts.push({
        a: c.metricA,
        b: c.metricB,
        coefficient: roundCoeff(c.coefficient),
        direction: c.direction,
      });
    } catch (err: unknown) {
      // P2002 = idempotency hit — dedup'd, that's fine.
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        suppressedCount++;
      } else {
        log.warn("alert_write_failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const snapshotKey = await writeSnapshot(correlations);

  return {
    ranAt,
    totalCorrelations: correlations.length,
    strongCount: strong.length,
    newAlerts,
    suppressedCount,
    snapshotKey,
  };
}
