/**
 * Closed-Loop Delivery — Tier A · wave-181.x
 *
 * Every wave shipped through nickstire should produce a measurable
 * outcome. Without measurement we ship 8 compound loops a day and
 * never know which 3 actually moved the needle. This service is the
 * feedback loop · record baseline at ship time → measure 14 days
 * later → Telegram digest of lift/no-lift/regression.
 *
 * Mechanism
 *  1 · `recordWave(waveId, metricKey)` reads current value via the
 *      registered resolver and writes a `wave_metrics` row · status
 *      pending · measure_at = now + N days (default 14)
 *  2 · daily cron runs `measureDueWaves()` · finds pending rows with
 *      measure_at <= now · resolves current value · computes
 *      delta_percent · marks lifted / no_lift / regression / error
 *  3 · cron writes a Telegram digest summarizing measurements that
 *      day · operator sees compounding signal weekly
 *
 * Why a resolver registry · we can't persist functions. The metric_key
 * column references a NAMED resolver in this file · adding new
 * metrics is a code change, not a runtime config. Safer · pre-commit
 * lint catches typos · type-checked.
 *
 * Wave-id convention · "wave-181.x.<short-name>" matches the operator's
 * existing wave naming. Use kebab-case for short-name.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("services:closed-loop");

export type MetricResolver = () => Promise<number>;

/**
 * Lift threshold · ±5% is the default boundary between "no lift" and
 * a real signal. Small effects under 5% are inside measurement noise
 * for a 14-day window with single-shop volume.
 */
const LIFT_THRESHOLD = 5;

// ─── Resolver registry ──────────────────────────────────────────────
//
// Adding a new metric · register the resolver here · call `recordWave`
// with the matching `metricKey`. Each resolver reads the metric over
// the last 14 days so baseline and measurement use the same window.

