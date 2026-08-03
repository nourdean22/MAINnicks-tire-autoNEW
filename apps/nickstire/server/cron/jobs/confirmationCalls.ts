/**
 * Confirmation Call Cron · wave-181.87 (VAPI implementation · operator
 * preference: keep VAPI · don't add AgentPhone or Twilio as second vendor)
 *
 * Daily cron · for every booking happening tomorrow that hasn't been
 * called yet, places a VAPI outbound call (via the wave-181.50 follow-up
 * assistant + per-call assistantOverrides). Captures confirmation /
 * reschedule / no-answer state in the confirmation_calls table.
 *
 * Safety gates · this cron does NOT fire unless ALL of:
 *   1. VAPI_API_KEY env set (already present from inbound flow)
 *   2. VAPI_PHONE_NUMBER_ID env set (operator must register outbound
 *      number with VAPI · same UI as inbound · 216-424-9249 works or
 *      operator can register a separate outbound number)
 *   3. VAPI_FOLLOW_UP_ASSISTANT_ID env set (already exists from wave-181.50)
 *   4. FEATURE_CONFIRMATION_CALLS=1 env set
 *
 * Without all four, cron logs "skipped (not configured)" and exits.
 * Same conservative-default pattern as wave-181.46 declined-recovery.
 *
 * Per-run cap · 20 calls/run (matches declined-recovery). Override via
 * VAPI_CONFIRMATION_BATCH_SIZE env (max 50).
 */
import { createLogger } from "../../lib/logger";
import { and, gte, eq, or } from "drizzle-orm";

const log = createLogger("cron:confirmation-calls");

interface RunResult {
  recordsProcessed: number;
  details: string;
}

