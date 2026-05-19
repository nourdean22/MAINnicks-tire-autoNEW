/**
 * Voice Recovery Cron · wave-181.85
 *
 * Fires for declined estimates that have ALREADY received their 30d SMS
 * (wave-181.46/82) but STILL haven't converted to an invoice. Voice
 * call is the escalation · different channel = different conversion
 * rate. Industry data: voice converts ~3× SMS for stale leads.
 *
 * Eligibility (AND):
 *   - followUp30dSent = 1 (D30 SMS already went out)
 *   - matched_invoice_id IS NULL (still no conversion)
 *   - voice_recovery_attempted_at IS NULL (never voice-called)
 *   - follow_up_30d_sent_at < NOW() - 7 days (give SMS time to land)
 *   - customer_phone IS NOT NULL
 *   - customer not opted out
 *
 * Gates · same 3 env vars as confirmation-calls plus a separate agent ID
 * (operator may want a different persona for recovery vs confirmation):
 *   - AGENTPHONE_API_KEY
 *   - FEATURE_VOICE_RECOVERY=1
 *   - AGENTPHONE_RECOVERY_AGENT_ID (separate from CONFIRMATION_AGENT_ID)
 *
 * Per-run cap · default 5 (lower than confirmation · these are stale
 * cold leads · lower conversion · don't burn dial-rate budget on them).
 * AGENTPHONE_RECOVERY_BATCH_SIZE env override · max 20.
 */
import { createLogger } from "../../lib/logger";
import { and, eq, gte, lte, isNull, isNotNull, sql } from "drizzle-orm";

const log = createLogger("cron:voice-recovery");

interface RunResult {
  recordsProcessed: number;
  details: string;
}

export async function runVoiceRecovery(): Promise<RunResult> {
  const apiKey = process.env.AGENTPHONE_API_KEY;
  const flagOn = process.env.FEATURE_VOICE_RECOVERY === "1";
  const agentId = process.env.AGENTPHONE_RECOVERY_AGENT_ID;

  if (!apiKey || !flagOn) {
    return { recordsProcessed: 0, details: "Skipped · AGENTPHONE_API_KEY or FEATURE_VOICE_RECOVERY not set" };
  }
  if (!agentId) {
    log.warn("[voice-recovery] AGENTPHONE_RECOVERY_AGENT_ID missing · cannot place calls");
    return { recordsProcessed: 0, details: "Skipped · AGENTPHONE_RECOVERY_AGENT_ID env missing" };
  }

  const maxCalls = Math.min(Number(process.env.AGENTPHONE_RECOVERY_BATCH_SIZE) || 5, 20);

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  const { algEstimates, customers } = await import("../../../drizzle/schema");
  const { placeCall } = await import("../../services/agentphone");

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

  // Preload opt-outs (same wave-181.61 pattern)
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
    if (!est.customerPhone) {
      skipped++;
      continue;
    }
    const normalized = est.customerPhone.replace(/\D/g, "").slice(-10);
    if (optOutSet.has(normalized)) {
      skipped++;
      continue;
    }
    // E.164 normalize
    const digits = est.customerPhone.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` :
      digits.length === 11 && digits.startsWith("1") ? `+${digits}` :
      est.customerPhone.startsWith("+") ? est.customerPhone : `+1${digits.slice(-10)}`;

    // At-most-once claim · UPDATE WHERE voice_recovery_attempted_at IS NULL
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

    const systemPrompt = [
      `You are calling on behalf of Nick's Tire & Auto in Cleveland, OH.`,
      `Customer ${firstName} got a $${dollars} quote for ${service} about 5-6 weeks ago.`,
      `They didn't book. The SMS follow-ups haven't gotten a response.`,
      ``,
      `RULES:`,
      `1. Be warm + brief · 60-90 seconds total · operator's time matters.`,
      `2. Open: "Hi ${firstName}, this is Nick's Tire & Auto · just checking in on that ${service} quote from a few weeks back."`,
      `3. Re-offer: free re-check · we honor the original quote · you don't pay until you say yes.`,
      `4. Ask: "Anything we can do to help you decide?"`,
      `5. If they're interested: tell them to drop off any day · we're at 17625 Euclid Ave · end the call.`,
      `6. If not interested: thank them · "no pressure · we're here when you need us" · end the call.`,
      `7. If voicemail: leave brief message · "Hi ${firstName}, Nick's Tire calling about that ${service} quote · still good · call us at 216-862-0005 anytime." End the call.`,
      `8. Natural human language · NEVER say "I am an AI" unless asked directly.`,
      `9. NEVER pressure · NEVER push back if they decline · just end the call gracefully.`,
    ].join("\n");

    const call = await placeCall({
      agentId,
      toNumber: e164,
      initialGreeting: `Hi ${firstName}, this is Nick's Tire & Auto · do you have 30 seconds?`,
      systemPrompt,
    });

    if (call.success && call.callId) {
      await d
        .update(algEstimates)
        .set({ voiceRecoveryCallId: call.callId, voiceRecoveryOutcome: "dialing" })
        .where(eq(algEstimates.id, est.id));
      placed++;
      log.info(`[voice-recovery] placed call ${call.callId} for est ${est.id} (${firstName} · $${dollars})`);
    } else {
      await d
        .update(algEstimates)
        .set({ voiceRecoveryOutcome: "failed" })
        .where(eq(algEstimates.id, est.id));
      failed++;
      log.warn(`[voice-recovery] place failed for est ${est.id}`, { error: call.error });
    }

    await new Promise((r) => setTimeout(r, 1500)); // 1.5s throttle (slightly slower than confirmation calls · less urgency)
  }

  return {
    recordsProcessed: placed,
    details: `placed=${placed} skipped=${skipped} failed=${failed}`,
  };
}
