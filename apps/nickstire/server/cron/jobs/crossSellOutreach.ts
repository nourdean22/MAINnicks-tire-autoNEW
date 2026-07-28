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

/**
 * Confidence threshold for outreach · below this, cron writes the prediction
 * but doesn't act on it. 0.5 = "more likely than not".
 *
 * WAS 50, WHICH IS UNSATISFIABLE. `service_affinity_predictions.confidence` is
 * `DECIMAL(5,4)` — maximum storable value 9.9999 — and the only writer produces
 * a 0..1 fraction:
 *
 *   const sampleSize     = Math.min(1, totalInvoices / 8);
 *   const signalStrength = Math.min(1, winner.score / 45);
 *   const confidence     = Math.round(sampleSize * signalStrength * 100) / 100;
 *                                                  (services/engines/customer.ts)
 *
 * The comment said "50 = more likely than not", which is true on a percentage
 * scale — the column is a fraction. `>= 50` could never match a row, so every
 * run selected nothing while reporting success.
 */
const MIN_CONFIDENCE_TO_ACT = 0.5;

/**
 * ─── OPERATOR GATE BEFORE ENABLING `sms_cross_sell_outreach` (ROS-033) ───
 *
 * The threshold above is UNCHANGED and deliberately so. What changed in the
 * 2026-07-27 recalibration is the model underneath it: `confidence` is no longer
 * `sampleSize × signalStrength` (a product of two sub-1 measures that capped
 * production at 0.330 and could never clear this gate), and signal β
 * `declinedRecall` is implemented — an unconverted `alg_estimates` row now
 * contributes up to 40 of the 70 available points. See
 * `services/engines/affinityScoring.ts` and `affinityScoring.test.ts`.
 *
 * TWO THINGS THE OPERATOR MUST DECIDE BEFORE THIS FLAG GOES ON:
 *
 * 1. DOUBLE-TEXT RISK — RESOLVED IN CODE, not left to the operator.
 *    `cron/jobs/declinedWorkRecovery.ts` also contacts customers about open
 *    estimates, and it sends with `skipPersist: true`, so the COOLDOWN_DAYS
 *    window below could never have caught one of its sends. The affinity query
 *    now excludes any estimate the recovery loop has claimed (any
 *    `followUp*AttemptedAt` set), so recovery owns an estimate the moment it
 *    touches it and cross-sell cannot score on it. The double-text is
 *    impossible by construction rather than unlikely by cooldown.
 *
 * 2. VOLUME — THE ONE THING STILL UNVERIFIED. The recalibration is proven
 *    against the model, not against production rows: no prediction has been
 *    recomputed with v3 yet. Run `service_affinity_v2_compute` and read the
 *    confidence histogram from `service_affinity_predictions` BEFORE enabling
 *    sends. This job sits in the 2-hour tier: 12 runs/day x MAX_SMS_PER_RUN (10)
 *    is up to 120 texts/day until the eligible pool burns down, and no v3
 *    prediction has been computed anywhere yet. COOLDOWN_DAYS caps each PERSON
 *    at one message per 30 days, so the risk is a first-week spike in volume,
 *    not repeat-texting an individual. If the histogram looks heavy, drop
 *    MAX_SMS_PER_RUN before flipping the flag, not after.
 */

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
        TRIM(CONCAT(COALESCE(c.firstName, ''), ' ', COALESCE(c.lastName, ''))) AS customerName,
        c.phone           AS customerPhone,
        COALESCE(c.smsOptOut, FALSE) AS smsOptOut
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
    const msg = err instanceof Error ? err.message : String(err);
    // A MISSING TABLE and a BROKEN QUERY are not the same event, and collapsing
    // them is why this job sat dead for months.
    //
    // The old handler logged "table may not exist yet" for every failure and
    // returned []. The actual error was ER_BAD_FIELD_ERROR — the SELECT read
    // snake_case columns off `customers`, which is camelCase — so the message
    // blamed an absent upstream table and an operator flag, and the run wrote
    // status='completed' to cron_log. A bug in this file was reported, forever,
    // as somebody else's missing data.
    //
    // Unknown-column / unknown-table-alias is a CODE defect: it cannot be fixed
    // by waiting, it will never self-heal, and it must be loud.
    if (/ER_BAD_FIELD_ERROR|Unknown column|Unknown table/i.test(msg)) {
      log.error("cross-sell predictions query is BROKEN (bad column/table) — this job cannot select anything", { err: msg });
    } else if (/ER_NO_SUCH_TABLE|doesn't exist/i.test(msg)) {
      log.warn("v2 predictions read skipped · table not created yet", { err: msg });
    } else {
      log.error("cross-sell predictions read failed", { err: msg });
    }
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
      // Wording matters here: the old string said "treatment-arm ≥50%
      // confidence", which read as an upstream-data problem and sent every
      // investigation to serviceAffinityCompute. State the threshold in the
      // column's own units so a zero is checkable against the data.
      return {
        recordsProcessed: 0,
        details: `No treatment-arm predictions at confidence >= ${MIN_CONFIDENCE_TO_ACT} (0-1 scale)`,
      };
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
        INNER JOIN sms_conversations sc ON sc.id = m.conversationId
        WHERE m.direction = 'outbound'
          AND m.variantKey = 'cross_sell'
          AND m.createdAt >= ${cooldownDate}
      `)) as unknown as [Array<{ phone10: string | null }>];
      const rows = Array.isArray(cooldownRows) ? cooldownRows[0] : cooldownRows;
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r.phone10) cooldownSet.add(r.phone10);
        }
      }
    } catch (err) {
      // wave-fix-2026-05-25 (audit #101) · ABORT instead of proceeding
      // with empty cooldownSet. Previously this catch logged warn and
      // continued — silently routing cross-sell SMS to customers who
      // had been texted within the cooldown window (or worse, opted-out
      // customers in some failure modes). Opt-out compliance + TCPA
      // hygiene + brand trust ALL fail if we send when we don't know
      // who's in cooldown. Better to skip this run entirely and surface
      // the DB error than to risk re-spamming customers.
      log.error("cooldown lookup failed · ABORTING cross-sell run to protect opt-out compliance", {
        err: err instanceof Error ? err.message : String(err),
        errorId: "CROSS_SELL_COOLDOWN_LOOKUP_FAILED",
      });
      return {
        recordsProcessed: 0,
        details: `cooldown lookup failed · run aborted to protect opt-out compliance · err=${err instanceof Error ? err.message : String(err)}`,
      };
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
        // wave-fix-2026-05-25 (audit #100) · INSERT IGNORE prevents
        // duplicate impressions when the same prediction is processed
        // twice (relevant once cross-sell-outreach moves from daily to
        // hourly tier · same prediction could be encountered every 2h
        // until a new compute run replaces it). The UNIQUE KEY on
        // (prediction_id, surface) added in migration 0050 makes
        // INSERT IGNORE meaningful · without that key, IGNORE is a
        // no-op because there's no duplicate-key error to ignore.
        await db.execute(sql`
          INSERT IGNORE INTO prediction_impressions
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
      const fName = (p.customerName || "").trim().split(/\s+/)[0] || "there";

      /**
       * SAY WHAT THE CHECK IS FOR.
       *
       * SERVICE_LABELS has been declared at the top of this file with ten
       * services and referenced by NOTHING — its only mention was its own
       * declaration. Meanwhile `predictedService` is fetched (line 99), typed
       * (121), mapped (135), logged (273) and stored (302), and the message that
       * actually goes out says "about due for a check" with the prediction
       * sitting right there in hand. Computed and thrown away, at the last inch,
       * on the one line the customer reads.
       *
       * The wording stays a SOFT prompt, deliberately. "Your brake pads are worn"
       * would assert a mechanical fact about a part nobody has inspected — the
       * prediction is a statistical due-date, not a diagnosis. "Due for a brake
       * check" is specific enough to be worth reading and honest about what it is.
       *
       * An unknown service falls back to the original generic line rather than
       * printing a raw enum value at a customer.
       */
      const serviceLabel = SERVICE_LABELS[String(p.predictedService ?? "").toLowerCase()];
      const dueFor = serviceLabel ? `about due for ${serviceLabel}` : "about due for a check";
      const message = `Hey ${fName}, Nick's Tire & Auto here. Looks like your car is ${dueFor}. Free check, written quote, you don't pay until you say yes. Walk in any day. Reply STOP to opt out.`;

      const result = await sendSms(p.customerPhone, message, { via: "shop", skipPersist: true, variantKey: "cross_sell" });
      // wave-2026-06 (telemetry dedup) — a QUEUED send already has ONE tiered
      // row from queueForLater (now carries variantKey); logging here too
      // would double-count it as an untagged twin. Only log the online path.
      if (!result.queued) {
        const { logOutboundSms } = await import("../../services/smsInstrumentation");
        await logOutboundSms(p.customerPhone, message, result, "cross_sell");
      }

      if (result.success) {
        sent++;
        log.info(`v2 cross-sell SMS sent to ${fName} (${p.predictedService} · ${p.confidence}%)`, {
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
        log.warn(`v2 cross-sell SMS failed for ${fName}: ${result.error || "unknown"}`);
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