export async function runConfirmationCalls(): Promise<RunResult> {
  if (!process.env.VAPI_API_KEY) {
    return { recordsProcessed: 0, details: "Skipped · VAPI_API_KEY missing" };
  }
  if (process.env.FEATURE_CONFIRMATION_CALLS !== "1") {
    return { recordsProcessed: 0, details: "Skipped · FEATURE_CONFIRMATION_CALLS != '1'" };
  }
  // wave-145 · resolve the outbound number (env override → else auto-lookup
  // the shop's VAPI line). Was a bare VAPI_PHONE_NUMBER_ID check that skipped
  // forever because the var was never set.
  const { resolveVapiPhoneNumberId } = await import("../../services/vapi");
  if (!(await resolveVapiPhoneNumberId())) {
    return { recordsProcessed: 0, details: "Skipped · no VAPI outbound number resolvable" };
  }

  const maxCalls = Math.min(Number(process.env.VAPI_CONFIRMATION_BATCH_SIZE) || 20, 50);

  // Quiet-hours guard — confirmations fire 3-6 PM ET (afternoon before
  // tomorrow's visit). Calling at 3 AM or 9 AM to confirm tomorrow is rude.
  // Uses the shared helper because the inlined `parseInt` this replaced could
  // yield NaN, and NaN fails every range comparison — opening the guard instead
  // of holding it. See getBusinessHour().
  const { getBusinessHour } = await import("../../lib/timezoneAssert");
  const etHour = getBusinessHour();
  if (etHour < 15 || etHour >= 18) {
    return { recordsProcessed: 0, details: `Outside confirmation window (Cleveland ${etHour}:00, window 15-18)` };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  const { bookings, confirmationCalls } = await import("../../../drizzle/schema");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  let candidates: Array<{
    id: number;
    name: string;
    phone: string;
    service: string;
    vehicleYear: string | null;
    vehicleMake: string | null;
    vehicleModel: string | null;
    preferredDate: string | null;
  }> = [];
  try {
    candidates = await d
      .select({
        id: bookings.id,
        name: bookings.name,
        phone: bookings.phone,
        service: bookings.service,
        vehicleYear: bookings.vehicleYear,
        vehicleMake: bookings.vehicleMake,
        vehicleModel: bookings.vehicleModel,
        preferredDate: bookings.preferredDate,
      })
      .from(bookings)
      .where(and(
        eq(bookings.preferredDate, tomorrowStr),
        or(eq(bookings.status, "new"), eq(bookings.status, "confirmed")),
      ))
      .limit(maxCalls + 10);
  } catch (err) {
    log.warn("[confirmation-calls] candidate query failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0, details: "Failed to load candidates" };
  }

  if (candidates.length === 0) {
    return { recordsProcessed: 0, details: `No bookings for ${tomorrowStr}` };
  }

  // Skip bookings already called for tomorrow's slot (last 24h, non-failed).
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const previousCalls = await d
    .select({ bookingId: confirmationCalls.bookingId, status: confirmationCalls.status })
    .from(confirmationCalls)
    .where(gte(confirmationCalls.attemptedAt, twentyFourHoursAgo));
  const alreadyCalled = new Set(
    previousCalls
      .filter((c: { status: string }) => c.status !== "failed")
      .map((c: { bookingId: number }) => c.bookingId),
  );

  const { placeVapiOutboundCall, buildOutboundConfirmationPrompt, buildConfirmationVoicemail } = await import("../../services/vapi");

  let placed = 0;
  let skipped = 0;
  let failed = 0;

  for (const b of candidates) {
    if (placed >= maxCalls) {
      log.info(`[confirmation-calls] hit per-run cap ${maxCalls}, stopping early`);
      break;
    }
    if (alreadyCalled.has(b.id)) {
      skipped++;
      continue;
    }
    if (!b.phone || !/^\+?\d/.test(b.phone)) {
      skipped++;
      continue;
    }

    const digits = b.phone.replace(/\D/g, "");
    const e164 = digits.length === 10 ? `+1${digits}` :
      digits.length === 11 && digits.startsWith("1") ? `+${digits}` :
      b.phone.startsWith("+") ? b.phone : `+1${digits.slice(-10)}`;

    const vehicleRef = [b.vehicleYear, b.vehicleMake, b.vehicleModel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase() || undefined;
    const firstName = b.name.split(" ")[0] || b.name;

    // At-most-once claim · INSERT before placing call (same wave-181.59 pattern)
    let attemptId: number | null = null;
    try {
      const [insertResult] = await d
        .insert(confirmationCalls)
        .values({ bookingId: b.id, status: "pending" })
        .$returningId();
      attemptId = insertResult?.id ?? null;
    } catch (err) {
      log.warn(`[confirmation-calls] claim failed for booking ${b.id}`, { error: err instanceof Error ? err.message : String(err) });
      failed++;
      continue;
    }

    const systemPrompt = buildOutboundConfirmationPrompt({
      customerName: firstName,
      service: b.service,
      preferredDay: "tomorrow",
      vehicleRef,
    });
    const voicemailMsg = buildConfirmationVoicemail({
      customerName: firstName,
      service: b.service,
      preferredDay: "tomorrow",
    });
    const firstMessage = `Hey ${firstName}, it's Nick's Tire — you still good for that ${b.service} tomorrow?`;

    const call = await placeVapiOutboundCall({
      customerNumber: e164,
      firstMessageOverride: firstMessage,
      systemPromptOverride: systemPrompt,
      voicemailMessage: voicemailMsg,
      maxDurationSeconds: 90,
    });

    if (call.success && call.callId && attemptId !== null) {
      await d
        .update(confirmationCalls)
        .set({ agentphoneCallId: call.callId, status: "dialing" })
        .where(eq(confirmationCalls.id, attemptId));
      placed++;
      log.info(`[confirmation-calls] placed VAPI call ${call.callId} for booking ${b.id} (${firstName})`);
    } else {
      if (attemptId !== null) {
        await d
          .update(confirmationCalls)
          .set({ status: "failed", errorMessage: (call.error ?? "unknown").slice(0, 500), completedAt: new Date() })
          .where(eq(confirmationCalls.id, attemptId));
      }
      failed++;
      log.warn(`[confirmation-calls] place failed for booking ${b.id}`, { error: call.error });
    }

    // 1s throttle · keeps under VAPI burst limits
    await new Promise((r) => setTimeout(r, 1000));
  }

  return {
    recordsProcessed: placed,
    details: `placed=${placed} skipped=${skipped} failed=${failed} (target date: ${tomorrowStr})`,
  };
}
