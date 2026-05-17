/**
 * Mass-creation spike detector · v8.10 BATCH 59 · Apr 29.
 *
 * Watches the entity_audits firehose for unusual create-rate spikes
 * per entity-type. Useful for catching:
 *   · A bug or regression that's mass-creating tasks (think: a chat
 *     interceptor that fires every keystroke)
 *   · A bot or scripted attack hitting a public-ish API
 *   · An import/migration job that wasn't supposed to run
 *
 * Heuristic:
 *   · Per entity-type, count `created` actions in the last hour
 *   · Compare to the trailing 7-day median per-hour for that type
 *   · If current >= 5× median AND >= 20 absolute → fire alert
 *
 * Idempotent via @@unique([category, key]) on brain_memories with
 * key=`<entityType>:<YYYY-MM-DDTHH>` so a single hour can only
 * generate one alert per entity-type.
 *
 * Folded into mega-evening (no standalone schedule). Daily check
 * is plenty — if a spike is happening NOW, the next-mega run will
 * catch it within ~22 hours, which is fine for the failure modes
 * this catches.
 */

import { prisma } from "@/lib/prisma";

const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const TRAILING_WINDOW_DAYS = 7;
const SPIKE_RATIO = 5;
const ABSOLUTE_FLOOR = 20;
const ALERT_CATEGORY = "creation_spike_alert";

export interface SpikeReport {
  ranAt: string;
  scannedTypes: number;
  spikesFound: number;
  alertsWritten: number;
  details: Array<{
    entityType: string;
    lastHourCount: number;
    medianHourly: number;
    ratio: number;
    alerted: boolean;
  }>;
}

interface HourlyRow {
  entitytype: string;
  hour: Date;
  cnt: bigint;
}

export async function runCreationSpikeDetect(): Promise<SpikeReport> {
  const ranAt = new Date().toISOString();
  const since = new Date(Date.now() - TRAILING_WINDOW_DAYS * 86_400_000);

  // Pull per-hour create counts per entity-type for the trailing
  // window. One scan, grouped by date_trunc('hour', created_at).
  let rows: HourlyRow[] = [];
  try {
    rows = await prisma.$queryRaw<HourlyRow[]>`
      SELECT
        entity_type AS entitytype,
        date_trunc('hour', created_at) AS hour,
        COUNT(*)::bigint AS cnt
      FROM entity_audits
      WHERE action = 'created'
        AND created_at >= ${since}
      GROUP BY entity_type, date_trunc('hour', created_at)
    `;
  } catch (err) {
    console.warn("[creation-spike] query failed:", err);
    return {
      ranAt,
      scannedTypes: 0,
      spikesFound: 0,
      alertsWritten: 0,
      details: [],
    };
  }

  // Bucket by entity-type for the median over the trailing window.
  const byType = new Map<string, number[]>();
  for (const r of rows) {
    const t = r.entitytype;
    const c = Number(r.cnt);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(c);
  }

  // v9.1.16 · Fix the "blind 55 min/hour" bug. The previous code
  // used date_trunc('hour', created_at) buckets and summed them when
  // r.hour >= lastHourStart. But if the cron fires at 2:05, the "2AM"
  // bucket only contains 5 minutes of data, while the median was
  // computed over full-hour buckets. Result: ratio = 5min-of-current
  // / 60min-median, which can NEVER cross the 5x threshold during
  // the first ~55 minutes of any hour. We were systematically blind
  // to spikes for ~92% of the day.
  //
  // Fix: do a separate, true rolling 60-minute count per entity-type
  // and use THAT as `lastHour`. The median still uses the per-hour
  // date_trunc buckets (apples to apples for historical comparison).
  const lastHourBuckets = new Map<string, number>();
  try {
    const rollingRows = await prisma.$queryRaw<{ entitytype: string; cnt: bigint }[]>`
      SELECT entity_type AS entitytype, COUNT(*)::bigint AS cnt
      FROM entity_audits
      WHERE action = 'created'
        AND created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY entity_type
    `;
    for (const r of rollingRows) {
      lastHourBuckets.set(r.entitytype, Number(r.cnt));
    }
  } catch (err) {
    console.warn("[creation-spike] rolling-hour query failed:", err);
  }

  const details: SpikeReport["details"] = [];
  let spikesFound = 0;
  let alertsWritten = 0;

  const hourKey = ranAt.slice(0, 13);

  for (const [entityType, hourly] of byType.entries()) {
    if (hourly.length < 4) continue; // need at least 4 hours of history
    const sorted = [...hourly].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const lastHour = lastHourBuckets.get(entityType) ?? 0;
    const ratio = median > 0 ? lastHour / median : lastHour > 0 ? Infinity : 0;
    const isSpike =
      lastHour >= ABSOLUTE_FLOOR && (median === 0 || ratio >= SPIKE_RATIO);

    if (isSpike) {
      spikesFound++;
      const key = `${entityType}:${hourKey}`;
      try {
        await prisma.brainMemory.create({
          data: {
            category: ALERT_CATEGORY,
            key,
            content:
              `Creation spike · ${entityType} · ${lastHour} creates in last hour ` +
              `(${ratio === Infinity ? ">∞" : ratio.toFixed(1) + "×"} the 7d median of ` +
              `${median}/hr). Investigate: chat interceptor loop? import job? bot?`,
            confidence: 0.9,
            source: "cron:creation-spike-detect",
            metadata: {
              entityType,
              lastHourCount: lastHour,
              medianHourly: median,
              ratio,
              hour: hourKey,
            } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
          },
        });
        alertsWritten++;
      } catch (err: unknown) {
        if (!(err && typeof err === "object" && (err as { code?: string }).code === "P2002")) {
          console.warn(`[creation-spike] alert write failed for ${entityType}:`, err);
        }
      }
    }

    details.push({
      entityType,
      lastHourCount: lastHour,
      medianHourly: median,
      ratio,
      alerted: isSpike,
    });
  }

  return {
    ranAt,
    scannedTypes: byType.size,
    spikesFound,
    alertsWritten,
    details,
  };
}
