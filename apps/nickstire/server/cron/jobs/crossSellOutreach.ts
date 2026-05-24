/**
 * Cron: Cross-Sell Outreach · v2 closed-loop wire-up
 *
 * Reads per-customer predictions from `service_affinity_predictions`
 * (written every 6h by serviceAffinityCompute.ts when the
 * `service_affinity_v2_compute` flag is ON) and sends an SMS to the
 * treatment-arm customers at ≥50% confidence.
 *
 * Closed-loop instrumentation (per migration 0061):
 *   · writes a row to `prediction_impressions` when a prediction is
 *     selected for outreach
 *   · writes a row to `prediction_actions` when the SMS actually sends
 *   · `prediction_outcomes` is written downstream by a separate
 *     attribution cron (14d window) when a treatment-arm customer
 *     returns for the predicted service
 *
 * Why v2 replaces v1:
 *   The pre-Wave-4 cron used pattern-based transitions ("got brakes →
 *   likely needs tires" with ≥3 historical co-occurrences). v2 uses
 *   per-customer weighted scoring (recency × seasonal × not-recently-
 *   had) and includes confidence + reason. v2 is more selective + has
 *   measurable hold-out (control arm) for lift math.
 *
 * Safety (preserved from v1 · hard-won lessons):
 *   · 30-day cooldown via JOIN across smsConversations (was a spam
 *     incident pre-181.51 from LIKE-LIMIT-1 picking arbitrary conv row)
 *   · TCPA opt-out check (customers.smsOptOut)
 *   · 8AM-8PM quiet-hours guard (NOT here · enforced upstream in sendSms)
 *   · per-run cap (MAX_SMS_PER_RUN)
 *   · F25e gateway via `{ via: "shop" }` · Twilio bypassed
 *   · resilient to missing `service_affinity_predictions` (returns
 *     early if migration 0061 not yet applied or no predictions exist)
 *
 * Feature flag: `sms_cross_sell_outreach` (starts DISABLED · operator
 * flips after `service_affinity_v2_compute` has been running for ≥1
 * cycle so predictions exist).
 */
import { createLogger } from "../../lib/logger";
import { sql } from "drizzle-orm";

const log = createLogger("cron:cross-sell-outreach");

/** Max SMS per cron run · matches v1 cap (slow ramp · raise after lift math validates) */
const MAX_SMS_PER_RUN = 10;

/** Cooldown days · don't text the same number for any cross-sell within window */
const COOLDOWN_DAYS = 30;

/** Confidence threshold for outreach · below this, cron writes the
 *  prediction but doesn't act on it. 50 = "more likely than not". */
const MIN_CONFIDENCE_TO_ACT = 50;

/** Human-readable service names for SMS · keys match buildServiceAffinityMap output */
const SERVICE_LABELS: Record<string, string> = {
  brakes: "a brake check",
  tires: "tire service",
  oil: "an oil change",
  suspension: "suspension service",
  engine: "an engine check",
  electrical: "electrical service",
  exhaust: "exhaust service",
  cooling: "cooling system service",
  transmission: "transmission service",
  diagnostic: "a vehicle inspection",
};

interface V2PredictionRow {
  predictionId: number;
  customerId: number;
  predictedService: string;
  confidence: number;
  reason: string | null;
  customerName: string;
  customerPhone: string;
  smsOptOut: boolean;
}

/**
 * Read latest treatment-arm predictions ≥ MIN_CONFIDENCE_TO_ACT and
 * join customer details. Most-recent-prediction-per-customer wins.
 *
 * Returns empty array gracefully if the v2 table doesn't exist yet
 * (migration 0061 not applied) or no predictions written yet.
 */
