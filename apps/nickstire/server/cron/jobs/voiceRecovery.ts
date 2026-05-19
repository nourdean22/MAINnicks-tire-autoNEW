/**
 * Voice Recovery Cron · wave-181.87 (VAPI implementation · same operator
 * preference as confirmation-calls: keep VAPI · don't add a second vendor)
 *
 * Fires for declined estimates that received D7 + D30 SMS (waves 181.46/
 * 82) but didn't convert. Places a VAPI outbound call with the recovery-
 * prompt assistantOverride · brand-voice "no pressure" closer.
 *
 * Eligibility (AND):
 *   - followUp30dSent = 1
 *   - matched_invoice_id IS NULL
 *   - voice_recovery_attempted_at IS NULL
 *   - follow_up_30d_sent_at < NOW() - 7 days
 *   - customer_phone IS NOT NULL
 *   - customer not opted out
 *
 * Gates (same as confirmation-calls plus a feature flag):
 *   - VAPI_API_KEY
 *   - VAPI_PHONE_NUMBER_ID
 *   - VAPI_FOLLOW_UP_ASSISTANT_ID (already set if wave-181.50 done)
 *   - FEATURE_VOICE_RECOVERY=1
 *
 * Per-run cap default 5 (stale cold leads · conserve cost). Override via
 * VAPI_RECOVERY_BATCH_SIZE env (max 20).
 */
import { createLogger } from "../../lib/logger";
import { and, eq, lte, isNull, isNotNull } from "drizzle-orm";

const log = createLogger("cron:voice-recovery");

interface RunResult {
  recordsProcessed: number;
  details: string;
}

export async function runVoiceRecovery(): Promise<RunResult> {
  if (!process.env.VAPI_API_KEY) {
    return { recordsProcessed: 0, details: "Skipped · VAPI_API_KEY missing" };
  }
  if (process.env.FEATURE_VOICE_RECOVERY !== "1") {
    return { recordsProcessed: 0, details: "Skipped · FEATURE_VOICE_RECOVERY != '1'" };
  }
  if (!process.env.VAPI_PHONE_NUMBER_ID) {
    return { recordsProcessed: 0, details: "Skipped · VAPI_PHONE_NUMBER_ID missing" };
  }

  const maxCalls = Math.min(Number(process.env.VAPI_RECOVERY_BATCH_SIZE) || 5, 20);

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  const { algEstimates, customers } = await import("../../../drizzle/schema");
  const { placeVapiOutboundCall, buildOutboundRecoveryPrompt } = await import("../../services/vapi");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  type EstRow = {
    id: number;
    customerName: string | null;
    customerPhone: string | null;
    serviceDescription: string | null;
    estimatedAmount: number | null;
  };
  let candidates: EstRow[] = [];
  try {
    candidates = await d
      .select({
        id: algEstimates.id,
        customerName: algEstimates.customerName,
        customerPhone: algEstimates.customerPhone,
        serviceDescription: algEstimates.serviceDescription,
        estimatedAmount: algEstimates.estimatedAmount,
      })
      .from(algEstimates)
      .where(and(
        eq(algEstimates.followUp30dSent, 1),
        isNull(algEstimates.matchedInvoiceId),
        isNull(algEstimates.voiceRecoveryAttemptedAt),
        isNotNull(algEstimates.followUp30dSentAt),
        lte(algEstimates.followUp30dSentAt, sevenDaysAgo),
        isNotNull(algEstimates.customerPhone),
      ))
      .limit(maxCalls + 5);
  } catch (err) {
    log.warn("[voice-recovery] candidate query failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, details: "Failed to load candidates" };
  }

  if (candidates.length === 0) {
    return { recordsProcessed: 0, details: "No estimates eligible for voice recovery" };
  }

  // Preload opt-outs (wave-181.61 pattern)
  const optOutSet = new Set<string>();
  try {
    const rows = await d.select({ phone: customers.phone }).from(customers).where(eq(customers.smsOptOut, 1));
    for (const r of rows) {
      if (r.phone) optOutSet.add(r.phone.replace(/\D/g, "").slice(-10));
    }
  } catch { /* fail-soft */ }

  let placed = 0;
  let failed = 0;
  let skipped = 0;

  for (const est of candidates) {
    if (placed >= maxCalls) break;
    if (!est.customerPhone) { skipped++; continue; }
    const normalized = est.customerPhone.replace(/\D/g, "").slice(-10);
    if (optOutSet.has(normalized)) { skipped++; continue; }

    const digits = est.customerPhone.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` :
      digits.length === 11 && digits.startsWith("1") ? `+${digits}` :
      est.customerPhone.startsWith("+") ? est.customerPhone : `+1${digits.slice(-10)}`;

    // At-most-once claim
    const claimResult = await d
      .update(algEstimates)
      .set({ voiceRecoveryAttemptedAt: new Date(), voiceRecoveryOutcome: "pending" })
      .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.voiceRecoveryAttemptedAt)));
    const claimRaw = (Array.isArray(claimResult) && claimResult[0] && typeof claimResult[0] === "object" ? claimResult[0] : claimResult) as { affectedRows?: number; rowsAffected?: number };
    const claimed = claimRaw.affectedRows ?? claimRaw.rowsAffected ?? 0;
    if (claimed === 0) {
      log.info(`[voice-recovery] claim lost for est ${est.id} (peer or prior attempt)`);
      skipped++;
      continue;
    }

    const firstName = (est.customerName || "there").split(" ")[0];
    const dollars = Math.round((est.estimatedAmount ?? 0) / 100);
    const service = (est.serviceDescription || "the work we quoted").slice(0, 80);

    const systemPrompt = buildOutboundRecoveryPrompt({
      customerName: firstName,
      service,
      amountDollars: dollars,
    });
    const firstMessage = `Hi ${firstName}, this is Nick's Tire & Auto · just checking in on that ${service} quote from a few weeks back. Do you have a sec?`;

    const call = await placeVapiOutboundCall({
      customerNumber: e164,
      firstMessageOverride: firstMessage,
      systemPromptOverride: systemPrompt,
      maxDurationSeconds: 90,
    });

    if (call.success && call.callId) {
      await d
        .update(algEstimates)
        .set({ voiceRecoveryCallId: call.callId, voiceRecoveryOutcome: "dialing" })
        .where(eq(algEstimates.id, est.id));
      placed++;
      log.info(`[voice-recovery] placed VAPI call ${call.callId} for est ${est.id} (${firstName} · $${dollars})`);
    } else {
      await d
        .update(algEstimates)
        .set({ voiceRecoveryOutcome: "failed" })
        .where(eq(algEstimates.id, est.id));
      failed++;
      log.warn(`[voice-recovery] place failed for est ${est.id}`, { error: call.error });
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  return {
    recordsProcessed: placed,
    details: `placed=${placed} skipped=${skipped} failed=${failed}`,
  };
}
