/**
 * Mass-update spike detector · v8.11 BATCH 62 · Apr 29.
 *
 * Sibling of the v8.10 creation-spike detector — same heuristic but
 * watching `action='updated'` rather than `'created'`. Catches a
 * different failure mode:
 *   · A migration script accidentally re-touching every row
 *   · A bug that toggles a field on every interaction (e.g.
 *     useEffect storm calling updateTask on every keystroke)
 *   · A bot or fuzzer that's incrementing some counter on a public
 *     write surface
 *
 * Why split from creation-spike: the creation surface is bounded by
 * how fast users / agents can SAY something new; the update surface
 * is bounded by how fast events fire. Update-rate baselines look
 * very different — usually 5-10× higher than create-rate even on a
 * healthy system. A shared threshold would either miss real bugs
 * or false-positive every cron run. Same code shape, different
 * config + alert key.
 *
 * Config:
 *   · 5× ratio + 50 absolute floor (vs 20 for creates — updates
 *     legitimately churn faster, raising the abs floor avoids
 *     paging on busy-but-normal hours)
 *   · Same 7-day median baseline + 1-hour current window
 *   · Same per-hour idempotency key
 *
 * Folded into mega-evening (no standalone schedule).
 */

import { prisma } from "@/lib/prisma";

const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const TRAILING_WINDOW_DAYS = 7;
const SPIKE_RATIO = 5;
const ABSOLUTE_FLOOR = 50;
const ALERT_CATEGORY = "update_spike_alert";

export interface UpdateSpikeReport {
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

export async function runUpdateSpikeDetect(): Promise<UpdateSpikeReport> {
  const ranAt = new Date().toISOString();
  const since = new Date(Date.now() - TRAILING_WINDOW_DAYS * 86_400_000);

  let rows: HourlyRow[] = [];
  try {
    rows = await prisma.$queryRaw<HourlyRow[]>`
      SELECT
        entity_type AS entitytype,
        date_trunc('hour', created_at) AS hour,
        COUNT(*)::bigint AS cnt
      FROM entity_audits
      WHERE action = 'updated'
        AND created_at >= ${since}
      GROUP BY entity_type, date_trunc('hour', created_at)
    `;
  } catch (err) {
    console.warn("[update-spike] query failed:", err);
    return {
      ranAt,
      scannedTypes: 0,
      spikesFound: 0,
      alertsWritten: 0,
      details: [],
    };
  }

  // v9.1.16 · same blind-55-min bug as creation-spike-detector. See
  // that file for the full explanation. Median uses date_trunc per-
  // hour buckets; rolling lastHour uses a separate true 60-minute
  // count.
  const byType = new Map<string, number[]>();
  for (const r of rows) {
    const t = r.entitytype;
    const c = Number(r.cnt);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(c);
  }

  const lastHourBuckets = new Map<string, number>();
  try {
    const rollingRows = await prisma.$queryRaw<{ entitytype: string; cnt: bigint }[]>`
      SELECT entity_type AS entitytype, COUNT(*)::bigint AS cnt
      FROM entity_audits
      WHERE action = 'updated'
        AND created_at >= NOW() - INTERVAL '1 hour'
      GROUP BY entity_type
    `;
    for (const r of rollingRows) {
      lastHourBuckets.set(r.entitytype, Number(r.cnt));
    }
  } catch (err) {
    console.warn("[update-spike] rolling-hour query failed:", err);
  }

  const details: UpdateSpikeReport["details"] = [];
  let spikesFound = 0;
  let alertsWritten = 0;

  const hourKey = ranAt.slice(0, 13);

  for (const [entityType, hourly] of byType.entries()) {
    if (hourly.length < 4) continue;
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
              `Update spike · ${entityType} · ${lastHour} updates in last hour ` +
              `(${ratio === Infinity ? ">∞" : ratio.toFixed(1) + "×"} the 7d median of ` +
              `${median}/hr). Investigate: useEffect storm? migration? fuzzer?`,
            confidence: 0.9,
            source: "cron:update-spike-detect",
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
          console.warn(`[update-spike] alert write failed for ${entityType}:`, err);
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