async function fetchActionablePredictions(): Promise<V2PredictionRow[]> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return [];

  try {
    // Latest prediction per customer in the treatment arm above the
    // confidence threshold. We use a window-like correlated subquery
    // (MAX(created_at) per customer) because TiDB doesn't always pick
    // a good plan for ROW_NUMBER() OVER() at this scale yet.
    const rows = (await d.execute(sql`
      SELECT
        sap.id            AS predictionId,
        sap.customer_id   AS customerId,
        sap.predicted_service AS predictedService,
        sap.confidence    AS confidence,
        JSON_UNQUOTE(JSON_EXTRACT(sap.features_json, '$.reason')) AS reason,
        TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) AS customerName,
        c.phone           AS customerPhone,
        COALESCE(c.sms_opt_out, FALSE) AS smsOptOut
      FROM service_affinity_predictions sap
      JOIN customers c ON c.id = sap.customer_id
      WHERE sap.ab_arm = 'treatment'
        AND sap.confidence >= ${MIN_CONFIDENCE_TO_ACT}
        AND sap.created_at = (
          SELECT MAX(created_at)
          FROM service_affinity_predictions sap2
          WHERE sap2.customer_id = sap.customer_id
        )
        AND c.phone IS NOT NULL
        AND c.phone <> ''
      ORDER BY sap.confidence DESC
      LIMIT 200
    `)) as unknown as [Array<{
      predictionId: number;
      customerId: number;
      predictedService: string;
      confidence: string | number;
      reason: string | null;
      customerName: string;
      customerPhone: string;
      smsOptOut: number | boolean;
    }>];

    const data = Array.isArray(rows) ? rows[0] : rows;
    if (!Array.isArray(data)) return [];

    return data.map((r) => ({
      predictionId: Number(r.predictionId),
      customerId: Number(r.customerId),
      predictedService: String(r.predictedService),
      confidence: Number(r.confidence),
      reason: r.reason ?? null,
      customerName: r.customerName || "",
      customerPhone: r.customerPhone || "",
      smsOptOut: Boolean(r.smsOptOut),
    }));
  } catch (err) {
    log.warn("v2 predictions read failed · table may not exist yet", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function processCrossSellOutreach(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_cross_sell_outreach"))) {
    return { recordsProcessed: 0, details: "Feature disabled" };
  }

  try {
    const predictions = await fetchActionablePredictions();
    if (predictions.length === 0) {
      return { recordsProcessed: 0, details: "No v2 predictions to act on (treatment-arm ≥50% confidence)" };
    }

    const { getDb } = await import("../../db");
    const { sendSms } = await import("../../sms");
    const { dispatch } = await import("../../services/eventBus");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // wave-181.x · ONE-shot cooldown set instead of N per-prediction queries
    // (was the karpathy-style improvement layered on top of the v1 spam fix).
    // We collect every phone (last-10-digit normalized) that had a cross-sell
    // outbound in the last 30 days, then filter predictions client-side.
    //
    // The v1 spam fix kept its join correctness: matching on conversation
    // by phone suffix so the cooldown is found under ANY conversation row
    // for the number. We just pull all qualifying rows in one shot rather
    // than N round-trips.
    const cooldownDate = new Date();
    cooldownDate.setDate(cooldownDate.getDate() - COOLDOWN_DAYS);
    const cooldownSet = new Set<string>();
    try {
      const cooldownRows = (await db.execute(sql`
        SELECT DISTINCT RIGHT(REGEXP_REPLACE(sc.phone, '[^0-9]', ''), 10) AS phone10
        FROM sms_messages m
        INNER JOIN sms_conversations sc ON sc.id = m.conversation_id
        WHERE m.direction = 'outbound'
          AND m.variant_key = 'cross_sell'
          AND m.created_at >= ${cooldownDate}
      `)) as unknown as [Array<{ phone10: string | null }>];
      const rows = Array.isArray(cooldownRows) ? cooldownRows[0] : cooldownRows;
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r.phone10) cooldownSet.add(r.phone10);
        }
      }
    } catch (err) {
      log.warn("cooldown lookup failed · proceeding without cooldown (risk: re-send)", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    let sent = 0;
    let skipped = 0;

    for (const p of predictions) {
      if (sent >= MAX_SMS_PER_RUN) break;
      if (!p.customerPhone) { skipped++; continue; }
      if (p.smsOptOut) { skipped++; continue; }

      const normalized = p.customerPhone.replace(/\D/g, "").slice(-10);
      if (cooldownSet.has(normalized)) {
        skipped++;
        continue;
      }

      // Closed-loop: write impression BEFORE the SMS attempt so we
      // always know which predictions were "shown" (selected) even if
      // the send itself fails. Per docs/2026-05-24-service-affinity-v2.md
      // §2.3 the impression row marks "we considered this prediction"
      // separately from "we acted on it".
      try {
        await db.execute(sql`
          INSERT INTO prediction_impressions
            (prediction_id, surface)
          VALUES
            (${p.predictionId}, 'cross_sell_cron')
        `);
      } catch (err) {
        log.warn("impression write failed · continuing", {
          predictionId: p.predictionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // Build and send the SMS · brand-voice tightened wording from
      // wave-181.46. v2 difference: we now lean on confidence + reason
      // for diagnostic logs only · customer message is unchanged so
      // brand voice stays consistent.
      const firstName = (p.customerName || "there").split(" ")[0] || "there";
      const serviceLabel = SERVICE_LABELS[p.predictedService] || p.predictedService;
      const message = `Hey ${firstName} — based on your last check-up, you're due for ${serviceLabel}. Free check, you don't pay until you say yes. Drop it off anytime. Reply STOP to opt out.`;

      const result = await sendSms(p.customerPhone, message, { via: "shop" });
      const { logOutboundSms } = await import("../../services/smsInstrumentation");
      await logOutboundSms(p.customerPhone, message, result.sid, "cross_sell");

      if (result.success) {
        sent++;
        log.info(`v2 cross-sell SMS sent to ${firstName} (${p.predictedService} · ${p.confidence}%)`, {
          reason: p.reason,
          predictionId: p.predictionId,
        });

        // Closed-loop: write action row · ties this SMS to the
        // specific v2 prediction · enables 14-day outcome attribution
        // Schema (0061): prediction_actions(id, prediction_id, action,
        // acted_at, operator_id) · action is the discriminator · we log
        // 'sms_sent' here · sms_sid is captured in sms_messages (joined
        // later for full attribution if needed).
        try {
          await db.execute(sql`
            INSERT INTO prediction_actions
              (prediction_id, action, operator_id)
            VALUES
              (${p.predictionId}, 'sms_sent', 'cron:cross-sell-outreach')
          `);
        } catch (err) {
          log.warn("action write failed · SMS already sent · continuing", {
            predictionId: p.predictionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }

        dispatch("campaign_sent", {
          type: "cross-sell-outreach-v2",
          customerId: p.customerId,
          phone: p.customerPhone,
          service: p.predictedService,
          confidence: p.confidence,
          reason: p.reason,
          predictionId: p.predictionId,
        }, { priority: "low", source: "cron:cross-sell-outreach" }).catch((e) => {
          log.warn("[jobs/crossSellOutreach] fire-and-forget failed:", e);
        });
      } else {
        log.warn(`v2 cross-sell SMS failed for ${firstName}: ${result.error || "unknown"}`);
      }

      // Rate-limit between sends (gateway-friendly · 1.5s spacing)
      await new Promise(r => setTimeout(r, 1500));
    }

    const details = `${sent} SMS sent, ${skipped} skipped (${predictions.length} v2 predictions in pool)`;
    if (sent > 0) log.info(`v2 cross-sell outreach: ${details}`);
    return { recordsProcessed: sent, details };
  } catch (err: unknown) {
    log.error("Cross-sell outreach failed:", { error: (err as Error).message });
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}
