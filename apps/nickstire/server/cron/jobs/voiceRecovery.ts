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
  // wave-145 · resolve the outbound number (env override → else auto-lookup
  // the shop's VAPI line). Was a bare VAPI_PHONE_NUMBER_ID check that skipped
  // forever — the $321K post-D30 closer never ran because the var was unset.
  const { resolveVapiPhoneNumberId } = await import("../../services/vapi");
  if (!(await resolveVapiPhoneNumberId())) {
    return { recordsProcessed: 0, details: "Skipped · no VAPI outbound number resolvable" };
  }

  const maxCalls = Math.min(Number(process.env.VAPI_RECOVERY_BATCH_SIZE) || 5, 20);

  // Quiet-hours guard — cold-quote recovery should only call during prime
  // phone hours (10 AM-5 PM ET). Not too early (people are busy), not too
  // late (dinner/evening). Tighter than the cadence 9-18 window because
  // these are cold leads who didn't respond to SMS.
  // Shared helper — the inlined `parseInt` this replaced could yield NaN, and
  // NaN fails every range comparison, opening the guard rather than holding it.
  const { getBusinessHour } = await import("../../lib/timezoneAssert");
  const etHour = getBusinessHour();
  if (etHour < 10 || etHour >= 17) {
    return { recordsProcessed: 0, details: `Outside recovery window (Cleveland ${etHour}:00, window 10-17)` };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  // `customers` was only ever imported for the local opt-out query that
  // loadSuppressionIndex now owns; left in place it would be dead weight
  // implying this job still derives suppression itself.
  const { algEstimates } = await import("../../../drizzle/schema");
  const { placeVapiOutboundCall, buildOutboundRecoveryPrompt, buildRecoveryVoicemail } = await import("../../services/vapi");

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
    // 2026-09-01 (audit F-9): rethrow so the run is recorded as failed.
    log.error("[voice-recovery] candidate query failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  if (candidates.length === 0) {
    return { recordsProcessed: 0, details: "No estimates eligible for voice recovery" };
  }

  /**
   * Suppression, from the SAME index the SMS path uses — and FAILING CLOSED.
   *
   * What was here until 2026-09-16 was a second, weaker copy:
   *
   *   const optOutSet = new Set<string>();
   *   try { ...select customers where smsOptOut = 1... } catch { /* fail-soft *\/ }
   *
   * Two defects in four lines. It read only `customers.smsOptOut`, missing
   * `sms_preferences` — the table `persistOptOutPreference` actually writes —
   * so an opt-out recorded there without a mirrored customer-row update was
   * honoured by SMS and ignored here. And the empty-Set-on-failure catch made
   * an unreadable opt-out list mean "nobody opted out", so every candidate got
   * a call. That is the identical failure sms.ts documents with verified harm
   * on 2026-07-20: a number that opted out on 07-13 still received automated
   * messages on 07-16 and 07-19. SMS was fixed to fail closed; this lane was
   * never revisited.
   *
   * Refusing to place a recovery call costs one delayed marketing touch, to a
   * cold lead that already ignored two SMS touches, on a job that runs again
   * tomorrow. Calling someone who said STOP costs $500-$1,500 per contact and
   * their trust. So an indeterminate index aborts the run LOUDLY rather than
   * proceeding — consistent with the 2026-09-01 audit rule that cron handlers
   * fail loudly instead of returning a soft "skipped".
   *
   * TWO refusals, not one. `ok: false` is the obvious case. The second is
   * `stale`, raised by Codex as a P1 on PR #2361 and CORRECT:
   *
   *   `ensureOptOutCache()`'s `stale()` helper returns `ok: true, stale: true`
   *   with whatever `optOutCache` currently holds and does NOT look at
   *   `optOutCacheLoadedAt`. So `stale` does not mean "5 minutes old" (that is
   *   the TTL, i.e. the FRESH path) — it means the refresh FAILED and this
   *   snapshot is older than the TTL by an UNBOUNDED amount. This server is a
   *   long-lived process, so a persistent DB fault leaves the lane calling from
   *   an hours- or days-old set, and an opt-out recorded after it — especially
   *   by another pod — is invisible.
   *
   * ⚠ Do NOT generalise this to the SMS path. `sendSms` deliberately accepts a
   * stale index (its own header argues that refusing on a stale set is its own
   * outage) and carries additional per-send checks. The asymmetry is the point:
   * a text is cheap and reversible, an unwanted phone call is neither. One
   * definition of WHO is suppressed, two different bars for HOW SURE the lane
   * has to be before acting on it.
   *
   * ★ One claim Codex made is not right, and it matters for the record: it said
   * the snapshot "can remain permissive indefinitely, unlike the previous
   * per-run customer query". The previous query returned an EMPTY set on
   * failure — permissive for EVERYONE, immediately. The snapshot is strictly
   * better than what it replaced. That is not the bar, which is why this
   * refusal is here anyway.
   */
  const { loadSuppressionIndex } = await import("../../sms");
  const suppression = await loadSuppressionIndex();
  if (!suppression.ok) {
    log.error("[voice-recovery] suppression index unreadable — placing NO calls", {
      reason: suppression.reason,
      candidates: candidates.length,
      errorId: "VOICE_RECOVERY_SUPPRESSION_UNREADABLE",
    });
    throw new Error(`voice recovery aborted — suppression index unreadable: ${suppression.reason}`);
  }
  if (suppression.stale) {
    log.error("[voice-recovery] suppression index is STALE (refresh failed, age unbounded) — placing NO calls", {
      suppressed: suppression.phones.size,
      candidates: candidates.length,
      errorId: "VOICE_RECOVERY_SUPPRESSION_STALE",
    });
    throw new Error(
      "voice recovery aborted — suppression index is STALE: the last refresh failed, so its age is unbounded and an opt-out recorded since is invisible",
    );
  }
  const optOutSet = suppression.phones;

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
    const voicemailMsg = buildRecoveryVoicemail({
      customerName: firstName,
      service,
    });
    const firstMessage = `Hey ${firstName}, it's Nick's Tire — you had a quote with us for ${service} a few weeks back. That still on your radar?`;

    const call = await placeVapiOutboundCall({
      customerNumber: e164,
      firstMessageOverride: firstMessage,
      systemPromptOverride: systemPrompt,
      voicemailMessage: voicemailMsg,
      maxDurationSeconds: 90,
    });

    if (call.success && call.callId) {
      await d
        .update(algEstimates)
        .set({ voiceRecoveryCallId: call.callId, voiceRecoveryOutcome: "dialing" })
        .where(eq(algEstimates.id, est.id));
      placed++;
      log.info(`[voice-recovery] placed VAPI call ${call.callId} for est ${est.id} (${dollars})`);
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