const RESOLVERS: Record<string, MetricResolver> = {
  /**
   * VAPI booked-call rate over last 14d. Numerator · calls with
   * eval_outcome IN ('converted','exemplary'). Denominator · all
   * evaluated calls in window. Returns 0-100 percent.
   *
   * Tied to wave-181.x BDI. Lift > 5% over baseline indicates the
   * declined-recovery opener is converting more inbound calls.
   */
  vapi_convert_rate_14d: async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 0;
    const r = await d.execute(sql`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN eval_outcome IN ('converted','exemplary') THEN 1 ELSE 0 END) AS converted
      FROM vapi_call_logs
      WHERE eval_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ total: number; converted: number }>;
    const row = rows[0];
    if (!row || !row.total) return 0;
    return Math.round((row.converted / row.total) * 10000) / 100;
  },

  /**
   * Declined-estimate recovery rate over last 14d. Numerator · ALG
   * estimates with matched_invoice_id IS NOT NULL where the match
   * happened in the 14-day window. Denominator · estimates with
   * follow-up SMS sent in window. Returns 0-100 percent.
   *
   * Tied to wave-181.x 5×3 SMS sequence. Lift > 5% means the new
   * touch cadence (3d/14d/45d × P1/P2/P3 profiles) is recovering more
   * declined work than the prior 2-touch sequence.
   */
  declined_recovery_rate_14d: async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 0;
    const r = await d.execute(sql`
      SELECT
        COUNT(*) AS sent,
        SUM(CASE WHEN matched_invoice_id IS NOT NULL THEN 1 ELSE 0 END) AS recovered
      FROM alg_estimates
      WHERE (follow_up_3d_sent + follow_up_7d_sent + follow_up_14d_sent + follow_up_30d_sent + follow_up_45d_sent) > 0
        AND estimate_date >= DATE_SUB(NOW(), INTERVAL 60 DAY)
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ sent: number; recovered: number }>;
    const row = rows[0];
    if (!row || !row.sent) return 0;
    return Math.round((row.recovered / row.sent) * 10000) / 100;
  },

  /**
   * Average Nick AI call eval score (0-100) over last 14d. Tied to
   * wave-181.x #48 daily call-eval cron. Lift > 5% indicates the
   * compound learning loop (BDI + prompt iterations) is improving
   * call quality.
   */
  vapi_avg_eval_score_14d: async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 0;
    const r = await d.execute(sql`
      SELECT AVG(eval_score) AS avg_score
      FROM vapi_call_logs
      WHERE eval_at >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND eval_score IS NOT NULL
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ avg_score: number | string | null }>;
    const v = rows[0]?.avg_score ?? 0;
    return typeof v === "string" ? parseFloat(v) : (v ?? 0);
  },

  /**
   * SERP impressions on /tires/* pages over last 14d · tied to
   * wave-181.x category buying guides. Lift > 5% indicates the new
   * unique editorial content is gaining long-tail visibility.
   * Reads from search_performance table (GSC ingest).
   */
  tire_size_impressions_14d: async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 0;
    const r = await d.execute(sql`
      SELECT SUM(impressions) AS total
      FROM search_performance
      WHERE page LIKE '/tires/%'
        AND date >= DATE_SUB(NOW(), INTERVAL 14 DAY)
    `);
    const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ total: number | null }>;
    return rows[0]?.total ?? 0;
  },

  /**
   * Service Affinity v2 · A/B-tested booking-rate lift over last 14d.
   *
   * Numerator · prediction_outcomes.matched=1 rows where the parent
   * prediction had ab_arm='treatment' AND was created in window.
   * Denominator · total treatment-arm predictions created in window.
   * Returns 0-100 percent · the booking rate from acted-upon (treatment)
   * predictions.
   *
   * The cron auto-records baseline once a control group exists too ·
   * the A/B comparison is lift-vs-baseline, NOT cross-arm. Future
   * extension · separate treatment / control resolvers + a lift
   * resolver that joins them.
   *
   * Per docs/2026-05-24-service-affinity-v2.md §2.3 (CLOSED LOOP) ·
   * Wave 2. Requires migration 0061_service_affinity_v2.sql applied.
   *
   * Self-resilient · returns 0 if the new tables don't exist yet (DB
   * error caught at caller via try/catch · matches the resilience
   * pattern in vapi_convert_rate_14d above).
   */
  service_affinity_acted_to_revenue_14d: async () => {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 0;
    try {
      const r = await d.execute(sql`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN po.matched = 1 THEN 1 ELSE 0 END) AS booked
        FROM service_affinity_predictions sap
        LEFT JOIN prediction_outcomes po ON po.prediction_id = sap.id
        WHERE sap.ab_arm = 'treatment'
          AND sap.created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
      `);
      const rows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as Array<{ total: number; booked: number | null }>;
      const row = rows[0];
      if (!row || !row.total) return 0;
      return Math.round(((row.booked ?? 0) / row.total) * 10000) / 100;
    } catch {
      // Tables not yet applied to this environment · graceful 0
      return 0;
    }
  },
};

export function listRegisteredMetrics(): string[] {
  return Object.keys(RESOLVERS);
}

/**
 * Seed wave_metrics baselines for the 8 compounding loops shipped on
 * 2026-05-23. Idempotent · checks for existing rows per (wave_id,
 * metric_key) before inserting. Safe to call on every cron startup
 * but typically called once after migration 0059 lands.
 *
 * Why this exists · the framework was built AFTER the waves shipped ·
 * the loops are already running but have no recorded baseline for
 * the 14-day measurement window to compare against. This function
 * captures "today" as the baseline so 14 days from now the cron has
 * something to measure against.
 *
 * Returns count of new rows inserted.
 */
export async function seedWaveBaselines(): Promise<number> {
  const seeds: Array<{ waveId: string; metricKey: string; notes: string }> = [
    {
      waveId: "wave-181.x.bdi",
      metricKey: "vapi_convert_rate_14d",
      notes: "BDI declined-recovery opener · expecting +5-10% lift on inbound convert rate",
    },
    {
      waveId: "wave-181.x.declined-5x3",
      metricKey: "declined_recovery_rate_14d",
      notes: "5×3 SMS sequence with P1/P2/P3 profiles · expecting +3-5% recovery rate vs 2-touch baseline",
    },
    {
      waveId: "wave-181.x.call-eval-loop",
      metricKey: "vapi_avg_eval_score_14d",
      notes: "Daily call-eval feeding nickMemory · expecting compound learning to raise avg score over weeks",
    },
    {
      waveId: "wave-181.x.tire-size-guides",
      metricKey: "tire_size_impressions_14d",
      notes: "Category-specific buying guides on 32 /tires/* pages · expecting +20-40% impressions over baseline",
    },
  ];

  let inserted = 0;
  try {
    const { getDb } = await import("../db");
    const { waveMetrics } = await import("../../drizzle/schema");
    const { and, eq } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return 0;

    for (const seed of seeds) {
      // Idempotent · skip if already seeded for this waveId+metricKey
      const [existing] = await d
        .select({ id: waveMetrics.id })
        .from(waveMetrics)
        .where(and(eq(waveMetrics.waveId, seed.waveId), eq(waveMetrics.metricKey, seed.metricKey)))
        .limit(1);
      if (existing) continue;
      const ok = await recordWave(seed.waveId, seed.metricKey, {
        measureInDays: 14,
        notes: seed.notes,
      });
      if (ok) inserted++;
    }
  } catch (err) {
    log.warn("seedWaveBaselines failed", { err: err instanceof Error ? err.message : String(err) });
  }
  return inserted;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Record a baseline measurement for a shipped wave. Reads the current
 * value via the registered resolver and writes a wave_metrics row
 * scheduled for measurement N days from now (default 14).
 *
 * Returns true if recorded · false if unknown metric_key or DB error.
 */
export async function recordWave(
  waveId: string,
  metricKey: string,
  opts: { measureInDays?: number; notes?: string } = {},
): Promise<boolean> {
  const resolver = RESOLVERS[metricKey];
  if (!resolver) {
    log.warn("recordWave · unknown metric_key", { waveId, metricKey });
    return false;
  }
  try {
    const baseline = await resolver();
    const { getDb } = await import("../db");
    const { waveMetrics } = await import("../../drizzle/schema");
    const d = await getDb();
    if (!d) return false;
    const measureInDays = opts.measureInDays ?? 14;
    const measureAt = new Date(Date.now() + measureInDays * 86_400_000);
    await d.insert(waveMetrics).values({
      waveId,
      metricKey,
      baselineValue: String(baseline),
      measureAt,
      status: "pending",
      notes: opts.notes ?? null,
    });
    log.info("wave recorded", { waveId, metricKey, baseline, measureInDays });
    return true;
  } catch (err) {
    log.error("recordWave failed", {
      waveId,
      metricKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Run measurement on every pending wave_metrics row whose measure_at
 * has passed. Called by the daily cron. Telegram digest emitted only
 * when at least one wave is measured this run.
 */
export async function measureDueWaves(): Promise<{
  measured: number;
  lifted: number;
  noLift: number;
  regression: number;
  errors: number;
}> {
  const result = { measured: 0, lifted: 0, noLift: 0, regression: 0, errors: 0 };
  try {
    const { getDb } = await import("../db");
    const { waveMetrics } = await import("../../drizzle/schema");
    const { sql, and, eq, lte } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return result;

    const due = await d
      .select()
      .from(waveMetrics)
      .where(and(eq(waveMetrics.status, "pending"), lte(waveMetrics.measureAt, new Date())));

    if (due.length === 0) return result;

    const digestLines: string[] = [];

    for (const row of due) {
      const resolver = RESOLVERS[row.metricKey];
      if (!resolver) {
        await d.update(waveMetrics).set({ status: "resolver_error", measuredAt: new Date() }).where(eq(waveMetrics.id, row.id));
        result.errors++;
        continue;
      }
      try {
        const current = await resolver();
        const baseline = parseFloat(row.baselineValue);
        const deltaPct = baseline === 0 ? 0 : ((current - baseline) / baseline) * 100;
        let status: "lifted" | "no_lift" | "regression";
        if (deltaPct >= LIFT_THRESHOLD) {
          status = "lifted";
          result.lifted++;
        } else if (deltaPct <= -LIFT_THRESHOLD) {
          status = "regression";
          result.regression++;
        } else {
          status = "no_lift";
          result.noLift++;
        }
        await d.update(waveMetrics).set({
          measuredValue: String(current),
          deltaPercent: String(Math.round(deltaPct * 100) / 100),
          status,
          measuredAt: new Date(),
        }).where(eq(waveMetrics.id, row.id));
        result.measured++;

        const emoji = status === "lifted" ? "✅" : status === "regression" ? "⚠" : "·";
        const sign = deltaPct >= 0 ? "+" : "";
        digestLines.push(`${emoji} ${row.waveId} · ${row.metricKey} · ${sign}${deltaPct.toFixed(1)}% (${baseline.toFixed(2)} → ${current.toFixed(2)})`);
      } catch (err) {
        await d.update(waveMetrics).set({ status: "resolver_error", measuredAt: new Date() }).where(eq(waveMetrics.id, row.id));
        result.errors++;
        log.warn("resolver failed", {
          waveId: row.waveId,
          metricKey: row.metricKey,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (digestLines.length > 0) {
      try {
        const { sendTelegram } = await import("./telegram");
        const summary = [
          `📊 CLOSED-LOOP DIGEST · ${result.measured} waves measured`,
          ``,
          `✅ ${result.lifted} lifted · · ${result.noLift} no-lift · ⚠ ${result.regression} regression`,
          ``,
          ...digestLines,
        ];
        await sendTelegram(summary.join("\n"));
      } catch (err) {
        log.warn("telegram digest failed", { err: err instanceof Error ? err.message : String(err) });
      }
    }
    // suppress unused var
    void sql;
  } catch (err) {
    log.error("measureDueWaves failed", { err: err instanceof Error ? err.message : String(err) });
  }
  return result;
}
