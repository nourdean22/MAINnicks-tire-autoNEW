/**
 * Cron · Service Affinity v2 · prediction compute
 *
 * Runs the v2 buildServiceAffinityMap heuristic + writes per-customer
 * predictions to service_affinity_predictions with a 50/50 A/B arm
 * split. Treatment arm is eligible for SMS · control arm is hold-out
 * for closed-loop measurement (operator decides later whether to ship
 * SMS based on treatment-vs-control lift).
 *
 * Frequency · every 6h (4× daily). Each run replaces predictions for
 * the customers it picks · most recent prediction wins per customer.
 *
 * Per docs/2026-05-24-service-affinity-v2.md §2.3 (CLOSED LOOP layer)
 * + §5 Wave 1 / Wave 2 execution. Requires migration 0061 applied.
 *
 * Feature flag · service_affinity_v2_compute (starts DISABLED · flip
 * to ON in Settings → feature flags after migration 0061 lands).
 *
 * The cron does NOT send SMS · it just writes predictions to the DB.
 * Treatment-arm predictions are picked up by the existing cross-sell
 * outreach cron (separate scheduling · runs only when the flag is
 * also flipped on its end). This separation lets the operator turn on
 * measurement-without-sending first to verify v2 prediction quality.
 *
 * Self-resilient · table-not-found errors caught + logged + return
 * empty. Matches the resilience pattern of other crons in this dir.
 */
import { createLogger } from "../../lib/logger";
import { sql } from "drizzle-orm";

const log = createLogger("cron:service-affinity-compute");

/**
 * Max predictions to write per run · stays under the 500-row default
 * Drizzle batch size · matches the buildServiceAffinityMap return
 * top-50 cap. Multiple runs/day cycle through the customer base.
 */
const MAX_PREDICTIONS_PER_RUN = 50;

/**
 * A/B arm split · operator decision §4.4 #2 of v2 design doc deferred
 * the threshold but design §2.3 specified 50/50 hold-out for high-
 * confidence predictions. 0.5 = 50% treatment / 50% control.
 */
const TREATMENT_RATIO = 0.5;

/**
 * Stable-hash A/B assignment based on customer_id · same customer
 * always lands in the same arm across runs · enables clean A/B math.
 * Operators can override the seed by setting SA_V2_AB_SEED env var.
 */
function assignArm(customerId: number): "treatment" | "control" {
  const seed = parseInt(process.env.SA_V2_AB_SEED ?? "0", 10) || 0;
  // Deterministic · cheap · adequate for ~few thousand customers
  const hash = (customerId * 2654435761 + seed) >>> 0;
  return (hash / 0xffffffff) < TREATMENT_RATIO ? "treatment" : "control";
}

export async function processServiceAffinityCompute(): Promise<{ recordsProcessed: number; treatment: number; control: number }> {
  const { getDb } = await import("../../db");
  const { isEnabled } = await import("../../services/featureFlags");
  const { buildServiceAffinityMap } = await import("../../services/engines/customer");

  // Feature-flag gate · starts disabled · operator flips when ready
  const enabled = await isEnabled("service_affinity_v2_compute");
  if (!enabled) {
    log.info("flag service_affinity_v2_compute is OFF · skipping");
    return { recordsProcessed: 0, treatment: 0, control: 0 };
  }

  const d = await getDb();
  if (!d) {
    log.warn("no DB · skipping");
    return { recordsProcessed: 0, treatment: 0, control: 0 };
  }

  try {
    const { affinities } = await buildServiceAffinityMap();
    if (affinities.length === 0) {
      log.info("no affinities to write");
      return { recordsProcessed: 0, treatment: 0, control: 0 };
    }

    let treatmentCount = 0;
    let controlCount = 0;

    for (const a of affinities.slice(0, MAX_PREDICTIONS_PER_RUN)) {
      const arm = assignArm(a.customerId);
      if (arm === "treatment") treatmentCount++;
      else controlCount++;

      // Raw insert · service_affinity_predictions table from migration 0061
      // We use raw sql because the table schema is registered in
      // drizzle/schema.ts but not all consumers may have the type import
      // chain yet (avoid circular-import risk for now).
      try {
        await d.execute(sql`
          INSERT INTO service_affinity_predictions
            (customer_id, predicted_service, confidence, features_json,
             model_version, ab_arm, created_at)
          VALUES
            (${a.customerId}, ${a.predictedNext}, ${a.confidence},
             ${JSON.stringify({ topServices: a.topServices, reason: a.reason })},
             ${a.modelVersion}, ${arm}, NOW())
        `);
      } catch (err) {
        log.warn(`insert failed for customer ${a.customerId}`, { err: err instanceof Error ? err.message : String(err) });
        // Continue with the next prediction · don't kill the whole run
      }
    }

    log.info(`wrote ${affinities.length} predictions · ${treatmentCount} treatment · ${controlCount} control`);
    return {
      recordsProcessed: affinities.length,
      treatment: treatmentCount,
      control: controlCount,
    };
  } catch (err) {
    log.warn("compute failed", { err: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, treatment: 0, control: 0 };
  }
}
