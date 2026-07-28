/**
 * Cron: Declined Work Recovery
 *
 * Fires 7-day and 30-day SMS follow-ups to customers whose ALG walk-in
 * estimate was NEVER matched to an invoice — declined work = recovery target.
 *
 * Data source: `alg_estimates` table (populated by
 * server/services/shopDriverEstimateSync.ts).
 *
 * Rules:
 *   - Only rows where matchedInvoiceId IS NULL AND estimateDate >= today-60d
 *   - Send 7d SMS when age > 7d AND follow_up_7d_sent = 0
 *   - Send 30d SMS when age > 30d AND follow_up_30d_sent = 0
 *   - Respect customers.smsOptOut (checked by join against customer phone)
 *   - Business hours only (8am-7pm ET)
 *   - Feature-flag gated: env FEATURE_DECLINED_RECOVERY=1 enables actual
 *     sends. Without the flag, the cron runs as a DRY RUN (logs + Telegram
 *     alert with recoverable $ value, but no SMS out).
 *
 * This is a DAILY tier job — not aggressive. The goal is recovery, not
 * harassment. 7 days gives the customer time to get the work done
 * elsewhere (or change their mind). 30 days is a nudge before the
 * estimate goes cold.
 */

import { and, eq, gte, lte, isNull, sql } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { createLogger } from "../../lib/logger";
import {

  pickProfile,
  buildSequenceMessage,
  TOUCH_ORDER,
  touchToDays,
  variantKey,
  allowedTouches,
  statedConcernFromDb,
  RECOVERY_CLOSED_SIGNALS,
  type ObservedDeclineSignal,
} from "../../services/declinedRecoverySequence";
import { createHash } from "node:crypto";

// ─── Recovery Experiment v3 assignment (strike-5) ────────────────────
export const RECOVERY_EXPERIMENT_VERSION = "v3";
const RECOVERY_HOLDOUT_PCT = 15;

/**
 * Deterministic, version-stable arm assignment: sha256("<version>:<id>")
 * → first 8 hex chars → int % 100; below RECOVERY_HOLDOUT_PCT = control
 * (1), else treatment (0). Changing the version string re-randomizes
 * FUTURE assignments only — existing rows keep their stored arm.
 * Exported for tests.
 */
export function recoveryArmForEstimate(estimateId: number, version: string): 0 | 1 {
  const h = createHash("sha256").update(`${version}:${estimateId}`).digest("hex").slice(0, 8);
  return parseInt(h, 16) % 100 < RECOVERY_HOLDOUT_PCT ? 1 : 0;
}


const log = createLogger("cron:declined-recovery");

interface RecoveryResult {
  recordsProcessed: number;
  details: string;
}

function isBusinessHours(): boolean {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }),
    10,
  );
  return etHour >= 8 && etHour <= 19;
}

function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  const first = full.trim().split(/\s+/)[0];
  // Handle "LASTNAME, FIRSTNAME" pattern from ALG
  if (full.includes(",")) {
    const parts = full.split(",").map((s) => s.trim());
    return parts[1]?.split(/\s+/)[0] || parts[0] || "there";
  }
  return first || "there";
}

function formatMoney(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

// Wave-101: exported so the bulk-SMS tRPC endpoint can reuse the
// same templates the cron uses. Keeps message tone consistent.
// wave-181.46 brand-voice tightening per .claude/brand-voice-guidelines.md:
//   - Repair Haiku ("you don't pay until you say yes") added as the closer
//     on BOTH tiers. This is the EXACT moment the customer's resistance
//     is highest (they declined the quote once — what makes them say yes
//     this time?) so the relief mechanism lands hardest here.
//   - "Still on the fence" softened to customer-language phrasing
// revenue-truth-correction (2026-07-28): the fallbacks no longer claim
// the quote is "still good" / "we'll honor that pricing" — that's a
// pricing-policy commitment this system has no authority to make. The
// verifiable fact is the quote is ON FILE; the re-check is where price
// gets confirmed.
export function buildSevenDayMessage(params: {
  name: string;
  amountCents: number;
  service: string | null;
  profile?: string | null;
}): string {
  if (params.profile === "P0" || params.profile === "P1" || params.profile === "P2" || params.profile === "P3") {
    return buildSequenceMessage({
      touch: "7d",
      profile: params.profile,
      name: params.name,
      amountCents: params.amountCents,
      serviceDescription: params.service,
    });
  }
  const fName = firstName(params.name);
  return (
    `Hey ${fName}, Nick's Tire & Auto here. That quote we wrote up is still on file. ` +
    `Free re-check, no charge, you don't pay until you say yes. ` +
    `Drop off any day. Reply STOP to opt out.`
  );
}

export function buildThirtyDayMessage(params: {
  name: string;
  amountCents: number;
  profile?: string | null;
}): string {
  if (params.profile === "P0" || params.profile === "P1" || params.profile === "P2" || params.profile === "P3") {
    return buildSequenceMessage({
      touch: "30d",
      profile: params.profile,
      name: params.name,
      amountCents: params.amountCents,
      serviceDescription: null,
    });
  }
  const fName = firstName(params.name);
  return (
    `Hey ${fName}, Nick's Tire & Auto here. We still have that quote on file from a month ago. ` +
    `Free re-check first, and you don't pay until you say yes. ` +
    `(216) 862-0005. Reply STOP to opt out.`
  );
}

export { firstName as parseFirstName };

/**
 * wave-181.73 (architect-review · highest-leverage one-shot)
 *
 * Two consumers · daily cron (calls with no opts · uses safe default
 * cap of 20) AND the operator-driven one-shot script at
 * scripts/fire-declined-recovery.ts (passes a higher maxSends for a
 * bulk-clear of the backlog). Same code path, same safety guards —
 * just different volume budgets.
 *
 * Opts:
 *   maxSends  · override the per-run cap (default 20 · max 500)
 *   bypassBusinessHoursCheck · script-only · operator runs at 9 PM
 *     etc, but still respects the per-message sending-hours guard
 *     in sms.ts which queues out-of-hours messages for the morning
 *   skipDryRunGate · script-only · trust the operator's intent
 */
export interface RecoveryOptions {
  maxSends?: number;
  bypassBusinessHoursCheck?: boolean;
  skipDryRunGate?: boolean;
}

export async function runDeclinedWorkRecovery(opts?: RecoveryOptions): Promise<RecoveryResult> {
  if (!opts?.bypassBusinessHoursCheck && !isBusinessHours()) {
    return { recordsProcessed: 0, details: "skipped (outside business hours)" };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  const { algEstimates, customers } = await import("../../../drizzle/schema");

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // All unmatched estimates in the recovery window.
  //
  // wave-181.76 (self-audit) · query .limit() now scales with the per-run
  // cap. Pre-fix the query was hardcoded at .limit(100) while the script
  // advertised --max=500 — operator running fire-declined-recovery
  // --max=500 would see only 100 estimates considered. Now: pull cap+50
  // (small headroom for opt-outs / no-phone skips that filter the loop)
  // up to a hard 500 ceiling matching the script's documented max.
  const fetchLimit = Math.min((opts?.maxSends ?? 20) + 50, 500);
  const unmatched = await d
    .select({
      id: algEstimates.id,
      customerName: algEstimates.customerName,
      customerPhone: algEstimates.customerPhone,
      serviceDescription: algEstimates.serviceDescription,
      estimatedAmount: algEstimates.estimatedAmount,
      estimateDate: algEstimates.estimateDate,
      followUp3dSent: algEstimates.followUp3dSent,
      followUp3dAttemptedAt: algEstimates.followUp3dAttemptedAt,
      followUp7dSent: algEstimates.followUp7dSent,
      followUp7dAttemptedAt: algEstimates.followUp7dAttemptedAt,
      followUp14dSent: algEstimates.followUp14dSent,
      followUp14dAttemptedAt: algEstimates.followUp14dAttemptedAt,
      followUp30dSent: algEstimates.followUp30dSent,
      followUp30dAttemptedAt: algEstimates.followUp30dAttemptedAt,
      followUp45dSent: algEstimates.followUp45dSent,
      followUp45dAttemptedAt: algEstimates.followUp45dAttemptedAt,
      recoveryProfile: algEstimates.recoveryProfile,
      // Recovery 2.0 (0100): evidence routing + holdout measurement
      statedConcern: algEstimates.statedConcern,
      recoveryHoldout: algEstimates.recoveryHoldout,
    })
    .from(algEstimates)
    .where(
      and(
        isNull(algEstimates.matchedInvoiceId),
        gte(algEstimates.estimateDate, sixtyDaysAgo),
        lte(algEstimates.estimateDate, sevenDaysAgo),
      ),
    )
    .limit(fetchLimit);

  if (unmatched.length === 0) {
    return { recordsProcessed: 0, details: "No declined estimates eligible for follow-up" };
  }

  // Total recoverable exposure for the report
  const totalRecoverableCents = unmatched.reduce(
    (sum: number, e: { estimatedAmount: number | null }) => sum + (e.estimatedAmount || 0),
    0,
  );

  const featureEnabled = process.env.FEATURE_DECLINED_RECOVERY === "1" || opts?.skipDryRunGate === true;

  // DRY RUN path — report but don't send
  if (!featureEnabled) {
    log.info(
      `DRY RUN: ${unmatched.length} declined estimates eligible (${formatMoney(totalRecoverableCents)} recoverable). ` +
        `Set FEATURE_DECLINED_RECOVERY=1 to enable sends.`,
    );
    try {
      // wave-181.72 (highest-leverage move) · LOUD Telegram alert with
      // the actual dollar amount + explicit Railway instruction. The
      // prior message was generic and easy to dismiss · this version
      // hits with money-on-the-table framing so the operator sees the
      // pipeline value at a glance from their phone.
      const { sendTelegramMessage } = await import("../../services/telegram");
      await sendTelegramMessage(
        `🔴 <b>${formatMoney(totalRecoverableCents)} IDLE — recovery cron is DRY-RUN</b>\n\n` +
          `${unmatched.length} walked-away estimates have NEVER received a follow-up.\n\n` +
          `<b>1 click on Railway to unleash:</b>\n` +
          `<code>FEATURE_DECLINED_RECOVERY=1</code>\n\n` +
          `Once set: 7d + 30d SMS auto-fires daily at 20/run cap.\n` +
          `Safety: at-most-once claim (wave-181.59) · TCPA opt-out (wave-181.60) · durable rate-limit (wave-181.68).`,
        "critical",
      );
    } catch (e) {
      log.warn("[declined-recovery] telegram notify failed:", e);
    }
    return {
      recordsProcessed: unmatched.length,
      details: `DRY RUN: ${unmatched.length} eligible, ${formatMoney(totalRecoverableCents)} recoverable — flip FEATURE_DECLINED_RECOVERY=1`,
    };
  }

  // LIVE send path — feature-flagged on
  const { sendSms } = await import("../../sms");
  // wave-181.110 · 5×3 sequence touch counters · maintain legacy 7d/30d
  // for Telegram summary continuity, add 3d/14d/45d.
  let sent3d = 0;
  let sent7d = 0;
  let sent14d = 0;
  let sent30d = 0;
  let sent45d = 0;
  let skippedOptOut = 0;
  let skippedNoPhone = 0;
  let skippedClosed = 0;   // Recovery 2.0: customer said repaired-elsewhere / sold / not-interested
  let skippedHoldout = 0;  // Recovery 2.0: control group — never contacted, measured against
  let perRowErrors = 0;

  // wave-117 · per-run cap. Even with .limit(100) on the query above,
  // an unbounded send loop is a cost-runaway + reputation risk if the
  // filter ever widens (e.g. a date math bug). 20 is the safe daily
  // default for cron. wave-181.73 made it overridable via opts so a
  // one-shot operator script can clear a backlog in a single run
  // (capped at 500 hard ceiling to keep us under the F25e Verizon
  // daily-throughput safe zone for an SMS Gateway phone number).
  const MAX_SMS_PER_RUN = Math.min(opts?.maxSends ?? 20, 500);

  // wave-121 — bulk-load opt-out phones BEFORE the loop. Was: a SELECT
  // against customers per estimate (up to 100 round-trips per run), with
  // a `RIGHT(REPLACE(...))` string transform that defeated the
  // uniq_customer_phone index → full table scan EACH iteration.
  // Now: one query that pulls all opt-outs with last-10-digits computed
  // server-side once, then in-memory check during the loop.
  const optOutSet = new Set<string>();
  try {
    const optOutRows = await d
      .select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.smsOptOut, 1));
    for (const row of optOutRows) {
      if (row.phone) optOutSet.add(row.phone.replace(/\D/g, "").slice(-10));
    }
    log.info(`[declined-recovery] preloaded ${optOutSet.size} opt-out phones`);
  } catch (e) {
    log.warn("[declined-recovery] opt-out preload failed; defaulting to empty set", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // wave-181.82 · preload customer data for the estimates we're about to
  // process · indexed by phone-last10. Enables (a) personalized SMS copy
  // (vehicle reference · repeat-customer warmth · service-category language)
  // and (b) the recovery-score ranking that prioritizes higher-conversion-
  // probability estimates within the per-run cap. Same N+1 collapse pattern
  // wave-181.61 used for opt-out preload.
  type CustomerCtx = { totalVisits: number | null; vehicleYear: string | null; vehicleMake: string | null; vehicleModel: string | null };
  const customerByPhoneLast10 = new Map<string, CustomerCtx>();
  try {
    // Collect unique phone-last10 from the unmatched batch
    const targetPhones = new Set<string>();
    for (const est of unmatched) {
      if (est.customerPhone) targetPhones.add(est.customerPhone.replace(/\D/g, "").slice(-10));
    }
    if (targetPhones.size > 0) {
      const targetArr = [...targetPhones];
      // Use the wave-181.60 RIGHT(REGEXP_REPLACE) pattern that defeats
      // legacy un-normalized phones · join on last-10 digits regardless
      // of stored format. Filter early to keep the result set small.
      const custRows = await d
        .select({
          phone: customers.phone,
          totalVisits: customers.totalVisits,
          vehicleYear: customers.vehicleYear,
          vehicleMake: customers.vehicleMake,
          vehicleModel: customers.vehicleModel,
        })
        .from(customers)
        .where(sql`RIGHT(REGEXP_REPLACE(${customers.phone}, '[^0-9]', ''), 10) IN (${sql.join(targetArr.map((p) => sql`${p}`), sql`, `)})`);
      for (const c of custRows) {
        const k = (c.phone ?? "").replace(/\D/g, "").slice(-10);
        if (k.length === 10) customerByPhoneLast10.set(k, {
          totalVisits: c.totalVisits ?? 0,
          vehicleYear: c.vehicleYear ?? null,
          vehicleMake: c.vehicleMake ?? null,
          vehicleModel: c.vehicleModel ?? null,
        });
      }
      log.info(`[declined-recovery] preloaded ${customerByPhoneLast10.size} customer contexts for ${unmatched.length} estimates`);
    }
  } catch (e) {
    log.warn("[declined-recovery] customer-context preload failed · falling back to generic templates", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // wave-181.82 · sort by recovery score so the per-run cap targets the
  // highest-conversion-probability estimates first. With FEATURE_DECLINED_
  // RECOVERY=1 the cap is binding (20/run/daily by default) so this is
  // where the personalization investment pays off · operator runs see the
  // estimates most likely to convert sent first · stale-but-low-score
  // rows naturally roll forward to subsequent runs.
  const { scoreEstimateForRecovery } = await import("../../services/recoveryTargeting");
  // wave-181.110 · 5×3 sequence (3d/7d/14d/30d/45d × 3 profiles)
  type EstRow = typeof unmatched[number];
  type Ranked = { est: EstRow; customer: CustomerCtx | null; score: number };
  const ranked: Ranked[] = unmatched
    .map((est: EstRow): Ranked => {
      const k = (est.customerPhone ?? "").replace(/\D/g, "").slice(-10);
      const customer = customerByPhoneLast10.get(k) ?? null;
      const score = scoreEstimateForRecovery({
        estimatedAmount: est.estimatedAmount,
        estimateDate: est.estimateDate,
        serviceDescription: est.serviceDescription,
        customer,
      });
      return { est, customer, score };
    })
    .sort((a: Ranked, b: Ranked) => b.score - a.score);

  // Per-touch counter (mutated by sendOneTouch)
  const sentByTouch: Record<string, number> = { "3d": 0, "7d": 0, "14d": 0, "30d": 0, "45d": 0 };
  const totalSentSoFar = () => sentByTouch["3d"] + sentByTouch["7d"] + sentByTouch["14d"] + sentByTouch["30d"] + sentByTouch["45d"];

  for (const { est, customer } of ranked) {
    if (totalSentSoFar() >= MAX_SMS_PER_RUN) {
      log.info(`[declined-recovery] hit per-run cap of ${MAX_SMS_PER_RUN} sends, stopping early`);
      break;
    }

    // wave-117 — per-row try/catch. Was: any single bad row (DB error
    // on the followUp30dSent UPDATE, e.g. a missing column on a fresh
    // deploy) threw and unwound the entire loop, leaving subsequent
    // estimates unprocessed with no log per skipped row. Now contained:
    // log + continue.
    try {
      if (!est.customerPhone) {
        skippedNoPhone++;
        continue;
      }

      // wave-121 — was a per-row SELECT against customers; now in-memory
      // Set lookup against the preloaded opt-out phones.
      const normalized = est.customerPhone.replace(/\D/g, "").slice(-10);
      if (optOutSet.has(normalized)) {
        skippedOptOut++;
        continue;
      }

      // ── Recovery 2.0 · closed signals END recovery for the estimate ──
      // The customer told us the outcome (fixed elsewhere / sold the car /
      // not interested) — continuing to text would be texting past a
      // stated answer.
      if (
        est.statedConcern &&
        RECOVERY_CLOSED_SIGNALS.includes(est.statedConcern as ObservedDeclineSignal)
      ) {
        skippedClosed++;
        continue;
      }

      // ── Recovery Experiment v3 · versioned hash assignment ───────────
      // Assigned at FIRST send-eligibility so control and treated pools
      // share entry criteria. v3 (strike-5): stable sha256 hash of
      // version+id (raw id-modulo correlates arm with insertion order and
      // silently reassigns if the formula ever changes), stamped with
      // experiment version + assignment time so the readout can run
      // intention-to-treat on post-assignment windows and exclude
      // legacy-policy rows. Rows already assigned KEEP their arm —
      // changing an in-flight assignment would contaminate both arms.
      let holdout = est.recoveryHoldout as number | null;
      if (holdout === null || holdout === undefined) {
        holdout = recoveryArmForEstimate(est.id, RECOVERY_EXPERIMENT_VERSION);
        try {
          await d.update(algEstimates).set({
            recoveryHoldout: holdout,
            recoveryExperimentVersion: RECOVERY_EXPERIMENT_VERSION,
            recoveryAssignedAt: new Date(),
          }).where(eq(algEstimates.id, est.id));
        } catch (e) {
          log.warn(`[declined-recovery] holdout persist failed for ${est.id}`, { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (holdout === 1) {
        skippedHoldout++;
        continue;
      }

      const ageMs = now.getTime() - est.estimateDate.getTime();
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const name = firstName(est.customerName);
      const amount = est.estimatedAmount || 0;

      // wave-181.51 — persist outbound sends to sms_messages so the
      // /admin SMS Performance tile can read reply + conversion rates.
      const { logOutboundSms } = await import("../../services/smsInstrumentation");

      // wave-181.110 · Profile resolution · sticky per estimate.
      // Reads cached est.recoveryProfile first; if null, computes via
      // pickProfile() and writes back so subsequent touches stay
      // consistent even if customer signals shift.
      // revenue-truth-correction: pickProfile is evidence-only now — with
      // no statedConcern available here, every NEW estimate lands on the
      // P0 neutral track. Legacy sticky P1-P3 rows keep their track (the
      // copy is honest for any recipient) but no new psychographic
      // assignment happens from vehicle/service/amount proxies.
      type ProfileCode = "P0" | "P1" | "P2" | "P3";
      // Recovery 2.0: a stated concern is EVIDENCE and beats any sticky
      // legacy assignment — recompute the track whenever one exists.
      const observedConcern = statedConcernFromDb(est.statedConcern);
      let profile: ProfileCode = (est.recoveryProfile as ProfileCode | null) ?? null as unknown as ProfileCode;
      if (observedConcern) {
        const evidenceProfile = pickProfile({
          amountCents: amount,
          serviceDescription: est.serviceDescription,
          statedConcern: observedConcern,
        });
        if (evidenceProfile !== profile) {
          profile = evidenceProfile;
          try {
            await d.update(algEstimates).set({ recoveryProfile: profile }).where(eq(algEstimates.id, est.id));
          } catch (e) {
            log.warn(`[declined-recovery] evidence profile persist failed for ${est.id}`, { error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      if (!profile) {
        profile = pickProfile({
          amountCents: amount,
          serviceDescription: est.serviceDescription,
          totalVisits: customer?.totalVisits ?? 0,
          vehicleMake: customer?.vehicleMake ?? null,
          vehicleYear: customer?.vehicleYear ?? null,
          declineRate: null,
          customerType: null,
          statedConcern: null, // no stated concern on file → P0
        });
        // Persist for future touches (don't fail the loop if write errors)
        try {
          await d.update(algEstimates).set({ recoveryProfile: profile }).where(eq(algEstimates.id, est.id));
        } catch (e) {
          log.warn(`[declined-recovery] profile persist failed for ${est.id}`, { error: e instanceof Error ? e.message : String(e) });
        }
      }

      // wave-181.110 · 5-touch loop · process highest-priority unattempted
      // touch per estimate per cron run · TOUCH_ORDER = ["30d","14d","7d","45d","3d"].
      // Stops after one send per estimate so the daily cap of 20 spreads
      // across more customers, not five touches to one customer in one run.
      let touchSentThisRun = false;
      // Recovery 2.0 · 1-3 adaptive touches: evidence tracks get 2
      // targeted touches; P0 gets 2 neutral (3rd only if ≥$300 or
      // safety service). 3d/45d retired from sending. TOUCH_ORDER is
      // intersected (not replaced) so priority + attempted-column
      // semantics are unchanged.
      const allowed = allowedTouches({ profile, amountCents: amount, serviceDescription: est.serviceDescription });
      for (const touch of TOUCH_ORDER) {
        if (!allowed.includes(touch)) continue;
        const days = touchToDays(touch);
        if (ageDays < days) continue;

        // Read the per-touch sent + attempted columns by name
        const sentCol = `followUp${touch}Sent` as keyof typeof est;
        const attemptedCol = `followUp${touch}AttemptedAt` as keyof typeof est;
        if ((est as unknown as Record<string, number>)[sentCol as string]) continue;
        if ((est as unknown as Record<string, Date | null>)[attemptedCol as string]) continue;

        // wave-181.59 · at-most-once claim · stamp AttemptedAt BEFORE send.
        // Branch on touch since drizzle .set() needs static column names.
        let claimResult: unknown;
        if (touch === "3d") {
          claimResult = await d.update(algEstimates).set({ followUp3dAttemptedAt: new Date() })
            .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.followUp3dAttemptedAt)));
        } else if (touch === "7d") {
          claimResult = await d.update(algEstimates).set({ followUp7dAttemptedAt: new Date() })
            .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.followUp7dAttemptedAt)));
        } else if (touch === "14d") {
          claimResult = await d.update(algEstimates).set({ followUp14dAttemptedAt: new Date() })
            .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.followUp14dAttemptedAt)));
        } else if (touch === "30d") {
          claimResult = await d.update(algEstimates).set({ followUp30dAttemptedAt: new Date() })
            .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.followUp30dAttemptedAt)));
        } else {
          claimResult = await d.update(algEstimates).set({ followUp45dAttemptedAt: new Date() })
            .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.followUp45dAttemptedAt)));
        }
        const claimRaw = (Array.isArray(claimResult) && claimResult[0] && typeof claimResult[0] === "object"
          ? claimResult[0]
          : claimResult) as { affectedRows?: number; rowsAffected?: number };
        const claimed = claimRaw.affectedRows ?? claimRaw.rowsAffected ?? 0;
        if (claimed === 0) {
          log.info(`[declined-recovery] ${touch} claim lost for estimate ${est.id} (peer or prior attempt)`);
          continue;
        }

        // wave-181.110 · profile-aware sequence message · 1 of 15 variants
        const body = buildSequenceMessage({
          touch,
          profile,
          name,
          amountCents: amount,
          serviceDescription: est.serviceDescription,
          customer,
        });
        const vKey = variantKey(touch, profile);
        const res = await sendSms(est.customerPhone, body, { via: "shop", skipPersist: true, variantKey: vKey });
        // wave-2026-06 (telemetry dedup) — a QUEUED send already has ONE
        // tiered row from queueForLater (it carries variantKey now); logging
        // here too would double-count it as an untagged twin. Only log the
        // online path, where skipPersist made logOutboundSms the sole writer.
        if (!res.queued) {
          await logOutboundSms(est.customerPhone, body, res, vKey);
        }

        if (res.success) {
          // Mark sent column (touch-specific, like the claim above)
          if (touch === "3d") {
            await d.update(algEstimates).set({ followUp3dSent: 1, followUp3dSentAt: new Date() }).where(eq(algEstimates.id, est.id));
          } else if (touch === "7d") {
            await d.update(algEstimates).set({ followUp7dSent: 1, followUp7dSentAt: new Date() }).where(eq(algEstimates.id, est.id));
          } else if (touch === "14d") {
            await d.update(algEstimates).set({ followUp14dSent: 1, followUp14dSentAt: new Date() }).where(eq(algEstimates.id, est.id));
          } else if (touch === "30d") {
            await d.update(algEstimates).set({ followUp30dSent: 1, followUp30dSentAt: new Date() }).where(eq(algEstimates.id, est.id));
          } else {
            await d.update(algEstimates).set({ followUp45dSent: 1, followUp45dSentAt: new Date() }).where(eq(algEstimates.id, est.id));
          }
          sentByTouch[touch] = (sentByTouch[touch] ?? 0) + 1;
          if (touch === "3d") sent3d++;
          else if (touch === "7d") sent7d++;
          else if (touch === "14d") sent14d++;
          else if (touch === "30d") sent30d++;
          else sent45d++;
          log.info(`${touch}/${profile} sent to ${name} (${formatMoney(amount)} quote)`);
        } else {
          log.error(`[declined-recovery] ${touch} send failed after claim for estimate ${est.id}`, {
            error: res.error ?? "unknown",
          });
        }

        touchSentThisRun = true;
        break; // one touch per estimate per run (spread, not blast)
      }
      if (!touchSentThisRun) {
        // No eligible touch (estimate too fresh, or all touches already sent/attempted)
      }
    } catch (rowErr) {
      perRowErrors++;
      log.warn(`[declined-recovery] estimate ${est.id} failed`, {
        error: rowErr instanceof Error ? rowErr.message : String(rowErr),
      });
      // continue — don't kill the whole batch on one bad row
    }
  }

  const total = sent3d + sent7d + sent14d + sent30d + sent45d;
  if (total > 0) {
    try {
      const { sendTelegram } = await import("../../services/telegram");
      await sendTelegram(
        `📬 DECLINED WORK RECOVERY: ${total} SMS sent ` +
          `(${sent3d} 3d · ${sent7d} 7d · ${sent14d} 14d · ${sent30d} 30d · ${sent45d} 45d). ` +
          `Pool: ${formatMoney(totalRecoverableCents)} from ${unmatched.length} quotes.` +
          (perRowErrors > 0 ? ` ⚠️ ${perRowErrors} row errors — see server logs.` : ""),
      );
    } catch (e) {
      log.warn("[declined-recovery] telegram notify failed:", e);
    }
  }

  return {
    recordsProcessed: total,
    details: `Sent ${sent3d}/3d + ${sent7d}/7d + ${sent14d}/14d + ${sent30d}/30d + ${sent45d}/45d | skipped: ${skippedOptOut} opt-out, ${skippedNoPhone} no phone, ${skippedClosed} closed-signal, ${skippedHoldout} holdout | pool: ${formatMoney(totalRecoverableCents)}`,
  };
}
